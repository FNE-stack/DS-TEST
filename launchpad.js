(function(){
    $("#launchpad-panel").remove();
    
    // === CONFIG ===
    var GITHUB_OWNER = "FNE-stack";
    var GITHUB_REPO = "DS-TEST";
    var GITHUB_BRANCH = "main";
    var GITHUB_FILE = "plan.json";
    var GITHUB_TOKEN = window.LAUNCHPAD_TOKEN || "";
    var GITHUB_API = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + GITHUB_FILE;
    var AUTO_REFRESH_MS = 15000;

    var villageMap = {};
    var currentSha = null;
    var currentPlan = [];
    var isWriting = false;

    function isMobile() { return window.innerWidth < 700; }

    // === UI ===
    var panel = $("<div id='launchpad-panel' style='background:#f4e4bc;border:1px solid #804000;padding:10px;margin:8px 0;font-family:Verdana;max-width:100%;box-sizing:border-box;'></div>");
    panel.append("<h3 style='margin:0 0 8px 0;font-size:14px;'>Angriffsplaner (geteilt)</h3>");

    var textarea = $("<textarea style='width:100%;height:80px;font-family:monospace;font-size:11px;box-sizing:border-box;'></textarea>");

    var btnStyle = "margin:4px 4px 0 0;min-height:38px;padding:6px 10px;font-size:13px;";
    var pushBtn    = $("<button style='" + btnStyle + "'>Plan hochladen</button>");
    var refreshBtn = $("<button style='" + btnStyle + "'>Aktualisieren</button>");
    var wipeBtn    = $("<button style='" + btnStyle + "background:#fcc;'>Plan löschen</button>");
    var btnRow     = $("<div style='display:flex;flex-wrap:wrap;'></div>").append(pushBtn).append(refreshBtn).append(wipeBtn);

    var status = $("<div style='margin-top:6px;font-size:12px;color:#555;'></div>");
    var tableContainer = $("<div style='overflow-x:auto;max-width:100%;'></div>");

    panel.append("<div style='margin-bottom:5px;font-size:12px;'>Plan einfügen und Hochladen, oder Aktualisieren:</div>")
         .append(textarea).append(btnRow)
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
        for (var u in a.troops) {
            if (a.troops[u] > 0) p += "&" + u + "=" + a.troops[u];
        }
        return p;
    }

    // window.open is blocked in the TW mobile app — fall back to same-tab navigation
    function navigate(url) {
        var w = null;
        try { w = window.open(url, "_blank"); } catch(e) {}
        if (!w) location.href = url;
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
                } catch(e) { setStatus("Ungültiges JSON in plan.json: " + e.message, "red"); callback(null); }
            },
            error: function(xhr) {
                if (xhr.status === 404) { currentSha = null; callback(null); }
                else { setStatus("GitHub GET fehlgeschlagen: " + xhr.status, "red"); callback(null); }
            }
        });
    }

    function githubPut(planObj, message, callback) {
        if (isWriting) { setStatus("Schreibvorgang läuft, bitte erneut versuchen.", "orange"); return; }
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
                    setStatus("Konflikt — aktualisiere und versuche erneut...", "orange");
                    githubGet(function(latest){
                        if (latest && latest.attacks) currentPlan = mergeSent(latest.attacks, currentPlan);
                        renderPlan(currentPlan);
                        githubPut({ attacks: currentPlan }, message, callback);
                    });
                } else {
                    setStatus("GitHub PUT fehlgeschlagen: " + xhr.status, "red");
                }
            }
        });
    }

    function githubDelete(callback) {
        if (!currentSha) { setStatus("Nichts zu löschen.", "orange"); return; }
        $.ajax({
            url: GITHUB_API,
            method: "DELETE",
            headers: authHeaders(),
            contentType: "application/json",
            data: JSON.stringify({ message: "Plan gelöscht", sha: currentSha, branch: GITHUB_BRANCH }),
            success: function() {
                currentSha = null; currentPlan = [];
                setStatus("Plan gelöscht.", "green");
                renderPlan([]);
                if (callback) callback();
            },
            error: function(xhr) { setStatus("GitHub DELETE fehlgeschlagen: " + xhr.status, "red"); }
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

    // === Action handlers (extracted so closures work correctly in loops) ===
    function makeSendHandler(att) {
        return function() {
            var url = buildUrl(att);
            att.sent = true;
            att.sentBy = ME;
            att.sentAt = Date.now();
            setStatus("Markiere als gesendet...");
            githubPut({ attacks: currentPlan }, "gesendet: " + att.originId + "->" + att.targetId + " von " + ME, function(){
                setStatus("Status synchronisiert.", "green");
                if (!isMobile()) renderPlan(currentPlan);
            });
            navigate(url);
        };
    }

    function makeRevokeHandler(att) {
        return function() {
            if (!confirm("Diesen Angriff als NICHT gesendet markieren? Nutzen falls der Versand im Spiel fehlgeschlagen ist oder du versehentlich geklickt hast.")) return;
            att.sent = false;
            var prevSentBy = att.sentBy;
            att.sentBy = null;
            att.sentAt = null;
            setStatus("Setze Status zurück...");
            githubPut({ attacks: currentPlan }, "zurückgesetzt: " + att.originId + "->" + att.targetId + " (war " + prevSentBy + ")", function(){
                setStatus("Zurückgesetzt.", "green");
                renderPlan(currentPlan);
            });
        };
    }

    // === Render: card layout for mobile ===
    function renderCards(plan) {
        var sendBtnStyle   = "width:100%;min-height:44px;padding:8px;font-size:14px;font-weight:bold;background:#afa;border:1px solid #080;margin-top:8px;box-sizing:border-box;";
        var revokeBtnStyle = "width:100%;min-height:40px;padding:6px;font-size:13px;background:#fcc;border:1px solid #a00;margin-top:6px;box-sizing:border-box;";

        plan.forEach(function(att, i) {
            var ts = Object.keys(att.troops)
                .filter(function(u){ return att.troops[u] > 0; })
                .map(function(u){ return att.troops[u] + " " + u; })
                .join(", ");

            var card = $("<div class='lp-card' style='border:1px solid #a07030;background:" + (att.sent ? "#e4e4e4" : "#fff8e8") + ";border-radius:4px;padding:10px;margin:8px 0;opacity:" + (att.sent ? "0.75" : "1") + ";'></div>");
            card.append("<div style='font-weight:bold;font-size:14px;margin-bottom:6px;'>#" + (i + 1) + (att.sent ? " ✓ gesendet" : "") + "</div>");
            card.append("<div style='font-size:13px;margin:2px 0;'><b>Von:</b> " + villageLabel(att.originId) + "</div>");
            card.append("<div style='font-size:13px;margin:2px 0;'><b>Auf:</b> " + villageLabel(att.targetId) + "</div>");
            card.append("<div style='font-size:12px;margin:2px 0;color:#555;'>" + (ts || "keine Truppen") + "</div>");
            card.append("<div style='font-size:12px;margin:4px 0;'><b>Ankunft:</b> " + new Date(att.arrivalMs).toLocaleString() + "</div>");

            if (!att.sent) {
                card.append("<div style='font-size:13px;font-weight:bold;margin:4px 0;'>Countdown: <span class='cd' data-target='" + att.arrivalMs + "'>--</span></div>");
                var sendBtn = $("<button style='" + sendBtnStyle + "'>Senden</button>");
                sendBtn.on("click", makeSendHandler(att));
                card.append(sendBtn);
            } else {
                card.append("<div style='font-size:13px;color:#080;margin:4px 0;'>Gesendet von <b>" + (att.sentBy || "?") + "</b></div>");
                var revokeBtn = $("<button style='" + revokeBtnStyle + "'>Zurücksetzen</button>");
                revokeBtn.on("click", makeRevokeHandler(att));
                card.append(revokeBtn);
            }

            tableContainer.append(card);
        });
    }

    // === Render: table layout for desktop ===
    function renderTable(plan) {
        var table = $("<table class='vis' style='width:100%;table-layout:auto;'><thead><tr><th>#</th><th>Herkunft</th><th>Ziel</th><th>Truppen</th><th>Ankunft</th><th>Countdown</th><th>Status</th><th>Aktion</th></tr></thead><tbody></tbody></table>");
        var tbody = table.find("tbody");

        plan.forEach(function(att, i) {
            var ts = Object.keys(att.troops)
                .filter(function(u){ return att.troops[u] > 0; })
                .map(function(u){ return att.troops[u] + " " + u; })
                .join(", ");
            var statusCell = att.sent ? ("<span style='color:#080;'>Gesendet von " + (att.sentBy || "?") + "</span>") : "--";
            var countdownCell = att.sent
                ? "<td style='color:#999;white-space:nowrap;'>—</td>"
                : "<td class='cd' data-target='" + att.arrivalMs + "' style='white-space:nowrap;'>--</td>";

            var row = $("<tr>" +
                "<td>" + (i + 1) + "</td>" +
                "<td style='font-size:11px;word-break:break-word;max-width:140px;'>" + villageLabel(att.originId) + "</td>" +
                "<td style='font-size:11px;word-break:break-word;max-width:140px;'>" + villageLabel(att.targetId) + "</td>" +
                "<td style='font-size:11px;word-break:break-word;max-width:160px;'>" + ts + "</td>" +
                "<td style='font-size:11px;white-space:nowrap;'>" + new Date(att.arrivalMs).toLocaleString() + "</td>" +
                countdownCell +
                "<td style='font-size:11px;'>" + statusCell + "</td>" +
                "<td style='white-space:nowrap;'></td></tr>");
            if (att.sent) row.css("background", "#e8e8e8").css("opacity", "0.7");

            var actionCell = row.find("td").last();
            if (!att.sent) {
                var sendBtn = $("<button class='btn'>Senden</button>");
                sendBtn.on("click", makeSendHandler(att));
                actionCell.append(sendBtn);
            } else {
                var revokeBtn = $("<button style='background:#fcc;'>Zurücksetzen</button>");
                revokeBtn.on("click", makeRevokeHandler(att));
                actionCell.append(revokeBtn);
            }
            tbody.append(row);
        });
        tableContainer.append(table);
    }

    function renderPlan(plan) {
        currentPlan = plan;
        tableContainer.empty();
        if (plan.length === 0) {
            tableContainer.append("<div style='color:#888;margin:8px 0;'>Keine Angriffe geladen.</div>");
            return;
        }
        var sentCount = plan.filter(function(a){ return a.sent; }).length;
        tableContainer.append("<div style='margin:8px 0;'>Plan: <b>" + plan.length + "</b> Angriffe, <b>" + sentCount + "</b> gesendet.</div>");

        if (isMobile()) {
            renderCards(plan);
        } else {
            renderTable(plan);
        }
    }

    // === Buttons ===
    pushBtn.on("click", function() {
        var src = textarea.val().trim();
        if (!src) { setStatus("Bitte zuerst Angriffe einfügen.", "red"); return; }
        var plan = src.split("\n").map(parseLine).filter(Boolean);
        if (plan.length === 0) { setStatus("Keine gültigen Angriffe.", "red"); return; }
        if (!confirm("Plan mit " + plan.length + " Angriffen hochladen? Überschreibt aktuellen geteilten Plan und setzt alle Sende-Status zurück.")) return;
        loadVillages(function(){
            githubGet(function(){
                githubPut({ attacks: plan }, "neuer Plan (" + plan.length + " Angriffe)", function(){
                    setStatus("Neuer Plan hochgeladen.", "green");
                    currentPlan = plan;
                    renderPlan(plan);
                    textarea.val("").css("height", "40px");
                });
            });
        });
    });

    refreshBtn.on("click", function() {
        loadVillages(function(){
            setStatus("Aktualisiere...");
            githubGet(function(data){
                if (!data || !data.attacks) { renderPlan([]); setStatus("Kein Plan auf GitHub.", "orange"); return; }
                renderPlan(data.attacks);
                setStatus("Aktualisiert.", "green");
            });
        });
    });

    wipeBtn.on("click", function() {
        if (!confirm("Geteilten Plan für alle löschen?")) return;
        githubGet(function(){ githubDelete(); });
    });

    // === Init + auto-refresh ===
    loadVillages(function(){
        githubGet(function(data){
            if (data && data.attacks) renderPlan(data.attacks);
            else setStatus("Noch kein Plan auf GitHub — Plan einfügen und hochladen.", "orange");
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

    // === Countdown (works for both table <td> and card <span>) ===
    if (window._lpInt) clearInterval(window._lpInt);
    window._lpInt = setInterval(function() {
        var now = serverNow();
        $("#launchpad-panel .cd").each(function(){
            var t = parseInt($(this).data("target"));
            var d = t - now;
            if (d <= 0) {
                $(this).text("BEREIT").css({ color: "#080", fontWeight: "bold" });
                var container = $(this).closest("tr,.lp-card");
                if (!container.hasClass("sent-row")) container.css("background", "#d4ffd4");
            } else {
                var h = Math.floor(d / 3600000), m = Math.floor((d % 3600000) / 60000), s = Math.floor((d % 60000) / 1000);
                $(this).text(h + "h " + m + "m " + s + "s");
            }
        });
    }, 200);
})();
