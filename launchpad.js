(function(){
    $("#launchpad-panel").remove();
    
    // === CONFIG ===
    var GITHUB_OWNER = "FNE-stack";
    var GITHUB_REPO = "DS-TEST";
    var GITHUB_BRANCH = "main";
    var GITHUB_FILE = "plan.json";
    var GITHUB_TOKEN = "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";
    var GITHUB_API = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + GITHUB_FILE;
    var AUTO_REFRESH_MS = 15000;
    
    var villageMap = {};
    var currentSha = null;
    var currentPlan = [];
    var isWriting = false;
    
    // === UI ===
    var panel = $("<div id='launchpad-panel' style='background:#f4e4bc;border:1px solid #804000;padding:10px;margin:8px 0;font-family:Verdana;'></div>");
    panel.append("<h3 style='margin:0 0 8px 0;'>Attack Launchpad (shared)</h3>");
    
    var textarea = $("<textarea style='width:100%;height:120px;font-family:monospace;font-size:11px;'></textarea>");
    var pushBtn = $("<button style='margin-top:5px;'>Push New Plan</button>");
    var refreshBtn = $("<button style='margin-top:5px;margin-left:5px;'>Refresh</button>");
    var wipeBtn = $("<button style='margin-top:5px;margin-left:5px;background:#fcc;'>Wipe Plan</button>");
    var status = $("<div style='margin-top:5px;font-size:11px;color:#555;'></div>");
    var tableContainer = $("<div></div>");
    
    panel.append("<div style='margin-bottom:5px;font-size:12px;'>Paste a new plan and Push, or Refresh to see current shared plan:</div>")
         .append(textarea).append(pushBtn).append(refreshBtn).append(wipeBtn)
         .append(status).append(tableContainer);
    
    var mount = $("#contentContainer").length ? $("#contentContainer") : $("body");
    mount.prepend(panel);
    
    function setStatus(msg, color) { status.text(msg).css("color", color || "#555"); }
    
    // === Village data ===
    function loadVillages(callback) {
        if (Object.keys(villageMap).length > 0) { callback(); return; }
        $.get("/map/village.txt", function(data) {
            data.split("\n").forEach(function(line){
                var p = line.split(",");
                if (p.length >= 4) villageMap[p[0]] = { name: decodeURIComponent(p[1]), x: p[2], y: p[3] };
            });
            callback();
        }).fail(callback);
    }
    function villageLabel(id) {
        var v = villageMap[id];
        return v ? v.name + " (" + v.x + "|" + v.y + ")" : id;
    }
    
    // === Parsing ===
    function parseLine(line) {
        line = line.trim();
        if (!line) return null;
        var parts = line.split("&");
        if (parts.length < 8) return null;
        var troops = {};
        parts[7].split("/").forEach(function(t){
            var kv = t.split("=");
            if (kv.length === 2) {
                try { troops[kv[0]] = parseInt(atob(kv[1])); } catch(e){}
            }
        });
        return {
            originId: parts[0],
            targetId: parts[1],
            slowest: parts[2],
            arrivalMs: parseInt(parts[3]),
            troops: troops,
            raw: line,
            sent: false,
            sentBy: null,
            sentAt: null
        };
    }
    
    var serverOffset = (typeof Timing !== "undefined" && Timing.offset_server) ? Timing.offset_server : 0;
    function serverNow() { return Date.now() + serverOffset; }
    
    function buildUrl(a) {
        var p = "/game.php?village=" + a.originId + "&screen=place&target=" + a.targetId;
        for (var u in a.troops) p += "&" + u + "=" + a.troops[u];
        return p;
    }
    
    var ME = (typeof game_data !== "undefined" && game_data.player && game_data.player.name) ? game_data.player.name : "?";
    
    // === GitHub ===
    function authHeaders() {
        return { "Authorization": "Bearer " + GITHUB_TOKEN, "Accept": "application/vnd.github+json" };
    }
    
    function githubGet(callback) {
        $.ajax({
            url: GITHUB_API + "?ref=" + GITHUB_BRANCH + "&_=" + Date.now(),
            headers: authHeaders(),
            success: function(data) {
                currentSha = data.sha;
                try {
                    var content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
                    callback(JSON.parse(content));
                } catch(e) { setStatus("Bad JSON in plan.json: " + e.message, "red"); callback(null); }
            },
            error: function(xhr) {
                if (xhr.status === 404) { currentSha = null; callback(null); }
                else { setStatus("GitHub GET failed: " + xhr.status, "red"); callback(null); }
            }
        });
    }
    
    function githubPut(planObj, message, callback) {
        if (isWriting) { setStatus("Write in progress, retry shortly.", "orange"); return; }
        isWriting = true;
        var content = JSON.stringify(planObj, null, 2);
        var body = {
            message: message,
            content: btoa(unescape(encodeURIComponent(content))),
            branch: GITHUB_BRANCH
        };
        if (currentSha) body.sha = currentSha;
        $.ajax({
            url: GITHUB_API,
            method: "PUT",
            headers: authHeaders(),
            contentType: "application/json",
            data: JSON.stringify(body),
            success: function(resp) {
                currentSha = resp.content.sha;
                isWriting = false;
                if (callback) callback();
            },
            error: function(xhr) {
                isWriting = false;
                if (xhr.status === 409 || xhr.status === 422) {
                    setStatus("Conflict — refreshing and retrying...", "orange");
                    githubGet(function(latest){
                        if (latest && latest.attacks) currentPlan = mergeSent(latest.attacks, currentPlan);
                        renderPlan(currentPlan);
                        githubPut({ attacks: currentPlan }, message, callback);
                    });
                } else {
                    setStatus("GitHub PUT failed: " + xhr.status, "red");
                }
            }
        });
    }
    
    function githubDelete(callback) {
        if (!currentSha) { setStatus("Nothing to wipe.", "orange"); return; }
        $.ajax({
            url: GITHUB_API,
            method: "DELETE",
            headers: authHeaders(),
            contentType: "application/json",
            data: JSON.stringify({ message: "wipe plan", sha: currentSha, branch: GITHUB_BRANCH }),
            success: function() {
                currentSha = null; currentPlan = [];
                setStatus("Plan wiped.", "green");
                renderPlan([]);
                if (callback) callback();
            },
            error: function(xhr) { setStatus("GitHub DELETE failed: " + xhr.status, "red"); }
        });
    }
    
    function mergeSent(newAttacks, oldAttacks) {
        if (!oldAttacks || oldAttacks.length === 0) return newAttacks;
        return newAttacks.map(function(att) {
            var match = oldAttacks.find(function(o){
                return o.originId===att.originId && o.targetId===att.targetId && o.arrivalMs===att.arrivalMs;
            });
            if (match && match.sent) {
                att.sent = true;
                att.sentBy = match.sentBy;
                att.sentAt = match.sentAt;
            }
            return att;
        });
    }
    
    // === Render ===
    function renderPlan(plan) {
        currentPlan = plan;
        tableContainer.empty();
        if (plan.length === 0) {
            tableContainer.append("<div style='color:#888;margin:8px 0;'>No attacks loaded.</div>");
            return;
        }
        var sentCount = plan.filter(function(a){return a.sent;}).length;
        tableContainer.append("<div style='margin:8px 0;'>Plan: <b>" + plan.length + "</b> attacks, <b>" + sentCount + "</b> sent.</div>");
        
        var table = $("<table class='vis' width='100%'><thead><tr><th>#</th><th>Origin</th><th>Target</th><th>Troops</th><th>Arrival</th><th>Countdown</th><th>Status</th><th>Send</th></tr></thead><tbody></tbody></table>");
        var tbody = table.find("tbody");
        
        plan.forEach(function(att, i) {
            var ts = Object.keys(att.troops).map(function(u){ return att.troops[u]+" "+u; }).join(", ");
            var statusCell = att.sent ? ("<span style='color:#080;'>Sent by " + (att.sentBy||"?") + "</span>") : "--";
            var row = $("<tr>" +
                "<td>"+(i+1)+"</td>" +
                "<td style='font-size:11px;'>"+villageLabel(att.originId)+"</td>" +
                "<td style='font-size:11px;'>"+villageLabel(att.targetId)+"</td>" +
                "<td style='font-size:11px;'>"+ts+"</td>" +
                "<td style='font-size:11px;'>"+new Date(att.arrivalMs).toLocaleString()+"</td>" +
                "<td class='cd' data-target='"+att.arrivalMs+"'>--</td>" +
                "<td style='font-size:11px;'>"+statusCell+"</td>" +
                "<td></td></tr>");
            if (att.sent) row.css("background","#e8e8e8").css("opacity","0.7");
            
            var btn = $("<button class='btn'>Send</button>");
            if (att.sent) btn.prop("disabled", true).text("Sent");
            btn.on("click", function() {
                window.open(buildUrl(att), "_blank");
                att.sent = true;
                att.sentBy = ME;
                att.sentAt = Date.now();
                $(this).prop("disabled", true).text("Sent");
                setStatus("Marking as sent...");
                githubPut({ attacks: currentPlan }, "mark sent: " + att.originId + "->" + att.targetId + " by " + ME, function(){
                    setStatus("Sent status synced.", "green");
                    renderPlan(currentPlan);
                });
            });
            row.find("td").last().append(btn);
            tbody.append(row);
        });
        tableContainer.append(table);
    }
    
    // === Buttons ===
    pushBtn.on("click", function() {
        var src = textarea.val().trim();
        if (!src) { setStatus("Paste attacks first.", "red"); return; }
        var plan = src.split("\n").map(parseLine).filter(Boolean);
        if (plan.length === 0) { setStatus("No valid attacks.", "red"); return; }
        if (!confirm("Push " + plan.length + " attacks? Overwrites current shared plan and resets sent statuses.")) return;
        loadVillages(function(){
            githubGet(function(){
                githubPut({ attacks: plan }, "new plan (" + plan.length + " attacks)", function(){
                    setStatus("New plan pushed.", "green");
                    currentPlan = plan;
                    renderPlan(plan);
                    textarea.val("").css("height","40px");
                });
            });
        });
    });
    
    refreshBtn.on("click", function() {
        loadVillages(function(){
            setStatus("Refreshing...");
            githubGet(function(data){
                if (!data || !data.attacks) { renderPlan([]); setStatus("No plan on GitHub.", "orange"); return; }
                renderPlan(data.attacks);
                setStatus("Refreshed.", "green");
            });
        });
    });
    
    wipeBtn.on("click", function() {
        if (!confirm("Wipe shared plan for everyone?")) return;
        githubGet(function(){ githubDelete(); });
    });
    
    // === Init + auto-refresh ===
    loadVillages(function(){
        githubGet(function(data){
            if (data && data.attacks) renderPlan(data.attacks);
            else setStatus("No plan on GitHub yet — paste one and Push.", "orange");
        });
    });
    
    if (window._lpAuto) clearInterval(window._lpAuto);
    window._lpAuto = setInterval(function(){
        if (isWriting) return;
        githubGet(function(data){
            if (!data || !data.attacks) return;
            if (JSON.stringify(currentPlan) !== JSON.stringify(data.attacks)) renderPlan(data.attacks);
        });
    }, AUTO_REFRESH_MS);
    
    // === Countdown ===
    if (window._lpInt) clearInterval(window._lpInt);
    window._lpInt = setInterval(function() {
        var now = serverNow();
        $("#launchpad-panel .cd").each(function(){
            var t = parseInt($(this).data("target"));
            var d = t - now;
            if (d <= 0) {
                $(this).text("READY").css({color:"#080",fontWeight:"bold"});
                var tr = $(this).closest("tr");
                if (!tr.hasClass("sent-row")) tr.css("background","#d4ffd4");
            } else {
                var h = Math.floor(d/3600000), m = Math.floor((d%3600000)/60000), s = Math.floor((d%60000)/1000);
                $(this).text(h+"h "+m+"m "+s+"s");
            }
        });
    }, 200);
})();
