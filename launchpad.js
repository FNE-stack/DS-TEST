(function(){
    $("#launchpad-panel").remove();

    // === CONFIG ===
    var VERSION = "v96";
    var GITHUB_OWNER = "FNE-stack";
    var GITHUB_REPO = "DS-TEST";
    var GITHUB_BRANCH = "main";
    var GITHUB_TOKEN = window.LAUNCHPAD_TOKEN || "";
    var _playerName = (typeof game_data !== "undefined" && game_data.player && game_data.player.name)
                      ? game_data.player.name : "unknown";
    var GITHUB_FILE     = _playerName + ".json";
    var GITHUB_BOT_FILE = _playerName + "_bot.json";
    var GITHUB_API     = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + encodeURIComponent(GITHUB_FILE);
    var GITHUB_BOT_API = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + encodeURIComponent(GITHUB_BOT_FILE);
    var AUTO_REFRESH_MS = 15000;

    var villageMap = {};
    var currentSha = null;
    var currentPlan = [];
    var isWriting = false;
    var botEnabled = true;
    var botControlSha = null;

    // Panel session flag — set on every quickbar tap, survives page reloads via sessionStorage
    // so the panel re-appears automatically after each navigation while the script is alive.
    try { sessionStorage.setItem("lp_panel_open", "1"); } catch(e) {}
    var panelOpen = true;

    // Reset Auto-Senden + jump flags at every quickbar tap — fresh start each session
    try { sessionStorage.removeItem("lp_autosend"); } catch(e) {}
    try { sessionStorage.removeItem("lp_jump_confirm"); } catch(e) {}

    function isMobile() { return window.innerWidth < 700; }

    // === UI ===
    var panel = $("<div id='launchpad-panel' style='background:#f4e4bc;border:1px solid #804000;padding:10px;margin:8px 0;font-family:Verdana;max-width:100%;box-sizing:border-box;'></div>");
    panel.append("<h3 style='margin:0 0 8px 0;font-size:14px;'>Angriffsplaner (geteilt) <span style='font-size:11px;color:#888;font-weight:normal;'>" + VERSION + "</span></h3>");

    var textarea = $("<textarea style='width:100%;height:80px;font-family:monospace;font-size:11px;box-sizing:border-box;'></textarea>");

    var btnStyle = "margin:4px 4px 0 0;min-height:38px;padding:6px 10px;font-size:13px;";
    var pushBtn    = $("<button style='" + btnStyle + "'>Plan hochladen</button>");
    var refreshBtn = $("<button style='" + btnStyle + "'>Aktualisieren</button>");
    var wipeBtn    = $("<button style='" + btnStyle + "background:#fcc;'>Plan löschen</button>");
    var botToggleBtn = $("<button style='" + btnStyle + "background:#afa;'>AN</button>");
    var btnRow     = $("<div style='display:flex;flex-wrap:wrap;'></div>").append(pushBtn).append(refreshBtn).append(wipeBtn).append(botToggleBtn);

    var status = $("<div style='margin-top:6px;font-size:12px;color:#555;'></div>");
    var tableContainer = $("<div style='overflow-x:auto;max-width:100%;'></div>");

    var panelBody = $("<div></div>")
        .append("<div style='margin-bottom:5px;font-size:12px;'>Plan einfügen und Hochladen, oder Aktualisieren:</div>")
        .append(textarea).append(btnRow)
        .append(status).append(tableContainer);

    var toggleBody = $("<span style='cursor:pointer;font-size:12px;color:#804000;float:right;margin-left:6px;'>▼</span>");
    var closePanel = $("<span style='cursor:pointer;font-size:12px;color:#804000;float:right;'>✕</span>");
    closePanel.on("click", function() {
        try { sessionStorage.removeItem("lp_panel_open"); } catch(e) {}
        panelOpen = false;
        panel.remove();
        if (window._lpAuto)       { clearInterval(window._lpAuto);       window._lpAuto       = null; }
        if (window._lpInt)        { clearInterval(window._lpInt);        window._lpInt        = null; }
        if (window._lpOverlayInt) { clearInterval(window._lpOverlayInt); window._lpOverlayInt = null; }
    });
    panel.find("h3").append(toggleBody).append(closePanel);
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

    // serverNow() returns server-time-in-ms, used by the auto-send timer to decide T=0.
    //
    // Two independent sources of the client→server offset:
    //   1. TW's Timing.offset_server — TW computes this from its own AJAX exchanges
    //   2. ourOffset — we measure it ourselves from HTTP Date headers on our pings
    //
    // We use the MOST-NEGATIVE (most conservative) of the two. The auto-send timer fires when
    // serverNow() >= sendMs. A more-negative offset makes serverNow() smaller, so the timer
    // fires LATER. That guarantees no early arrivals as long as EITHER source is correct:
    //   - If TW is wrong-positive (e.g. says 0 but actual is -1100ms) and ours catches it,
    //     min picks ours → fire on time.
    //   - If ours is wrong-positive and TW catches it, min picks TW.
    //   - Worst case both wrong-positive → still fires early (no fix possible without a
    //     trusted external time source).
    var ourOffset = null;
    var ourOffsetSamples = [];
    function serverNow() {
        var twOff = (typeof Timing !== "undefined" && typeof Timing.offset_server === "number")
                    ? Timing.offset_server : null;
        var off;
        if (twOff !== null && ourOffset !== null) {
            off = Math.min(twOff, ourOffset);
            if (Math.abs(twOff - ourOffset) > 1000) {
                // Big disagreement — log once-ish so the user notices something's up
                console.warn("[lp v96] server offset mismatch — TW:" + twOff + " ours:" + ourOffset +
                             " using:" + off);
            }
        } else if (twOff !== null) {
            off = twOff;
        } else if (ourOffset !== null) {
            off = ourOffset;
        } else {
            off = 0;
        }
        return Date.now() + off;
    }

    // Half-RTT (ping) measurement + server-time offset measurement, sharing a single fetch.
    // Median over rolling 7 samples to absorb network jitter and Date-header second-rounding.
    var halfRTT = 0;
    var rttSamples = [];
    var HALF_RTT_CAP = 100;
    function measureHalfRTT() {
        var localStart = Date.now();
        var perfT0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : localStart;
        fetch("/game.php", { method: "HEAD", credentials: "include", cache: "no-store" })
            .then(function(r){
                var localEnd = Date.now();
                var perfT1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : localEnd;

                // Update half-RTT (median of recent samples)
                rttSamples.push((perfT1 - perfT0) / 2);
                if (rttSamples.length > 7) rttSamples.shift();
                var sorted = rttSamples.slice().sort(function(a,b){ return a-b; });
                var median = sorted[Math.floor(sorted.length / 2)];
                halfRTT = Math.min(HALF_RTT_CAP, Math.max(0, Math.round(median)));

                // Measure our own server-time offset from HTTP Date header (second precision —
                // it's noisy, but median of 7 samples washes most of that out).
                var dateHdr = r.headers && r.headers.get ? r.headers.get("Date") : null;
                if (dateHdr) {
                    var serverT = new Date(dateHdr).getTime();
                    if (!isNaN(serverT)) {
                        var clientMid = localStart + (localEnd - localStart) / 2;
                        ourOffsetSamples.push(serverT - clientMid);
                        if (ourOffsetSamples.length > 7) ourOffsetSamples.shift();
                        var oSorted = ourOffsetSamples.slice().sort(function(a,b){ return a-b; });
                        ourOffset = Math.round(oSorted[Math.floor(oSorted.length / 2)]);
                    }
                }
            })
            .catch(function(){});
    }
    measureHalfRTT();
    setInterval(measureHalfRTT, 5000);

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

        var travelSecs = Math.round(dist * slowestMpf * 60 / (worldSpeed * unitSpeed));
        return arrivalMs - travelSecs * 1000;
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
        var p = "/game.php?village=" + a.originId + "&screen=place&target=" + a.targetId;
        for (var u in a.troops) {
            if (a.troops[u] > 0) p += "&" + u + "=" + a.troops[u];
        }
        return p;
    }

    // Send an attack/support without navigating: GET the place screen to obtain the real form
    // (incl. CSRF token), POST it to get the confirm page, POST that to actually send.
    // Script never navigates, never dies. Falls back via onError() if any step fails.
    function parseDoc(html) {
        return new DOMParser().parseFromString(html, "text/html");
    }
    function findConfirmForm(doc) {
        var forms = doc.body.querySelectorAll("form");
        for (var i = 0; i < forms.length; i++) {
            var f = forms[i];
            var act = f.getAttribute("action") || "";
            var hasConfirmFlag = act.indexOf("try=confirm") >= 0 ||
                                 f.querySelector("input[name='try'][value='confirm']");
            if (!hasConfirmFlag) continue;
            // A REAL confirm form has populated x/y. TW's attack-sent page often includes a
            // "prepare another attack" stub form with try=confirm but empty x/y — we used to
            // misread those as "TW rejected us" → confirm-rejected false positives.
            var xv = (f.querySelector("input[name='x']") || {}).value || "";
            var yv = (f.querySelector("input[name='y']") || {}).value || "";
            if (!String(xv).trim() || !String(yv).trim()) continue;
            return f;
        }
        return null;
    }

    // jQuery form → confirm-form detection. Used in the live DOM. Same heuristic plus a fallback:
    // confirm forms keep all troop inputs hidden; place forms show them as type=number/text.
    var TROOPS = ["spear","sword","axe","archer","spy","light","marcher","heavy","ram","catapult","knight","snob"];
    function isConfirmFormJq($f) {
        if (!$f || !$f.length) return false;
        var act = $f.attr("action") || "";
        if (act.indexOf("try=confirm") >= 0) return true;
        if ($f.find("input[name='try'][value='confirm']").length > 0) return true;
        // Fallback: place form has visible troop inputs, confirm doesn't
        for (var i = 0; i < TROOPS.length; i++) {
            if ($f.find("input[type='number'][name='" + TROOPS[i] + "']").length > 0) return false;
            if ($f.find("input[type='text'][name='" + TROOPS[i] + "']").length > 0) return false;
        }
        // Has x/y but no visible troop inputs → confirm
        return $f.find("input[name='x'], input[name='y']").length > 0;
    }
    function serializeForm(form) {
        var parts = [];
        var els = form.querySelectorAll("input:not([type=submit]):not([type=button]):not([type=image]),select,textarea");
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (el.disabled || !el.name) continue;
            if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
            parts.push(encodeURIComponent(el.name) + "=" + encodeURIComponent(el.value || ""));
        }
        return parts.join("&");
    }

    function fetchText(url, opts) {
        return fetch(url, Object.assign({ credentials: "include" }, opts || {}))
               .then(function(r) { return r.text(); });
    }

    // After we swap HTML in via innerHTML, <script> tags don't execute. TW's place screen has
    // inline scripts that finish populating the place form (CSRF h, x/y, JS-bound handlers) at
    // runtime — without re-running them the form is half-baked and a native submit gives
    // "Es muss ein gültiges Ziel angegeben werden" until the user hits F5.
    // Re-create each <script> node so the browser executes it on insertion.
    function runInlineScripts(rootEl) {
        if (!rootEl) return;
        var scripts = rootEl.querySelectorAll("script");
        for (var i = 0; i < scripts.length; i++) {
            var old = scripts[i];
            // Skip external scripts — libraries (jQuery etc.) are already loaded and re-running
            // them can wipe global state. Only inline scripts need execution here.
            if (old.src) continue;
            var n = document.createElement("script");
            n.textContent = old.textContent;
            try { old.parentNode.replaceChild(n, old); }
            catch(e) { console.warn("[lp v91] script re-exec failed:", e); }
        }
    }

    function submitAttackDirect(att, btnName, onSuccess, onError) {
        loadVillages(function() {
            // Step 1: GET place screen — use fetch (no X-Requested-With) so TW gives full HTML
            fetchText(buildUrl(att))
            .then(function(html) {
                var doc = parseDoc(html);
                var placeForm = null;
                var forms = doc.body.querySelectorAll("form");
                for (var i = 0; i < forms.length; i++) {
                    if (forms[i].querySelector("input[name='x'], input[name='y']")) {
                        placeForm = forms[i]; break;
                    }
                }
                if (!placeForm) { onError("no-form"); return; }

                // Ensure troop values match att.troops (handles 'axe' and 'unit_axe' naming)
                var troops = att.troops || {};
                Object.keys(troops).forEach(function(u) {
                    var el = placeForm.querySelector("input[name='" + u + "']") ||
                             placeForm.querySelector("input[name='unit_" + u + "']");
                    if (el) el.value = troops[u] || 0;
                });
                if (att.catapultTarget && att.catapultTarget !== "0") {
                    var bld = placeForm.querySelector("select[name='building']");
                    if (bld) bld.value = att.catapultTarget;
                }

                var action = placeForm.getAttribute("action") || "/game.php";
                var data = serializeForm(placeForm) + "&" + encodeURIComponent(btnName) + "=1";

                // Step 2: POST place form → should get confirm page
                fetchText(action, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: data
                })
                .then(function(confirmHtml) {
                    var cForm = findConfirmForm(parseDoc(confirmHtml));
                    if (!cForm) { onError("no-confirm"); return; }

                    var cAction = cForm.getAttribute("action") || action;
                    var cData = serializeForm(cForm) + "&attack=1";

                    // Step 3: POST confirm form → attack sent
                    fetchText(cAction, {
                        method: "POST",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: cData
                    })
                    .then(function(finalHtml) {
                        var finalDoc = parseDoc(finalHtml);
                        if (findConfirmForm(finalDoc)) { onError("confirm-rejected"); return; }
                        // Catch TW error pages that have no confirm form but also didn't send
                        var errEl = finalDoc.querySelector(".error_box, #error_message, .system_error");
                        if (errEl && errEl.textContent.trim()) { onError("tw-error"); return; }
                        onSuccess();
                    })
                    .catch(function() { onError("step3"); });
                })
                .catch(function() { onError("step2"); });
            })
            .catch(function() { onError("step1"); });
        });
    }

    // Navigate to the confirm screen for an attack: fetch place screen, POST the place form,
    // swap the confirm HTML into #contentContainer (preserving #lp-overlay), update URL+game_data.
    // Script stays alive throughout. All requests via fetch (no XHR header) so TW returns full HTML.
    function navigateToConfirm(att, btnNameOverride, onSuccess, onError) {
        var btnName = btnNameOverride || ((att.type === "support") ? "support" : "attack");
        var placeUrl = buildUrl(att);
        console.log("[lp v82] navigateToConfirm START", { url: placeUrl, btnName: btnName, att: att });
        loadVillages(function() {
            fetchText(placeUrl)
            .then(function(placeHtml) {
                console.log("[lp v82] step1 GET place OK, len=" + placeHtml.length);
                var pDoc = parseDoc(placeHtml);
                var placeForm = null;
                var forms = pDoc.body.querySelectorAll("form");
                for (var i = 0; i < forms.length; i++) {
                    if (forms[i].querySelector("input[name='x'], input[name='y']")) {
                        placeForm = forms[i]; break;
                    }
                }
                if (!placeForm) throw new Error("no-place-form");

                var troops = att.troops || {};
                Object.keys(troops).forEach(function(u) {
                    var el = placeForm.querySelector("input[name='" + u + "']") ||
                             placeForm.querySelector("input[name='unit_" + u + "']");
                    if (el) el.value = troops[u] || 0;
                });
                if (att.catapultTarget && att.catapultTarget !== "0") {
                    var bld = placeForm.querySelector("select[name='building']");
                    if (bld) bld.value = att.catapultTarget;
                }

                var action = placeForm.getAttribute("action") || "/game.php";
                var data = serializeForm(placeForm) + "&" + encodeURIComponent(btnName) + "=1";

                console.log("[lp v82] step2 POST place →", action, "data length:", data.length);
                return fetchText(action, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: data
                }).then(function(html) { return { html: html, action: action }; });
            })
            .then(function(result) {
                console.log("[lp v82] step2 response received, len=" + result.html.length);
                var cDoc = parseDoc(result.html);

                var err = cDoc.querySelector(".error_box, #error_message, .system_error");
                if (err && err.textContent.trim()) {
                    console.warn("[lp v82] TW error in response:", err.textContent.trim());
                    throw new Error(err.textContent.trim().substring(0, 80));
                }

                var cForm = findConfirmForm(cDoc);
                if (!cForm) {
                    // Log the response so the user can grab it from console and share
                    console.warn("[lp v82] NO CONFIRM FORM in response. First 500 chars:",
                                 result.html.substring(0, 500));
                    throw new Error("no-confirm-form");
                }
                console.log("[lp v82] confirm form found, action:", cForm.getAttribute("action"));

                var newContent = cDoc.querySelector("#contentContainer");
                var cc = document.getElementById("contentContainer");
                if (!newContent || !cc) throw new Error("no-cc");

                var $overlay = $("#lp-overlay").detach();
                cc.innerHTML = newContent.innerHTML;
                // Push URL + update game_data BEFORE running inline scripts so TW's init code
                // sees the new location/state when it reads window.location.search / game_data.
                var cAction = cForm.getAttribute("action") || result.action;
                try { history.pushState({}, "", cAction); } catch(e) {}
                try {
                    if (typeof game_data !== "undefined") {
                        game_data.village = game_data.village || {};
                        game_data.village.id = String(att.originId);
                        game_data.screen = "place";
                    }
                } catch(e) {}
                runInlineScripts(cc);
                if ($overlay.length) $(cc).prepend($overlay);

                console.log("[lp v82] navigateToConfirm OK — content swapped, URL pushed:", cAction);
                if (onSuccess) onSuccess();
            })
            .catch(function(e) {
                console.error("[lp v82] navigateToConfirm FAILED:", e.message || e, e);
                if (onError) onError(e.message || String(e));
            });
        });
    }

    // navigate(url) — uses TribalWars.redirect so TW's own init runs on the destination page
    // (target widget loads, hidden x/y populated, place form fully wired). Script MAY die on
    // full-reload paths but that's acceptable for end-of-action navigations like the panel-Angreifen
    // fallback — the user just needs the place screen to work so they can complete the send.
    //
    // For in-cycle navigations where the script context MUST survive (Nächster Angriff between
    // attacks), call ajaxNav directly instead.
    function navigate(url) {
        if (typeof TribalWars !== "undefined" && TribalWars.redirect) {
            TribalWars.redirect(url);
            setTimeout(handleScreenReady, 700);
            return;
        }
        location.href = url;
    }

    // Pure-AJAX nav: GET the target URL, swap #contentContainer's inner HTML, preserve our overlay,
    // update the URL bar via History API. Uses fetch (no X-Requested-With header) — $.ajax sends
    // XHR header which makes TW return a partial response missing form fields, breaking subsequent
    // POSTs ("Es muss ein gültiges Ziel angegeben werden"). Same trick as submitAttackDirect.
    // Optional: pass att object to auto-populate place screen x/y fields (TW's own autofill doesn't
    // run after DOM swap, so we do it manually — otherwise "target not set" errors on next attack).
    function ajaxNav(url, onDone, att) {
        fetch(url, { credentials: "include", cache: "no-store" })
            .then(function(r){ return r.text(); })
            .then(function(html) {
                var doc;
                try { doc = new DOMParser().parseFromString(html, "text/html"); }
                catch(e) { location.href = url; return; }
                var newContent = doc.querySelector("#contentContainer");
                var cc = document.getElementById("contentContainer");
                if (!newContent || !cc) { location.href = url; return; }

                var $overlay = $("#lp-overlay").detach();
                var $widget  = $("#lp-widget").detach();
                cc.innerHTML = newContent.innerHTML;

                // Push URL BEFORE running inline scripts — TW's init code reads
                // window.location.search to resolve the target= param into the target widget.
                // If we pushState after, scripts see the old URL and the target never auto-loads.
                try {
                    history.pushState({}, "", url);
                    console.log("[lp v92] ajaxNav: URL pushed before script exec: " + url);
                } catch(e) {
                    console.warn("[lp v92] ajaxNav: history.pushState failed: " + e.message);
                }

                runInlineScripts(cc);

                if ($overlay.length) $(cc).prepend($overlay);
                if ($widget.length)  $("body").prepend($widget);

                if (onDone) onDone();

                // If att provided, auto-populate place screen x/y fields with target coords
                // (TW's own autofill doesn't run after DOM swap). Always overwrite with correct target.
                if (att && att.targetId && villageMap[String(att.targetId)]) {
                    var targetVillage = villageMap[String(att.targetId)];
                    var targetX = String(targetVillage.x);
                    var targetY = String(targetVillage.y);
                    
                    // Try immediately, then again after small delays to override any TW code
                    var doPopulate = function() {
                        // Find the form (it should now be in the DOM after swap)
                        var $form = $("form").filter(function(){
                            return $(this).find("input[name='x'], input[name='y']").length > 0;
                        }).first();
                        if (!$form.length) {
                            console.log("[lp v87] ajaxNav: form not found in DOM yet");
                            return;
                        }
                        
                        // Try to select "Koordinate" radio (may not exist on confirm forms)
                        var $coordRadio = $form.find("input[type='radio'][value='coordinates'], input[type='radio'][value='coord']").first();
                        if ($coordRadio.length && !$coordRadio.prop("checked")) {
                            $coordRadio.prop("checked", true).trigger("change");
                        }
                        
                        // ALWAYS set x/y, even if they already have values (could be stale from previous attack)
                        var $xInputs = $form.find("input[name='x']");
                        var $yInputs = $form.find("input[name='y']");
                        var oldX = $xInputs.val() || "";
                        var oldY = $yInputs.val() || "";
                        
                        $xInputs.val(targetX).trigger("change");
                        $yInputs.val(targetY).trigger("change");
                        
                        if (oldX !== targetX || oldY !== targetY) {
                            console.log("[lp v87] ajaxNav: overwrote stale coords (" + oldX + "|" + oldY + 
                                        ") → (" + targetX + "|" + targetY + ")");
                        } else {
                            console.log("[lp v87] ajaxNav: confirmed coords (" + targetX + "|" + targetY + ")");
                        }
                        
                        // Lock in the URL again after setting coordinates (in case TW tried to change it)
                        try {
                            history.pushState({}, "", url);
                            console.log("[lp v87] ajaxNav: re-locked URL after setting coords: " + url);
                        } catch(e) {}
                    };
                    doPopulate();
                    setTimeout(doPopulate, 100);
                }
            })
            .catch(function() { location.href = url; });
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
                    var parsed = JSON.parse(content);
                    callback(parsed);
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
    var autoSendArmed = false;
    var autoSendFired = false;

    function findNextAttack(plan, current) {
        var found = false;
        for (var i = 0; i < plan.length; i++) {
            if (found && !plan[i].sent) return plan[i];
            if (plan[i].originId === current.originId &&
                plan[i].targetId === current.targetId &&
                String(plan[i].arrivalMs) === String(current.arrivalMs)) {
                found = true;
            }
        }
        return null;
    }

    function injectAttackOverlay(p) {
        $("#lp-overlay").remove();
        if (window._lpOverlayInt) clearInterval(window._lpOverlayInt);
        // Inherit Auto-Senden from the previous attack in this chain (sessionStorage)
        try { autoSendArmed = sessionStorage.getItem("lp_autosend") === "1"; } catch(e) { autoSendArmed = false; }
        autoSendFired = false;

        // Load villages in the background so getSendMs() works for the next attack
        loadVillages(function(){});

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
            "<div id='lp-cd' style='font-size:28px;font-weight:bold;'>--</div>" +
            "</div>"
        );

        var timesDiv = "<div style='font-size:11px;color:#555;margin-bottom:8px;line-height:1.9;'>";
        if (sendMs) timesDiv += "<div>⚑ <b>Senden:</b> " + fmtTime(sendMs) + "</div>";
        timesDiv += "<div>⚐ <b>Ankunft:</b> " + fmtTime(p.arrivalMs) + "</div>";
        timesDiv += "</div>";
        overlay.append(timesDiv);

        overlay.append("<div id='lp-ping' style='font-size:10px;color:#888;text-align:right;margin-bottom:3px;font-family:monospace;'>Ping: --</div>");

        var autoBtn = $("<button style='width:100%;min-height:38px;font-size:13px;font-weight:bold;border-radius:4px;cursor:pointer;margin-bottom:4px;box-sizing:border-box;'></button>");
        function paintAutoBtn() {
            autoBtn.text(autoSendArmed ? "Auto-Senden: AN" : "Auto-Senden: AUS")
                   .css(autoSendArmed
                       ? {background:"#2a6000", color:"#fff", border:"1px solid #1a4000"}
                       : {background:"#ddd",    color:"#555", border:"1px solid #aaa"});
        }
        paintAutoBtn();
        autoBtn.on("click", function() {
            autoSendArmed = !autoSendArmed;
            autoSendFired = false;
            try { sessionStorage.setItem("lp_autosend", autoSendArmed ? "1" : "0"); } catch(e) {}
            paintAutoBtn();
        });
        overlay.append(autoBtn);

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
                    try { sessionStorage.removeItem("lp_autosent"); } catch(e) {}
                    if (window._lpOverlayInt) clearInterval(window._lpOverlayInt);
                    var nextAtt = findNextAttack(plan, p);
                    if (nextAtt) {
                        var nextSendMs = getSendMs(nextAtt);
                        var armAtt = {
                            id: nextAtt.id, originId: nextAtt.originId, targetId: nextAtt.targetId,
                            originLabel: villageLabel(nextAtt.originId),
                            targetLabel: villageLabel(nextAtt.targetId),
                            arrivalMs: nextAtt.arrivalMs, sendMs: nextSendMs,
                            type: p.type || "attack",
                            catapultTarget: nextAtt.catapultTarget || null,
                            troops: nextAtt.troops || null
                        };
                        var nFromLabel = armAtt.originLabel || ("Dorf " + armAtt.originId);
                        var nToLabel   = armAtt.targetLabel || ("Dorf " + armAtt.targetId);
                        var cdNextTarget = nextSendMs || nextAtt.arrivalMs;
                        var cdNextLabel  = nextSendMs ? "Losschicken in" : "Ankunft in";
                        overlay.html(
                            "<div style='color:#080;font-size:13px;font-weight:bold;padding:6px 0 8px;text-align:center;'>✓ Als gesendet markiert.</div>" +
                            "<div style='font-size:10px;color:#804000;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;text-align:center;'>Nächster Angriff</div>" +
                            "<div style='font-size:12px;margin-bottom:8px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' title='" + nFromLabel + " → " + nToLabel + "'>" +
                                nFromLabel + " <span style='color:#804000;'>→</span> " + nToLabel +
                            "</div>" +
                            "<div style='background:#5a1f00;color:#ffe8c0;border-radius:4px;padding:8px 12px;margin-bottom:8px;text-align:center;'>" +
                                "<div style='font-size:10px;letter-spacing:1px;text-transform:uppercase;opacity:0.75;margin-bottom:3px;'>" + cdNextLabel + "</div>" +
                                "<div id='lp-cd-next' style='font-size:24px;font-weight:bold;'>--</div>" +
                            "</div>" +
                            (nextSendMs ? "<div style='font-size:11px;color:#555;margin-bottom:8px;line-height:1.9;'><div>⚑ <b>Senden:</b> " + fmtTime(nextSendMs) + "</div><div>⚐ <b>Ankunft:</b> " + fmtTime(nextAtt.arrivalMs) + "</div></div>" : "<div style='font-size:11px;color:#555;margin-bottom:8px;'>⚐ <b>Ankunft:</b> " + fmtTime(nextAtt.arrivalMs) + "</div>")
                        );
                        // Restart timer against the next attack's target
                        if (window._lpOverlayInt) clearInterval(window._lpOverlayInt);
                        window._lpOverlayInt = setInterval(function() {
                            var $el = $("#lp-cd-next");
                            if (!$el.length) { clearInterval(window._lpOverlayInt); return; }
                            var d = cdNextTarget - serverNow();
                            if (d <= 0) {
                                $el.text(Math.abs(d) < 120000 ? "JETZT!" : "zu spät").css({color:"#ff0", fontWeight:"bold"});
                            } else {
                                $el.text(fmtHms(d)).css({color:"", fontWeight:"bold"});
                            }
                        }, 250);
                        var nextBtn = $("<button style='width:100%;min-height:44px;padding:8px;font-size:14px;font-weight:bold;background:#00468a;color:#fff;border:1px solid #00306a;border-radius:4px;cursor:pointer;box-sizing:border-box;margin-bottom:6px;'>→ Nächster Angriff</button>");
                        nextBtn.on("click", function() {
                            console.log("[lp v82] Nächster Angriff click", armAtt);
                            nextBtn.text("Lade Bestätigung...").prop("disabled", true);
                            savePendingAttack(armAtt);
                            if (window._lpOverlayInt) clearInterval(window._lpOverlayInt);
                            var bn = (armAtt.type === "support") ? "support" : "attack";
                            navigateToConfirm(armAtt, bn, function() {
                                console.log("[lp v82] navigateToConfirm success → re-inject overlay");
                                injectAttackOverlay(armAtt);
                            }, function(err) {
                                console.warn("[lp v94] navigateToConfirm failed:", err,
                                             "→ navigate() fallback (TribalWars.redirect — proper TW init, target widget loads)");
                                // Same approach as panel-Angreifen fallback. Pending attack is
                                // already saved above, so if TW does a full reload here and the
                                // script dies, re-tapping quickbar picks the cycle back up
                                // (handleScreenReady detects pending on place screen → re-injects overlay).
                                overlay.remove();
                                navigate(buildUrl(nextAtt));
                            });
                        });
                        var closeBtn2 = $("<button style='width:100%;min-height:36px;font-size:12px;background:transparent;border:1px solid #a07030;border-radius:3px;cursor:pointer;color:#804000;'>✕ Schließen</button>");
                        closeBtn2.on("click", function() {
                            try { sessionStorage.removeItem("lp_autosend"); } catch(e) {}
                            try { sessionStorage.removeItem("lp_jump_confirm"); } catch(e) {}
                            overlay.remove();
                            ajaxNav("/game.php?village=" + p.originId + "&screen=overview");
                        });
                        overlay.append(nextBtn).append(closeBtn2);
                    } else {
                        overlay.html(
                            "<div style='color:#080;font-size:14px;font-weight:bold;padding:10px 0 8px;text-align:center;'>✓ Alle Angriffe gesendet.</div>"
                        );
                        var doneClose = $("<button style='width:100%;min-height:36px;font-size:12px;background:transparent;border:1px solid #a07030;border-radius:3px;cursor:pointer;color:#804000;'>✕ Schließen</button>");
                        doneClose.on("click", function() {
                            try { sessionStorage.removeItem("lp_autosend"); } catch(e) {}
                            try { sessionStorage.removeItem("lp_jump_confirm"); } catch(e) {}
                            overlay.remove();
                            ajaxNav("/game.php?village=" + p.originId + "&screen=overview");
                        });
                        overlay.append(doneClose);
                    }
                });
            });
        });
        overlay.append(confirmBtn);

        var dismissBtn = $("<button style='width:100%;min-height:36px;font-size:12px;background:transparent;border:1px solid #a07030;border-radius:3px;cursor:pointer;color:#804000;'>✕ Schließen</button>");
        dismissBtn.on("click", function() {
            clearPendingAttack();
            try { sessionStorage.removeItem("lp_autosent"); } catch(e) {}
            try { sessionStorage.removeItem("lp_autosend"); } catch(e) {}
            try { sessionStorage.removeItem("lp_jump_confirm"); } catch(e) {}
            overlay.remove();
            if (window._lpOverlayInt) clearInterval(window._lpOverlayInt);
        });
        overlay.append(dismissBtn);

        mount.prepend(overlay);

        // Detect what form is on screen and hook the appropriate buttons.
        // Place form → Angreifen click should land us on confirm (not auto-send).
        // Confirm form → submit click should AJAX-POST and mark sent.
        var $twForm = $("form").filter(function(){
            return $(this).find("input[name='x'], input[name='y']").length > 0;
        }).first();
        var isConfirmFormOnScreen = isConfirmFormJq($twForm);
        console.log("[lp v86] overlay injected — form on screen:",
                    $twForm.length ? ($twForm.attr("action") || "no-action") : "no-form",
                    "isConfirm:", isConfirmFormOnScreen);
        console.log("[lp v86] current x/y values:", 
                    $twForm.find("input[name='x']").val(), 
                    $twForm.find("input[name='y']").val());
        console.log("[lp v87] address bar URL:", window.location.href);

        // Ensure place screen x/y fields are populated (TW's autofill may not run after AJAX nav)
        // Even if showing confirm form, x/y may have stale values — ALWAYS overwrite with correct target
        if ($twForm.length && p && p.targetId && villageMap[String(p.targetId)]) {
            var targetVillage = villageMap[String(p.targetId)];
            var targetX = String(targetVillage.x);
            var targetY = String(targetVillage.y);
            
            var doSetCoords = function() {
                // Try to find and select "Koordinate" (coordinates) radio if on place form
                if (!isConfirmFormOnScreen) {
                    var $coordRadio = $twForm.find("input[type='radio'][value='coordinates'], input[type='radio'][value='coord']").first();
                    if (!$coordRadio.length) {
                        $coordRadio = $twForm.find("input[type='radio']").filter(function() { 
                            var nextLabel = $(this).next("label").text() || "";
                            return nextLabel.indexOf("Koordinate") >= 0 || nextLabel.indexOf("Koordinaten") >= 0;
                        }).first();
                    }
                    if ($coordRadio.length && !$coordRadio.prop("checked")) {
                        $coordRadio.prop("checked", true).trigger("change");
                        console.log("[lp v87] injectAttackOverlay: selected Koordinate radio");
                    }
                }
                
                // ALWAYS set x/y to the correct target, even if they already have values
                var $xInputs = $twForm.find("input[name='x']");
                var $yInputs = $twForm.find("input[name='y']");
                var oldX = $xInputs.val() || "";
                var oldY = $yInputs.val() || "";
                
                $xInputs.val(targetX).trigger("change");
                $yInputs.val(targetY).trigger("change");
                
                if (oldX !== targetX || oldY !== targetY) {
                    console.log("[lp v87] injectAttackOverlay: overwrote stale coords (" + oldX + "|" + oldY + 
                                ") → (" + targetX + "|" + targetY + ")");
                } else {
                    console.log("[lp v87] injectAttackOverlay: confirmed coords (" + targetX + "|" + targetY + ")");
                }
            };
            
            doSetCoords();
            setTimeout(doSetCoords, 50);
            setTimeout(doSetCoords, 150);
        }

        if (isConfirmFormOnScreen) {
            hookConfirmFormSubmit();
        } else if ($twForm.length) {
            var _bSel = "input[type='submit'][name='attack'],button[name='attack']," +
                        "input[type='submit'][name='support'],button[name='support']";
            $(_bSel).off("click.lp").on("click.lp", function(e) {
                var $btn = $(this);
                var bName = $btn.attr("name");
                e.preventDefault();
                e.stopImmediatePropagation();
                $btn.prop("disabled", true);

                // Swap to confirm screen (lets user review + toggle Auto-Senden)
                navigateToConfirm(p, bName, function() {
                    injectAttackOverlay(p);
                }, function(err) {
                    $btn.prop("disabled", false);
                    confirmBtn.text("Fehler: " + err)
                              .css({background:"#fcc", color:"#a00", border:"1px solid #a00"});
                });
            });
        }

        // Set catapult building target in TW's own select
        if (p.catapultTarget && p.catapultTarget !== "0") {
            setTimeout(function(){ $("select[name='building']").val(p.catapultTarget); }, 150);
        }

        // Hook the confirm form (post-jump) to AJAX-submit instead of native form POST.
        // Native POST = page reload = script dies; AJAX keeps script alive.
        function hookConfirmFormSubmit() {
            var $cForm = $("form").filter(function(){
                var act = $(this).attr("action") || "";
                return act.indexOf("try=confirm") >= 0 ||
                       $(this).find("input[name='try'][value='confirm']").length > 0;
            }).first();
            if (!$cForm.length) return;

            function submitConfirmAjax() {
                var action = $cForm.attr("action") || "/game.php";
                var data = $cForm.find("input:not([type=submit],[type=button],[type=image]),select,textarea")
                                 .filter(function(){ return !this.disabled && !!this.name; })
                                 .serialize();
                data += (data ? "&" : "") + "attack=1";
                fetch(action, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: data
                })
                .then(function(r){ return r.text(); })
                .then(function(html) {
                    var doc = parseDoc(html);
                    var err = doc.querySelector(".error_box, #error_message, .system_error");
                    if (err && err.textContent.trim()) {
                        confirmBtn.text("Fehler: " + err.textContent.trim().substring(0, 80))
                                  .css({background:"#fcc", color:"#a00", border:"1px solid #a00"});
                        return;
                    }
                    confirmBtn.trigger("click");
                })
                .catch(function() {
                    // Fall back to native submit + page reload + lp_autosent marker
                    try { sessionStorage.setItem("lp_autosent", JSON.stringify({
                        id: p.id, originId: p.originId, targetId: p.targetId,
                        arrivalMs: p.arrivalMs, type: p.type || "attack", ts: Date.now()
                    })); } catch(e) {}
                    $cForm.off("submit.lp")[0].submit();
                });
            }

            $cForm.off("submit.lp").on("submit.lp", function(e) {
                e.preventDefault(); e.stopImmediatePropagation();
                submitConfirmAjax();
            });
            // Some browsers/forms submit via button click rather than form-submit event
            $cForm.find("input[type='submit'],button[type='submit'],button:not([type])")
                  .off("click.lp").on("click.lp", function(e) {
                e.preventDefault(); e.stopImmediatePropagation();
                submitConfirmAjax();
            });
        }

        // Timer — 100ms for precision near T=0
        window._lpOverlayInt = setInterval(function() {
            if (!$("#lp-overlay").length) { clearInterval(window._lpOverlayInt); return; }
            var d = cdTarget - serverNow();

            // Update live ping display
            var $ping = $("#lp-ping");
            if ($ping.length) {
                $ping.text("Ping: " + halfRTT + "ms (Median von " + rttSamples.length + ")");
            }

            // Fire at d <= 0 — no ping pre-fire. Attacks arrive ~halfRTT (30-100ms) late but
            // NEVER early. Pre-fire was unreliable: on the first attack of a session, TW's
            // Timing.offset_server may still be slightly off, and the pre-fire compounds that
            // error into ~1s early arrivals. No browser-side time sync is precise enough to
            // safely pre-fire by ping. Tradeoff: slightly late > ever-early.
            if (autoSendArmed && !autoSendFired && d <= 0 && d > -4000) {
                autoSendFired = true;
                autoBtn.text("Auto-Senden: ausgelöst").css({background:"#a04000", color:"#fff", border:"1px solid #703000"});
                var btnName = (p.type === "support") ? "support" : "attack";
                var _ok  = function() { confirmBtn.trigger("click"); };
                var _fail = function(err) {
                    autoSendArmed = false; autoSendFired = false;
                    try { sessionStorage.setItem("lp_autosend", "0"); } catch(e) {}
                    autoBtn.text("Fehler — manuell senden! (" + (err || "?") + ")")
                           .css({background:"#fcc", color:"#a00", border:"1px solid #c00"});
                };

                var $lf = $("form").filter(function(){
                    return $(this).find("input[name='x'],input[name='y']").length > 0;
                }).first();
                var lfAction = $lf.length ? ($lf.attr("action") || "") : "";
                var isConfirm = isConfirmFormJq($lf);
                console.log("[lp v82] AUTO-SEND fired — form:", lfAction || "no-form",
                            "isConfirm:", isConfirm, "btnName:", btnName);

                if (isConfirm) {
                    // Confirm screen: ONE POST. Don't chase a phantom step-2 confirm form in
                    // TW's response — that's what was spuriously erroring even though the attack
                    // actually went through ingame.
                    var cData = $lf.find("input:not([type=submit],[type=button],[type=image]),select,textarea")
                                   .filter(function(){ return !this.disabled && !!this.name; })
                                   .serialize();
                    cData += (cData ? "&" : "") + "attack=1";
                    fetch(lfAction || "/game.php", {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: cData
                    })
                    .then(function(r){ return r.text(); })
                    .then(function(html) {
                        var doc = parseDoc(html);
                        var err = doc.querySelector(".error_box, #error_message, .system_error");
                        if (err && err.textContent.trim()) {
                            _fail("tw: " + err.textContent.trim().substring(0, 80));
                            return;
                        }
                        _ok();
                    })
                    .catch(function(e) { _fail(e.message || "ajax"); });
                } else {
                    // Place screen or no form: full 3-step from scratch (same flow as the panel
                    // Angreifen button — proven reliable).
                    submitAttackDirect(p, btnName, _ok, _fail);
                }
            }

            var $cd = $("#lp-cd");
            if (d <= 0) {
                $cd.text(Math.abs(d) < 120000 ? "JETZT!" : "zu spät").css({color:"#ff0", fontWeight:"bold"});
            } else {
                $cd.text(fmtHms(d)).css({color:"", fontWeight:""});
            }
        }, 100);
    }

    // === Action handlers ===
    function makeSendHandler(att, type) {
        return function() {
            var $btn = $(this);
            $btn.prop("disabled", true);
            setStatus("Sende...");
            submitAttackDirect(att, type, function() {
                att.sent = true; att.sentBy = ME; att.sentAt = Date.now();
                githubPut({ attacks: currentPlan }, "gesendet: " + att.originId + "->" + att.targetId + " von " + ME, function(){
                    setStatus("Gesendet!", "green");
                    renderPlan(currentPlan);
                });
            }, function() {
                $btn.prop("disabled", false);
                setStatus("Direkt-Senden fehlgeschlagen — manuell senden.", "orange");
                var sendMs = getSendMs(att);
                savePendingAttack({
                    id: att.id, originId: att.originId, targetId: att.targetId,
                    originLabel: villageLabel(att.originId), targetLabel: villageLabel(att.targetId),
                    arrivalMs: att.arrivalMs, sendMs: sendMs, type: type,
                    catapultTarget: att.catapultTarget || null, troops: att.troops || null
                });
                navigate(buildUrl(att));
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

            // Send buttons — both always visible
            var btnRow = $("<div style='display:flex;gap:6px;'></div>");
            ["attack", "support"].forEach(function(type) {
                var label = type === "attack" ? "Angreifen" : "Unterstützen";
                var btn = $("<button style='flex:1;min-height:44px;padding:8px;font-size:13px;font-weight:bold;background:#afa;border:1px solid #080;border-radius:4px;cursor:pointer;box-sizing:border-box;'>" + label + "</button>");
                btn.on("click", function() {
                    var $b = $(this);
                    $b.text("...").prop("disabled", true);
                    submitAttackDirect(att, type, function() {
                        att.sent = true; att.sentBy = ME; att.sentAt = Date.now();
                        githubPut({ attacks: currentPlan }, "gesendet: " + att.originId + "->" + att.targetId + " von " + ME, function(){
                            setStatus("Gesendet!", "green");
                            renderPlan(currentPlan);
                        });
                    }, function(err) {
                        $b.text("✕ " + (err || "Fehler")).css({background:"#fcc", border:"1px solid #a00"}).prop("disabled", false);
                        setTimeout(function(){ $b.text(label).css({background:"", border:""}); }, 3000);
                        setStatus("Direkt-Senden fehlgeschlagen (" + (err||"?") + ") — öffne Angriffsscreen.", "orange");
                        savePendingAttack({
                            id: att.id, originId: att.originId, targetId: att.targetId,
                            originLabel: villageLabel(att.originId), targetLabel: villageLabel(att.targetId),
                            arrivalMs: att.arrivalMs, sendMs: sendMs, type: type,
                            catapultTarget: att.catapultTarget || null, troops: att.troops || null
                        });
                        navigate(buildUrl(att));
                    });
                });
                btnRow.append(btn);
            });
            card.append(btnRow);
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
            "<th style='width:130px;'>Aktion</th>" +
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
                var atkBtn = $("<button class='btn' style='display:block;width:100%;margin-bottom:2px;font-size:11px;'>Angreifen</button>");
                var supBtn = $("<button class='btn' style='display:block;width:100%;font-size:11px;'>Unterstützen</button>");
                atkBtn.on("click", makeSendHandler(att, "attack"));
                supBtn.on("click", makeSendHandler(att, "support"));
                actionCell.append(atkBtn).append(supBtn);
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

    function syncBotState(callback) {
        $.ajax({
            url: GITHUB_BOT_API + "?ref=" + GITHUB_BRANCH + "&_=" + Date.now(),
            headers: authHeaders(),
            success: function(data) {
                botControlSha = data.sha;
                try {
                    var content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
                    botEnabled = JSON.parse(content).enabled !== false;
                } catch(e) {}
                botToggleBtn.text(botEnabled ? "AN" : "AUS")
                            .css("background", botEnabled ? "#afa" : "#fcc");
                if (callback) callback();
            },
            error: function() { if (callback) callback(); }
        });
    }

    function writeBotState(enabled, callback) {
        var body = { message: "bot " + (enabled ? "an" : "aus"),
                     content: btoa(JSON.stringify({ enabled: enabled })),
                     branch: GITHUB_BRANCH };
        if (botControlSha) body.sha = botControlSha;
        $.ajax({
            url: GITHUB_BOT_API, method: "PUT", headers: authHeaders(),
            contentType: "application/json", data: JSON.stringify(body),
            success: function(resp) {
                botControlSha = resp.content.sha;
                if (callback) callback();
            },
            error: function(xhr) { setStatus("Bot-Toggle fehlgeschlagen: " + xhr.status, "red"); }
        });
    }

    botToggleBtn.on("click", function() {
        botEnabled = !botEnabled;
        botToggleBtn.text(botEnabled ? "AN" : "AUS")
                    .css("background", botEnabled ? "#afa" : "#fcc");
        setStatus("Bot " + (botEnabled ? "wird aktiviert..." : "wird pausiert..."));
        writeBotState(botEnabled, function() {
            setStatus("Bot " + (botEnabled ? "AN" : "AUS") + ".", botEnabled ? "green" : "orange");
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

    // === Auto-sent handler — reads lp_autosent from sessionStorage and confirms to GitHub ===
    // Called both at startup (full page reload) and from handleScreenReady (AJAX navigation).
    function handleAutoSent() {
        var raw = null;
        try { raw = sessionStorage.getItem("lp_autosent"); } catch(e) {}
        if (!raw) return false;
        try { sessionStorage.removeItem("lp_autosent"); } catch(e) {}
        var info;
        try { info = JSON.parse(raw); } catch(e) { return false; }
        if (!info.ts || Date.now() - info.ts > 120000) return false;
        loadVillages(function() {
            githubGet(function(data) {
                if (!data || !data.attacks) { clearPendingAttack(); return; }
                var plan = data.attacks;
                var att = plan.find(function(a) {
                    return a.originId === info.originId &&
                           a.targetId === info.targetId &&
                           String(a.arrivalMs) === String(info.arrivalMs);
                });
                if (att) { att.sent = true; att.sentBy = ME; att.sentAt = Date.now(); }
                githubPut({ attacks: plan }, "gesendet: " + info.originId + "->" + info.targetId + " von " + ME, function() {
                    clearPendingAttack();
                    var nextAtt = findNextAttack(plan, info);
                    if (nextAtt) {
                        savePendingAttack({
                            id: nextAtt.id, originId: nextAtt.originId, targetId: nextAtt.targetId,
                            originLabel: villageLabel(nextAtt.originId),
                            targetLabel: villageLabel(nextAtt.targetId),
                            arrivalMs: nextAtt.arrivalMs, sendMs: getSendMs(nextAtt),
                            type: info.type || "attack",
                            catapultTarget: nextAtt.catapultTarget || null,
                            troops: nextAtt.troops || null
                        });
                        navigate(buildUrl(nextAtt));
                    } else {
                        navigate("/game.php?village=" + info.originId + "&screen=overview");
                    }
                });
            });
        });
        return true;
    }

    // === Screen-change handler — called after any TW navigation ===
    function handleScreenReady() {
        if (handleAutoSent()) return;
        var p = loadPendingAttack();
        var screen = (typeof game_data !== "undefined") ? game_data.screen : null;
        if (!screen) return;

        mount = $("#contentContainer").length ? $("#contentContainer") : $("body");

        var villageId = (typeof game_data !== "undefined" && game_data.village) ? String(game_data.village.id) : null;
        var onPlace = p && screen === "place" && villageId === String(p.originId);

        if (onPlace && !$("#lp-overlay").length) {
            injectAttackOverlay(p);
        } else if (!onPlace) {
            if (panelOpen && !$("#launchpad-panel").length) {
                mount.prepend(panel);
                tableContainer.empty();
                loadVillages(function(){
                    githubGet(function(data){
                        if (data && data.attacks) renderPlan(data.attacks);
                    });
                });
            }
            if (p && p.arrivalMs && !$("#lp-widget").length) showCountdownWidget(p);
        }
    }

    // === Navigation detection ===
    // MutationObserver on #contentContainer as primary trigger.
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

    if (handleAutoSent()) {
        // Auto-sent marker found — confirm + navigate handled above; skip normal startup
    } else if (onAttackScreen) {
        // === Initial load already on the place screen ===
        injectAttackOverlay(pending);
    } else if (panelOpen) {
        // === Panel session active: show full panel ===
        mount.prepend(panel);

        if (pending && pending.arrivalMs) showCountdownWidget(pending);

        syncBotState();

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
    } else if (pending && pending.arrivalMs) {
        // === Silent mode: no panel, but keep the countdown widget for active pending attack ===
        showCountdownWidget(pending);
    }
    // else: nothing pending, nothing to show — permanent script exits silently
})();
