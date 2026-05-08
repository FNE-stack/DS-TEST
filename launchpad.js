(function(){
    $("#launchpad-panel").remove();

    // === CONFIG ===
    var VERSION = "v47";
    var GITHUB_OWNER = "FNE-stack";
    var GITHUB_REPO = "DS-TEST";
    var GITHUB_BRANCH = "main";
    var GITHUB_FILE = "plan.json";
    var GITHUB_TOKEN = window.LAUNCHPAD_TOKEN || "";
    var GITHUB_API = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + GITHUB_FILE;
    var AUTO_REFRESH_MS = 15000;

    var villageMap = {};
    var playerMap = {};
    var currentSha = null;
    var currentPlan = [];
    var isWriting = false;

    function isMobile() { return window.innerWidth < 700; }

    // === UI ===
    var panel = $("<div id='launchpad-panel' style='background:#f4e4bc;border:1px solid #804000;padding:10px;margin:8px 0;font-family:Verdana;max-width:100%;box-sizing:border-box;'></div>");
    panel.append("<h3 style='margin:0 0 8px 0;font-size:14px;'>Angriffsplaner (geteilt) <span style='font-size:11px;color:#888;font-weight:normal;'>" + VERSION + "</span></h3>");

    var textarea = $("<textarea style='width:100%;height:80px;font-family:monospace;font-size:11px;box-sizing:border-box;'></textarea>");

    var btnStyle = "margin:4px 4px 0 0;min-height:38px;padding:6px 10px;font-size:13px;";
    var pushBtn    = $("<button style='" + btnStyle + "'>Plan hochladen</button>");
    var refreshBtn = $("<button style='" + btnStyle + "'>Aktualisieren</button>");
    var wipeBtn    = $("<button style='" + btnStyle + "background:#fcc;'>Plan löschen</button>");
    var btnRow     = $("<div style='display:flex;flex-wrap:wrap;'></div>").append(pushBtn).append(refreshBtn).append(wipeBtn);

    var status = $("<div style='margin-top:6px;font-size:12px;color:#555;'></div>");
    var tableContainer = $("<div style='overflow-x:auto;max-width:100%;'></div>");

    var panelBody = $("<div></div>")
        .append("<div style='margin-bottom:5px;font-size:12px;'>Plan einfügen und Hochladen, oder Aktualisieren:</div>")
        .append(textarea).append(btnRow)
        .append(status).append(tableContainer);

    var toggleBody = $("<span style='cursor:pointer;font-size:12px;color:#804000;float:right;'>▼</span>");
    panel.find("h3").append(toggleBody);
    toggleBody.on("click", function() {
        panelBody.toggle();
        toggleBody.text(panelBody.is(":visible") ? "▼" : "▶");
    });
    panel.append(panelBody);

    // Detect if we're on the exact place screen for a pending attack
    var pending = loadPendingAttack();
    var onAttackScreen = (function() {
        if (!pending) return false;
        var screen = (typeof game_data !== "undefined") ? game_data.screen : null;
        var villageId = (typeof game_data !== "undefined" && game_data.village) ? String(game_data.village.id) : null;
        return screen === "place" && villageId === String(pending.originId);
    })();

    var mount = $("#contentContainer").length ? $("#contentContainer") : $("body");

    function setStatus(msg, color) { status.text(msg).css("color", color || "#555"); }

    // === Village + player data ===
    function loadVillages(callback) {
        if (Object.keys(villageMap).length > 0) { callback(); return; }
        $.get("/map/village.txt", function(data) {
            data.split("\n").forEach(function(line){
                var p = line.split(",");
                if (p.length >= 4) villageMap[p[0]] = { name: decodeURIComponent(p[1].replace(/\+/g, "%20")), x: p[2], y: p[3], playerId: p[4] || "0" };
            });
            callback();
        }).fail(callback);
    }
    function loadPlayers(callback) {
        if (Object.keys(playerMap).length > 0) { callback(); return; }
        $.get("/map/player.txt", function(data) {
            data.split("\n").forEach(function(line){
                var p = line.split(",");
                if (p.length >= 3) playerMap[p[0]] = { allyId: p[2] };
            });
            callback();
        }).fail(callback);
    }
    function loadData(callback) {
        loadVillages(function(){ loadPlayers(callback); });
    }
    function villageLabel(id) {
        var v = villageMap[id];
        return v ? v.name + " (" + v.x + "|" + v.y + ")" : id;
    }
    function isSupport(att) {
        var targetV = villageMap[String(att.targetId)];
        if (!targetV || !targetV.playerId) return false;
        var targetPid = String(targetV.playerId);
        if (targetPid === "0") return false;
        var myPid = String((typeof game_data !== "undefined" && game_data.player) ? game_data.player.id : "0");
        if (targetPid === myPid) return true;
        // Resolve my tribe from player.txt — more reliable than game_data.player.ally_id
        var myEntry = playerMap[myPid];
        var myAlly = myEntry ? String(myEntry.allyId) : "0";
        if (myAlly === "0") return false;
        var tp = playerMap[targetPid];
        return tp ? String(tp.allyId) === myAlly : false;
    }

    // === Parsing ===
    function parseLine(line) {
        line = line.trim();
        if (!line) return null;
        var parts = line.split("&");
        if (parts.length < 8) return null;
        var troops = {};
        parts[7].split("/").forEach(function(t){
            var eq = t.indexOf("=");
            if (eq > 0) {
                try { troops[t.substring(0, eq)] = parseInt(atob(t.substring(eq + 1))); } catch(e){}
            }
        });
        var arrivalRaw = parseInt(parts[3], 10);
        // Some planners export epoch seconds, others epoch milliseconds.
        var arrivalMs = (arrivalRaw > 0 && arrivalRaw < 1000000000000) ? (arrivalRaw * 1000) : arrivalRaw;

        return {
            id: parts[0] + "_" + parts[1] + "_" + parts[3],
            originId: parts[0],
            targetId: parts[1],
            slowest: parts[2],
            arrivalMs: arrivalMs,
            catapultTarget: parts[4],
            troops: troops,
            raw: line,
            sent: false,
            sentBy: null,
            sentAt: null
        };
    }

    var serverOffset = (typeof Timing !== "undefined" && Timing.offset_server) ? Timing.offset_server : 0;
    function serverNow() { return Date.now() + serverOffset; }
    var worldSpeed = (typeof game_data !== "undefined" && game_data.world && game_data.world.speed) ? (+game_data.world.speed || 1) : 1;
    var unitSpeed = (typeof game_data !== "undefined" && game_data.world && game_data.world.unit_speed) ? (+game_data.world.unit_speed || 1) : 1;
    var UNIT_SPEEDS = {
        spear: 18, sword: 22, axe: 18, archer: 18, spy: 9,
        light: 10, marcher: 10, heavy: 11, ram: 30, catapult: 30,
        knight: 10, snob: 35, militia: 18
    };

    function slowestMinutesPerFieldFromTroops(troops) {
        if (!troops) return null;
        var slowest = null;
        Object.keys(troops).forEach(function(unitKey) {
            var count = +troops[unitKey] || 0;
            if (count <= 0) return;
            var mpf = UNIT_SPEEDS[String(unitKey).toLowerCase()];
            if (!mpf) return;
            if (slowest === null || mpf > slowest) slowest = mpf;
        });
        return slowest;
    }

    var BUILDINGS = {
        main: "Hauptgebäude", barracks: "Kaserne",   stable:    "Stall",
        garage: "Werkstatt",  smith:    "Schmiede",  place:     "Versammlungsplatz",
        statue: "Statue",     market:   "Markt",     wood:      "Holzfäller",
        stone:  "Lehmgrube",  iron:     "Eisenmine", farm:      "Bauernhof",
        storage:"Speicher",   hide:     "Versteck",  wall:      "Wall",
        snob:   "Adelshof",   watchtower:"Späherturm", church:  "Kirche",
        church_f:"Erstkirche",academy:  "Akademie"
    };
    // Dynamic building ID map — fetched once in the background from TW's attack form HTML
    var twBuildingIds = {};
    function loadBuildingIds(attacks) {
        if (Object.keys(twBuildingIds).length > 0) return;
        var probe = null;
        for (var i = 0; i < attacks.length; i++) {
            if (attacks[i].troops && attacks[i].troops.catapult > 0) { probe = attacks[i]; break; }
        }
        if (!probe) return;
        $.get("/game.php?village=" + probe.originId + "&screen=place&target=" + probe.targetId, function(html) {
            var selMatch = html.match(/name=["']building["'][\s\S]*?<\/select>/i);
            if (!selMatch) return;
            var re = /<option[^>]+value=["'](\d+)["'][^>]*>([^<]+)<\/option>/gi;
            var m, found = false;
            while ((m = re.exec(selMatch[0])) !== null) {
                if (m[1] !== "0") { twBuildingIds[m[1]] = m[2].trim(); found = true; }
            }
            if (found && currentPlan.length > 0) renderPlan(currentPlan);
        });
    }
    function buildingHtml(key, troops) {
        if (!key || key === "0" || key === "none") return "";
        if (troops && !(troops.catapult > 0)) return "";
        var k = String(key);
        // Prefer TW's own label (populated from place screen select)
        var name = twBuildingIds[k];
        if (!name) {
            // Fall back: try string key in BUILDINGS map
            var mapped = BUILDINGS[k.toLowerCase()];
            name = mapped || ("Gebäude #" + k);
        }
        var imgKey = k.toLowerCase();
        return "<img src='/graphic/buildings/" + imgKey + ".png' " +
               "onerror='this.style.display=\"none\"' " +
               "title='" + name + "' style='width:18px;height:18px;vertical-align:middle;margin-right:3px;'>" +
               "<span>" + name + "</span>";
    }

    function getSendMs(att) {
        if (!att) return null;
        if (att.sendMs && !isNaN(att.sendMs)) return parseInt(att.sendMs, 10);

        var arrivalMs = parseInt(att.arrivalMs, 10);
        if (!arrivalMs || isNaN(arrivalMs)) return null;

        var fromV = villageMap[String(att.originId)] || villageMap[att.originId];
        var toV   = villageMap[String(att.targetId)] || villageMap[att.targetId];
        if (!fromV || !toV) return null;

        var slowestMpf = null;
        if (att.slowest) {
            var unitKey = String(att.slowest).toLowerCase();
            if (UNIT_SPEEDS[unitKey]) slowestMpf = UNIT_SPEEDS[unitKey];
        }
        if (!slowestMpf) slowestMpf = slowestMinutesPerFieldFromTroops(att.troops);
        if (!slowestMpf) return null;

        var dist = Math.hypot((+fromV.x) - (+toV.x), (+fromV.y) - (+toV.y));
        if (!isFinite(dist) || dist === 0) return null;

        var travelSecs = dist * slowestMpf * 60 / (worldSpeed * unitSpeed);
        return Math.round(arrivalMs - travelSecs * 1000);
    }

    function fmtHms(ms) {
        var t = Math.max(0, Math.floor(ms / 1000));
        var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
        return h + "h " + (m < 10 ? "0" : "") + m + "m " + (s < 10 ? "0" : "") + s + "s";
    }

    function fmtTime(ms) {
        var d = new Date(ms);
        var now = new Date();
        var dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        var nDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        var diff = Math.round((dDay - nDay) / 86400000);
        var prefix = diff === 0 ? "heute" : diff === 1 ? "morgen" : d.toLocaleDateString([], {day:"2-digit",month:"2-digit"});
        return prefix + " " + d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
    }

    var PENDING_KEY = "lp_pending_attack";
    var PENDING_COOKIE = "lp_pending_attack";
    function setCookie(name, value, maxAgeSec) {
        document.cookie = name + "=" + encodeURIComponent(value) + "; path=/; max-age=" + maxAgeSec + "; SameSite=Lax";
    }
    function getCookie(name) {
        var key = name + "=";
        var parts = document.cookie ? document.cookie.split(";") : [];
        for (var i = 0; i < parts.length; i++) {
            var c = parts[i].trim();
            if (c.indexOf(key) === 0) return decodeURIComponent(c.substring(key.length));
        }
        return null;
    }
    function clearCookie(name) {
        document.cookie = name + "=; path=/; max-age=0; SameSite=Lax";
    }
    function savePendingAttack(pending) {
        try { window.name = "LP:" + JSON.stringify(pending); } catch(e) {}
        try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch(e) {}
        try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch(e) {}
        try { setCookie(PENDING_COOKIE, JSON.stringify(pending), 1800); } catch(e) {}
    }
    function loadPendingAttack() {
        var pending = null;
        try {
            if (window.name && window.name.indexOf("LP:") === 0) {
                pending = JSON.parse(window.name.slice(3));
            }
        } catch(e) {}
        if (pending && pending.arrivalMs) return pending;

        try {
            var ss = sessionStorage.getItem(PENDING_KEY);
            if (ss) pending = JSON.parse(ss);
        } catch(e) {}
        if (pending && pending.arrivalMs) return pending;

        try {
            var raw = localStorage.getItem(PENDING_KEY);
            if (raw) pending = JSON.parse(raw);
        } catch(e) {}
        if (pending && pending.arrivalMs) return pending;

        try {
            var ck = getCookie(PENDING_COOKIE);
            if (ck) pending = JSON.parse(ck);
        } catch(e) {}
        return (pending && pending.arrivalMs) ? pending : null;
    }
    function clearPendingAttack() {
        try { window.name = ""; } catch(e) {}
        try { sessionStorage.removeItem(PENDING_KEY); } catch(e) {}
        try { localStorage.removeItem(PENDING_KEY); } catch(e) {}
        try { clearCookie(PENDING_COOKIE); } catch(e) {}
    }

    function buildUrl(a) {
        var p = "/game.php?village=" + a.originId + "&screen=place";
        if (isSupport(a)) p += "&mode=support";
        p += "&target=" + a.targetId;
        for (var u in a.troops) {
            if (a.troops[u] > 0) p += "&" + u + "=" + a.troops[u];
        }
        return p;
    }

    // TribalWars.redirect = AJAX swap (script survives); fall back to location.href
    function navigate(url) {
        if (typeof TribalWars !== "undefined" && TribalWars.redirect) {
            TribalWars.redirect(url);
            return;
        }
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

    function troopsHtml(troops) {
        return Object.keys(troops)
            .filter(function(u){ return troops[u] > 0; })
            .map(function(u){
                return "<img src='/graphic/unit/unit_" + u + ".png' title='" + u + "' style='width:18px;height:18px;vertical-align:middle;'> " + troops[u];
            })
            .join(" &nbsp;");
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

    // === Sticky countdown widget (shown after mobile Senden, persists across pages) ===
    function showCountdownWidget(pending) {
        $("#lp-widget").remove();

        var widget = $("<div id='lp-widget' style='position:fixed;top:0;left:0;right:0;z-index:99999;background:#5a1f00;color:#ffe8c0;padding:8px 12px;font-family:Verdana;font-size:13px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;box-sizing:border-box;box-shadow:0 2px 6px rgba(0,0,0,0.5);'></div>");

        var cdLabel = pending.sendMs ? "Losschicken in" : "Ankunft in";
        var cdSpan  = $("<span style='font-size:16px;font-weight:bold;'>--</span>");
        var info    = $("<div style='flex:1;min-width:160px;line-height:1.7;'></div>");
        info.append("<div><b>Ziel:</b> " + (pending.targetLabel || pending.targetId) + "</div>");
        info.append($("<div></div>").append("<b>" + cdLabel + ":</b> &nbsp;").append(cdSpan));
        if (pending.sendMs) {
            info.append("<div style='font-size:11px;opacity:0.8;'>⚑ " + fmtTime(pending.sendMs) + " &nbsp; ⚐ " + fmtTime(pending.arrivalMs) + "</div>");
        } else {
            info.append("<div style='font-size:11px;opacity:0.8;'>⚐ Ankunft: " + fmtTime(pending.arrivalMs) + "</div>");
        }

        var confirmBtn = $("<button style='min-height:40px;padding:6px 14px;font-size:13px;background:#afa;border:1px solid #060;border-radius:3px;cursor:pointer;font-weight:bold;'>✓ Gesendet</button>");
        var dismissBtn = $("<button style='min-height:40px;padding:6px 10px;font-size:13px;background:transparent;color:#ffe8c0;border:1px solid #ffe8c0;border-radius:3px;cursor:pointer;'>✕</button>");

        function closeWidget() {
            clearPendingAttack();
            widget.remove();
            if (window._lpWidgetInt) clearInterval(window._lpWidgetInt);
        }

        confirmBtn.on("click", function() {
            confirmBtn.text("...").prop("disabled", true);
            githubGet(function(data) {
                if (!data || !data.attacks) { closeWidget(); return; }
                var plan = data.attacks;
                var att = plan.find(function(a){
                    return a.id === pending.id ||
                        (a.originId === pending.originId && a.targetId === pending.targetId && a.arrivalMs === pending.arrivalMs);
                });
                if (att) { att.sent = true; att.sentBy = ME; att.sentAt = Date.now(); }
                githubPut({ attacks: plan }, "gesendet: " + pending.originId + "->" + pending.targetId + " von " + ME, function(){
                    closeWidget();
                    if (currentPlan.length > 0) renderPlan(mergeSent(plan, currentPlan));
                });
            });
        });

        dismissBtn.on("click", closeWidget);

        widget.append(info).append(confirmBtn).append(dismissBtn);
        $("body").prepend(widget);

        if (window._lpWidgetInt) clearInterval(window._lpWidgetInt);
        window._lpWidgetInt = setInterval(function() {
            if (!$("#lp-widget").length) { clearInterval(window._lpWidgetInt); return; }
            var targetMs = pending.sendMs || pending.arrivalMs;
            var d = targetMs - serverNow();
            if (d <= 0) {
                cdSpan.text("JETZT SENDEN!").css("color", "#ff0");
            } else {
                cdSpan.text(fmtHms(d));
            }
        }, 500);
    }

    // === FarmGod-style in-page overlay for attack screen ===
    function injectAttackOverlay(p) {
        $("#lp-overlay").remove();

        var sendMs   = p.sendMs   || null;
        var cdTarget = sendMs || p.arrivalMs;
        var fromLabel = p.originLabel || ("Dorf " + p.originId);
        var toLabel   = p.targetLabel || ("Dorf " + p.targetId);

        var overlay = $("<div id='lp-overlay' style='background:#f4e4bc;border:2px solid #804000;border-radius:6px;padding:12px;margin:0 0 10px 0;font-family:Verdana;box-sizing:border-box;'></div>");

        var overlayTitle = (p.type === "support") ? "Angriffsplaner — Unterstützung" : "Angriffsplaner — ausstehend";
        overlay.append("<div style='font-size:10px;font-weight:bold;color:#804000;margin-bottom:8px;letter-spacing:1px;text-transform:uppercase;'>" + overlayTitle + "</div>");

        overlay.append(
            "<div style='font-size:12px;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' title='" + fromLabel + " → " + toLabel + "'>" +
            fromLabel + " <span style='color:#804000;'>→</span> " + toLabel +
            "</div>"
        );

        var bHtml = buildingHtml(p.catapultTarget, p.troops);
        if (bHtml) overlay.append("<div style='font-size:11px;color:#804000;margin-bottom:8px;'>⚙&nbsp;" + bHtml + "</div>");

        var cdLabel = sendMs ? "Losschicken in" : "Ankunft in";
        overlay.append(
            "<div style='background:#5a1f00;color:#ffe8c0;border-radius:4px;padding:8px 12px;margin-bottom:8px;text-align:center;'>" +
            "<div style='font-size:10px;letter-spacing:1px;text-transform:uppercase;opacity:0.75;margin-bottom:3px;'>" + cdLabel + "</div>" +
            "<div style='font-size:28px;font-weight:bold;'><span class='cd' data-target='" + cdTarget + "'>--</span></div>" +
            "</div>"
        );

        var timesDiv = "<div style='font-size:11px;color:#555;margin-bottom:10px;line-height:1.9;'>";
        if (sendMs) timesDiv += "<div>⚑ <b>Senden:</b> " + fmtTime(sendMs) + "</div>";
        timesDiv += "<div>⚐ <b>Ankunft:</b> " + fmtTime(p.arrivalMs) + "</div>";
        timesDiv += "</div>";
        overlay.append(timesDiv);

        var confirmBtn = $("<button style='width:100%;min-height:44px;padding:8px;font-size:14px;font-weight:bold;background:#afa;border:1px solid #080;border-radius:4px;cursor:pointer;box-sizing:border-box;margin-bottom:6px;'>✓ Gesendet</button>");
        confirmBtn.on("click", function() {
            confirmBtn.text("...").prop("disabled", true);
            githubGet(function(data) {
                if (!data || !data.attacks) { clearPendingAttack(); overlay.remove(); return; }
                var plan = data.attacks;
                var att = plan.find(function(a){
                    return a.id === p.id ||
                        (a.originId === p.originId && a.targetId === p.targetId && String(a.arrivalMs) === String(p.arrivalMs));
                });
                if (att) { att.sent = true; att.sentBy = ME; att.sentAt = Date.now(); }
                githubPut({ attacks: plan }, "gesendet: " + p.originId + "->" + p.targetId + " von " + ME, function(){
                    clearPendingAttack();
                    if (window._lpInt) clearInterval(window._lpInt);
                    overlay.html("<div style='color:#080;font-size:14px;font-weight:bold;padding:10px 0;text-align:center;'>✓ Als gesendet markiert.</div>");
                });
            });
        });
        overlay.append(confirmBtn);

        var dismissBtn = $("<button style='width:100%;min-height:36px;font-size:12px;background:transparent;border:1px solid #a07030;border-radius:3px;cursor:pointer;color:#804000;'>✕ Schließen</button>");
        dismissBtn.on("click", function() {
            clearPendingAttack();
            overlay.remove();
            if (window._lpInt) clearInterval(window._lpInt);
        });
        overlay.append(dismissBtn);

        mount.prepend(overlay);
    }

    // === Action handlers ===
    function makeSendHandler(att) {
        return function() {
            var url = buildUrl(att);
            var sendMs = getSendMs(att);
            att.sent = true;
            att.sentBy = ME;
            att.sentAt = Date.now();
            savePendingAttack({
                id: att.id, originId: att.originId, targetId: att.targetId,
                originLabel: villageLabel(att.originId),
                targetLabel: villageLabel(att.targetId),
                arrivalMs: att.arrivalMs, sendMs: sendMs,
                type: isSupport(att) ? "support" : "attack",
                catapultTarget: att.catapultTarget || null,
                troops: att.troops || null
            });
            setStatus("Markiere als gesendet...");
            githubPut({ attacks: currentPlan }, "gesendet: " + att.originId + "->" + att.targetId + " von " + ME, function(){
                setStatus("Status synchronisiert.", "green");
                renderPlan(currentPlan);
                navigate(url);
            });
        };
    }

    function makeRevokeHandler(att) {
        return function() {
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
        var unsent = plan.filter(function(a){ return !a.sent; });
        var sent   = plan.filter(function(a){ return a.sent; });

        unsent.forEach(function(att) {
            var idx = plan.indexOf(att);
            var sendMs = getSendMs(att);
            var cdTarget = sendMs || att.arrivalMs;

            var card = $("<div class='lp-card' style='border:1px solid #a07030;background:#fff8e8;border-radius:6px;padding:10px;margin:8px 0;box-sizing:border-box;'></div>");

            // Header: index + from / to on separate lines — no mid-arrow wrapping
            card.append(
                "<div style='margin-bottom:6px;'>" +
                  "<div style='font-size:11px;font-weight:bold;color:#804000;margin-bottom:2px;'>#" + (idx + 1) + "</div>" +
                  "<div style='font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' title='" + villageLabel(att.originId) + "'>" + villageLabel(att.originId) + "</div>" +
                  "<div style='font-size:11px;color:#a07030;margin:1px 0;'>↓</div>" +
                  "<div style='font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' title='" + villageLabel(att.targetId) + "'>" + villageLabel(att.targetId) + "</div>" +
                "</div>"
            );

            // Troops
            var tHtml = troopsHtml(att.troops);
            if (tHtml) card.append("<div style='margin-bottom:8px;line-height:1.8;'>" + tHtml + "</div>");

            var bHtml = buildingHtml(att.catapultTarget, att.troops);
            if (bHtml) card.append("<div style='font-size:11px;color:#804000;margin-bottom:8px;'>⚙&nbsp;" + bHtml + "</div>");

            // Countdown box — prominent
            var cdLabel = sendMs ? "Losschicken in" : "Ankunft in";
            card.append("<div style='background:#5a1f00;color:#ffe8c0;border-radius:4px;padding:6px 8px;margin-bottom:6px;text-align:center;'>" +
                "<div style='font-size:10px;letter-spacing:1px;text-transform:uppercase;opacity:0.75;margin-bottom:2px;'>" + cdLabel + "</div>" +
                "<div style='font-size:22px;font-weight:bold;letter-spacing:1px;'><span class='cd' data-target='" + cdTarget + "'>--</span></div>" +
                "</div>");

            // Send time + arrival — each on its own line, no wrapping surprises
            var timesDiv = "<div style='font-size:11px;color:#555;margin-bottom:8px;line-height:1.8;'>";
            if (sendMs) timesDiv += "<div>⚑&nbsp;<b>Senden:</b> " + fmtTime(sendMs) + "</div>";
            timesDiv += "<div style='opacity:0.7;'>⚐&nbsp;<b>Ankunft:</b> " + fmtTime(att.arrivalMs) + "</div>";
            timesDiv += "</div>";
            card.append(timesDiv);

            // Send button
            var supp = isSupport(att);
            var sendBtn = $("<button style='width:100%;min-height:44px;padding:8px;font-size:14px;font-weight:bold;background:#afa;border:1px solid #080;border-radius:4px;cursor:pointer;box-sizing:border-box;'>" + (supp ? "Unterstützen" : "Senden") + "</button>");
            sendBtn.on("click", function() {
                savePendingAttack({
                    id: att.id, originId: att.originId, targetId: att.targetId,
                    originLabel: villageLabel(att.originId),
                    targetLabel: villageLabel(att.targetId),
                    arrivalMs: att.arrivalMs, sendMs: sendMs,
                    type: supp ? "support" : "attack",
                    catapultTarget: att.catapultTarget || null,
                troops: att.troops || null
                });
                navigate(buildUrl(att));
            });
            card.append(sendBtn);
            tableContainer.append(card);
        });

        if (sent.length > 0) {
            var toggleBtn = $("<button style='width:100%;margin:8px 0;padding:8px;font-size:12px;background:#e0d4b0;border:1px solid #a07030;border-radius:4px;cursor:pointer;'>" + sent.length + " gesendete Angriffe anzeigen ▼</button>");
            var sentContainer = $("<div style='display:none;'></div>");

            sent.forEach(function(att) {
                var idx = plan.indexOf(att);
                var sCard = $("<div class='lp-card' style='border:1px solid #bbb;background:#e8e8e8;border-radius:4px;padding:8px;margin:4px 0;opacity:0.75;box-sizing:border-box;'></div>");
                sCard.append("<div style='font-size:12px;margin-bottom:4px;word-break:break-word;'>" +
                    "<b>#" + (idx + 1) + " ✓</b> &nbsp;" + villageLabel(att.originId) + " → " + villageLabel(att.targetId) +
                    "</div>");
                sCard.append("<div style='font-size:11px;color:#080;margin-bottom:6px;'>Gesendet von <b>" + (att.sentBy || "?") + "</b></div>");
                var revokeBtn = $("<button style='width:100%;min-height:36px;font-size:12px;background:#fcc;border:1px solid #a00;border-radius:3px;cursor:pointer;'>Zurücksetzen</button>");
                revokeBtn.on("click", makeRevokeHandler(att));
                sCard.append(revokeBtn);
                sentContainer.append(sCard);
            });

            var expanded = false;
            toggleBtn.on("click", function() {
                expanded = !expanded;
                sentContainer.toggle(expanded);
                toggleBtn.text(expanded ? "Gesendete ausblenden ▲" : sent.length + " gesendete Angriffe anzeigen ▼");
            });
            tableContainer.append(toggleBtn).append(sentContainer);
        }
    }

    // === Render: table layout for desktop ===
    function renderTable(plan) {
        var thead = "<thead><tr>" +
            "<th style='width:24px;'>#</th>" +
            "<th>Von → Nach</th>" +
            "<th>Truppen</th>" +
            "<th style='width:100px;'>Losschicken in</th>" +
            "<th style='width:120px;'>Senden / Ankunft</th>" +
            "<th style='width:90px;'>Status</th>" +
            "<th style='width:80px;'>Aktion</th>" +
            "</tr></thead>";

        function makeRow(att, i) {
            var sendMs = getSendMs(att);
            var cdTarget = sendMs || att.arrivalMs;
            var bHtml = buildingHtml(att.catapultTarget, att.troops);
            var routeHtml =
                "<div style='font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' title='" + villageLabel(att.originId) + "'>" + villageLabel(att.originId) + "</div>" +
                "<div style='font-size:10px;color:#a07030;'>↓</div>" +
                "<div style='font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' title='" + villageLabel(att.targetId) + "'>" + villageLabel(att.targetId) + "</div>" +
                (bHtml ? "<div style='font-size:10px;color:#804000;margin-top:2px;'>⚙&nbsp;" + bHtml + "</div>" : "");
            var timesHtml = sendMs
                ? ("<div style='font-size:10px;white-space:nowrap;'>⚑ " + fmtTime(sendMs) + "</div>" +
                   "<div style='font-size:10px;white-space:nowrap;opacity:0.65;'>⚐ " + fmtTime(att.arrivalMs) + "</div>")
                : ("<div style='font-size:10px;white-space:nowrap;'>⚐ " + fmtTime(att.arrivalMs) + "</div>");
            var cdCell = att.sent
                ? "<td style='color:#999;text-align:center;'>—</td>"
                : "<td class='cd' data-target='" + cdTarget + "' style='text-align:center;font-weight:bold;white-space:nowrap;font-size:12px;'>--</td>";
            var statusHtml = att.sent ? "<span style='color:#080;font-size:11px;'>✓ " + (att.sentBy || "?") + "</span>" : "";
            var row = $("<tr>" +
                "<td style='text-align:center;font-size:11px;'>" + (i + 1) + "</td>" +
                "<td>" + routeHtml + "</td>" +
                "<td style='font-size:11px;'>" + troopsHtml(att.troops) + "</td>" +
                cdCell +
                "<td>" + timesHtml + "</td>" +
                "<td>" + statusHtml + "</td>" +
                "<td style='text-align:center;'></td>" +
                "</tr>");
            if (att.sent) row.css({ background: "#e8e8e8", opacity: "0.7" });
            var actionCell = row.find("td").last();
            if (!att.sent) {
                var sendBtn = $("<button class='btn'>" + (isSupport(att) ? "Unterstützen" : "Senden") + "</button>");
                sendBtn.on("click", makeSendHandler(att));
                actionCell.append(sendBtn);
            } else {
                var revokeBtn = $("<button style='background:#fcc;font-size:11px;'>Zurücksetzen</button>");
                revokeBtn.on("click", makeRevokeHandler(att));
                actionCell.append(revokeBtn);
            }
            return row;
        }

        var unsent = plan.filter(function(a){ return !a.sent; });
        var sent   = plan.filter(function(a){ return a.sent; });

        var table = $("<table class='vis' style='width:100%;table-layout:fixed;'>" + thead + "<tbody></tbody></table>");
        var tbody = table.find("tbody");
        unsent.forEach(function(att){ tbody.append(makeRow(att, plan.indexOf(att))); });
        tableContainer.append(table);

        if (sent.length > 0) {
            var toggleBtn = $("<button style='width:100%;margin:8px 0;padding:6px;font-size:12px;background:#e0d4b0;border:1px solid #a07030;border-radius:4px;cursor:pointer;'>" + sent.length + " gesendete Angriffe anzeigen ▼</button>");
            var sentTable = $("<table class='vis' style='width:100%;table-layout:fixed;display:none;'>" + thead + "<tbody></tbody></table>");
            var sentBody = sentTable.find("tbody");
            sent.forEach(function(att){ sentBody.append(makeRow(att, plan.indexOf(att))); });
            var expanded = false;
            toggleBtn.on("click", function() {
                expanded = !expanded;
                sentTable.toggle(expanded);
                toggleBtn.text(expanded ? "Gesendete ausblenden ▲" : sent.length + " gesendete Angriffe anzeigen ▼");
            });
            tableContainer.append(toggleBtn).append(sentTable);
        }
    }

    function renderPlan(plan) {
        currentPlan = plan;
        loadBuildingIds(plan);
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
    var pushConfirmed = false, pushTimer = null;
    pushBtn.on("click", function() {
        var src = textarea.val().trim();
        if (!src) { setStatus("Bitte zuerst Angriffe einfügen.", "red"); return; }
        var plan = src.split("\n").map(parseLine).filter(Boolean);
        if (plan.length === 0) { setStatus("Keine gültigen Angriffe.", "red"); return; }
        if (!pushConfirmed) {
            pushConfirmed = true;
            pushBtn.text("Sicher? (" + plan.length + ")");
            setStatus("Überschreibt geteilten Plan für alle — nochmal tippen zum Bestätigen.", "orange");
            clearTimeout(pushTimer);
            pushTimer = setTimeout(function(){ pushConfirmed = false; pushBtn.text("Plan hochladen"); setStatus(""); }, 3000);
            return;
        }
        clearTimeout(pushTimer);
        pushConfirmed = false;
        pushBtn.text("Plan hochladen");
        loadData(function(){
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
        loadData(function(){
            setStatus("Aktualisiere...");
            githubGet(function(data){
                if (!data || !data.attacks) { renderPlan([]); setStatus("Kein Plan auf GitHub.", "orange"); return; }
                renderPlan(data.attacks);
                setStatus("Aktualisiert.", "green");
            });
        });
    });

    var wipeConfirmed = false, wipeTimer = null;
    wipeBtn.on("click", function() {
        if (!wipeConfirmed) {
            wipeConfirmed = true;
            wipeBtn.text("Sicher?");
            setStatus("Löscht Plan für alle — nochmal tippen zum Bestätigen.", "orange");
            clearTimeout(wipeTimer);
            wipeTimer = setTimeout(function(){ wipeConfirmed = false; wipeBtn.text("Plan löschen"); setStatus(""); }, 3000);
            return;
        }
        clearTimeout(wipeTimer);
        wipeConfirmed = false;
        wipeBtn.text("Plan löschen");
        githubGet(function(){ githubDelete(); });
    });

    // === Screen-change handler — called after any TW navigation ===
    function handleScreenReady() {
        var p = loadPendingAttack();
        var screen = (typeof game_data !== "undefined") ? game_data.screen : null;
        if (!screen) return;

        mount = $("#contentContainer").length ? $("#contentContainer") : $("body");

        var villageId = (typeof game_data !== "undefined" && game_data.village) ? String(game_data.village.id) : null;
        var onPlace = p && screen === "place" && villageId === String(p.originId);

        if (onPlace && !$("#lp-overlay").length) {
                injectAttackOverlay(p);
            if (window._lpInt) clearInterval(window._lpInt);
            window._lpInt = setInterval(function() {
                var now = serverNow();
                $("#lp-overlay .cd").each(function(){
                    var t = parseInt($(this).data("target"));
                    var d = t - now;
                    if (d <= 0) {
                        $(this).text(Math.abs(d) < 120000 ? "JETZT!" : "zu spät").css({ color: "#ff0", fontWeight: "bold" });
                    } else {
                        $(this).text(fmtHms(d));
                    }
                });
            }, 200);
        } else if (!onPlace && !$("#launchpad-panel").length) {
            mount.prepend(panel);
            tableContainer.empty();
            loadData(function(){
                githubGet(function(data){
                    if (data && data.attacks) renderPlan(data.attacks);
                });
            });
            if (p && p.arrivalMs && !$("#lp-widget").length) showCountdownWidget(p);
        } else if (!onPlace && p && p.arrivalMs && !$("#lp-widget").length) {
            showCountdownWidget(p);
        }
    }

    // === Navigation detection ===
    // TribalWars.redirect uses native XHR — ajaxComplete never fires for it.
    // Use MutationObserver on #contentContainer as primary trigger.
    var _lpNavTimer = null;
    function scheduleScreenCheck() {
        clearTimeout(_lpNavTimer);
        _lpNavTimer = setTimeout(handleScreenReady, 300);
    }

    var _lpObserver = new MutationObserver(scheduleScreenCheck);
    var _lpCC = document.getElementById("contentContainer");
    if (_lpCC) {
        _lpObserver.observe(_lpCC, { childList: true });
        // Also watch the parent in case TW replaces #contentContainer itself
        if (_lpCC.parentElement) {
            new MutationObserver(function(mutations) {
                mutations.forEach(function(m) {
                    m.addedNodes.forEach(function(node) {
                        if (node.id === "contentContainer") {
                            _lpObserver.disconnect();
                            _lpObserver.observe(node, { childList: true });
                        }
                    });
                });
            }).observe(_lpCC.parentElement, { childList: true });
        }
    }

    // ajaxComplete as fallback (fires for jQuery-based TW requests if any)
    $(document).off("ajaxComplete.lp").on("ajaxComplete.lp", function(_e, xhr) {
        if (xhr && xhr.status === 0) return; // skip aborted requests
        scheduleScreenCheck();
    });

    if (onAttackScreen) {
        // === Initial load already on the place screen (quickbar re-ran after full reload) ===
        injectAttackOverlay(pending);
        if (window._lpInt) clearInterval(window._lpInt);
        window._lpInt = setInterval(function() {
            var now = serverNow();
            $("#lp-overlay .cd").each(function(){
                var t = parseInt($(this).data("target"));
                var d = t - now;
                if (d <= 0) {
                    $(this).text(Math.abs(d) < 120000 ? "JETZT!" : "zu spät").css({ color: "#ff0", fontWeight: "bold" });
                } else {
                    $(this).text(fmtHms(d));
                }
            });
        }, 200);
    } else {
        // === Normal mode: full panel ===
        mount.prepend(panel);

        if (pending && pending.arrivalMs) showCountdownWidget(pending);

        loadData(function(){
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

        if (window._lpInt) clearInterval(window._lpInt);
        window._lpInt = setInterval(function() {
            var now = serverNow();
            $("#launchpad-panel .cd").each(function(){
                var t = parseInt($(this).data("target"));
                var d = t - now;
                if (d <= 0) {
                    var late = Math.abs(d);
                    if (late < 120000) {
                        $(this).text("JETZT!").css({ color: "#ff0", fontWeight: "bold", textShadow: "0 0 4px #f80" });
                    } else {
                        $(this).text("zu spät").css({ color: "#f44", fontWeight: "bold" });
                    }
                    var container = $(this).closest("tr,.lp-card");
                    if (!container.hasClass("sent-row")) container.css("background", "#d4ffd4");
                } else {
                    $(this).text(fmtHms(d));
                }
            });
        }, 200);
    }
})();
