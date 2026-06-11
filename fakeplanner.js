(function(){
    "use strict";

    // === CONFIG ===
    var VERSION = "v1";
    var GITHUB_OWNER = "FNE-stack";
    var GITHUB_DATA_REPO = "DS-PLAN";
    var GITHUB_BRANCH = "main";
    var GITHUB_TOKEN = window.LAUNCHPAD_TOKEN || "";
    var _playerName = (typeof game_data !== "undefined" && game_data.player && game_data.player.name)
                      ? game_data.player.name : "unknown";
    var FAKES_FILE = _playerName + "-fakes.json";
    var FAKES_API = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_DATA_REPO
                    + "/contents/" + encodeURIComponent(FAKES_FILE);

    // === Remove any previous instance ===
    $("#fakeplanner-panel").remove();
    if (window._fpInt) { clearInterval(window._fpInt); window._fpInt = null; }

    // === World data state ===
    var villages = [];   // [{vid, name, x, y, pid, points}]
    var players = [];    // [{pid, name, tid, ...}]
    var tribes = [];     // [{tid, name, tag, members, points}]
    var myVid = String((typeof game_data !== "undefined" && game_data.village)
                       ? game_data.village.id : "");
    var myPid = String((typeof game_data !== "undefined" && game_data.player)
                       ? game_data.player.id : "");
    var villageById = {};
    var villagesByPlayer = {};
    var playerById = {};
    var tribeById = {};
    // Real per-village at-home troops fetched from TW's units overview. Used
    // to reject fakes whose origin can't actually afford the required units.
    var troopsByVid = {};  // { vid: { spy: 42, catapult: 8, ... } }

    var worldSpeed = (game_data.world && +game_data.world.speed) ? +game_data.world.speed : 1;
    var unitSpeed  = (game_data.world && +game_data.world.unit_speed) ? +game_data.world.unit_speed : 1;
    // Fake-limit ratio fetched from world config at startup. Default 0.05 (5%) —
    // standard for most de worlds, but real value depends on world.
    var worldFakeLimit = 0.05;
    var UNIT_SPEEDS = {
        spear: 18, sword: 22, axe: 18, archer: 18, spy: 9,
        light: 10, marcher: 10, heavy: 11, ram: 30, catapult: 30,
        knight: 10, snob: 35, militia: 18
    };
    // Farm space per unit — needed for fake-limit math. Catapults are the
    // densest-fs option (8 each), so adding cats is how a fake passes the limit.
    var UNIT_FARM_SPACE = {
        spear: 1, sword: 1, axe: 1, archer: 1,
        spy: 2, light: 4, marcher: 5, heavy: 6,
        ram: 5, catapult: 8, knight: 10, snob: 100, militia: 0
    };
    // Workbench unit order — MUST match what launchpad.js parses (spear, sword,
    // axe, archer, spy, light, marcher, heavy, ram, catapult, knight, snob, militia).
    var WB_UNIT_ORDER = ["spear","sword","axe","archer","spy","light","marcher",
                         "heavy","ram","catapult","knight","snob","militia"];

    // === UI ===
    var panel = $(
        "<div id='fakeplanner-panel' style='background:#f4e4bc;border:1px solid #804000;" +
        "padding:10px;margin:8px 0;font-family:Verdana;max-width:100%;box-sizing:border-box;'></div>"
    );
    panel.append("<h3 style='margin:0 0 8px 0;font-size:14px;'>Fake Planner " +
                 "<span style='font-size:11px;color:#888;font-weight:normal;'>" + VERSION + "</span>" +
                 "<span id='fp-close' style='cursor:pointer;float:right;color:#804000;'>✕</span>" +
                 "</h3>");

    var status = $("<div id='fp-status' style='margin:6px 0;font-size:12px;color:#555;min-height:16px;'>Lade Weltdaten…</div>");
    var body = $("<div id='fp-body' style='display:none;'></div>");
    panel.append(status).append(body);

    var mount = $("#contentContainer").length ? $("#contentContainer") : $("body");
    mount.prepend(panel);

    $("#fp-close").on("click", function(){ panel.remove(); });

    function setStatus(msg, color) {
        status.text(msg).css("color", color || "#555");
    }

    // === Load world data ===
    function loadWorldData(done) {
        var calls = 5, errors = 0;
        function tick(err) {
            if (err) errors++;
            if (--calls === 0) done(errors > 0);
        }

        // World config — gives us the fake-limit ratio. TW's XML returns this
        // as a percentage VALUE (e.g. "1" = 1%, "5" = 5%), NOT a fraction.
        // We auto-detect: if value > 1 it's percent → divide by 100; if ≤ 1
        // it's already a fraction. Was showing 100% before because we treated
        // "1" as fraction.
        $.get("/interface.php?func=get_config", function(xml){
            try {
                var fl = $(xml).find("fake_limit").first().text();
                var v = parseFloat(fl);
                if (!isNaN(v) && v > 0) {
                    worldFakeLimit = v > 1 ? v / 100 : v;
                }
            } catch(e){}
            tick();
        }).fail(function(){ tick(true); });

        // My at-home troops per village. We fetch the units overview (same
        // page DS_FarmBot uses) and read the `eigene` row per village. This
        // lets us reject any fake whose origin can't actually pay for the
        // required troops — no more "generates 50 fakes, bot fails 30".
        $.get("/game.php?screen=overview_villages&mode=units&type=own", function(html){
            try {
                var unitOrder = (typeof game_data !== "undefined" && game_data.units)
                                ? game_data.units : ["spear","sword","axe","spy","light","heavy","ram","catapult","snob"];
                // Strip stylesheets/scripts so we don't blow up jQuery with side-effect tags.
                var safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, "")
                                   .replace(/<link[^>]*>/gi, "");
                var $doc = $("<div>").html(safeHtml);
                $doc.find("tbody.row_marker").each(function(){
                    var $tbody = $(this);
                    var vid = $tbody.find(".quickedit-vn").attr("data-id");
                    if (!vid) return;
                    // The "eigene" row = own troops at home (excludes supports
                    // from elsewhere). First cell of that row is literal text.
                    var $eigeneRow = $tbody.find("tr").filter(function(){
                        var firstTd = $(this).find("td").not(".unit-item").first().text().trim().toLowerCase();
                        return firstTd === "eigene" || firstTd === "own";
                    }).first();
                    if (!$eigeneRow.length) return;
                    var t = {};
                    $eigeneRow.find("td.unit-item").each(function(i){
                        var n = parseInt(($(this).text() || "0").replace(/\D/g, ""), 10) || 0;
                        var u = unitOrder[i];
                        if (u) t[u] = n;
                    });
                    troopsByVid[vid] = t;
                });
            } catch(e) {
                console.warn("[fakeplanner] troops parse failed", e);
            }
            tick();
        }).fail(function(){ tick(true); });

        $.get("/map/village.txt", function(data){
            data.split("\n").forEach(function(line){
                var p = line.split(",");
                if (p.length < 6) return;
                var v = {
                    vid: p[0],
                    name: decodeURIComponent((p[1]||"").replace(/\+/g, "%20")),
                    x: parseInt(p[2], 10),
                    y: parseInt(p[3], 10),
                    pid: p[4] || "0",
                    points: parseInt(p[5], 10) || 0
                };
                villages.push(v);
                villageById[v.vid] = v;
                (villagesByPlayer[v.pid] = villagesByPlayer[v.pid] || []).push(v);
            });
            tick();
        }).fail(function(){ tick(true); });

        $.get("/map/player.txt", function(data){
            data.split("\n").forEach(function(line){
                var p = line.split(",");
                if (p.length < 3) return;
                var pl = {
                    pid: p[0],
                    name: decodeURIComponent((p[1]||"").replace(/\+/g, "%20")),
                    tid: p[2],
                    villages: parseInt(p[3], 10) || 0,
                    points: parseInt(p[4], 10) || 0,
                    rank: parseInt(p[5], 10) || 0
                };
                players.push(pl);
                playerById[pl.pid] = pl;
            });
            tick();
        }).fail(function(){ tick(true); });

        $.get("/map/ally.txt", function(data){
            data.split("\n").forEach(function(line){
                var p = line.split(",");
                if (p.length < 4) return;
                var t = {
                    tid: p[0],
                    name: decodeURIComponent((p[1]||"").replace(/\+/g, "%20")),
                    tag: decodeURIComponent((p[2]||"").replace(/\+/g, "%20")),
                    members: parseInt(p[3], 10) || 0,
                    villages: parseInt(p[4], 10) || 0,
                    points: parseInt(p[5], 10) || 0,
                    allpoints: parseInt(p[6], 10) || 0,
                    rank: parseInt(p[7], 10) || 0
                };
                tribes.push(t);
                tribeById[t.tid] = t;
            });
            tick();
        }).fail(function(){ tick(true); });
    }

    // === Helpers ===
    function dist(v1, v2) {
        return Math.hypot(v1.x - v2.x, v1.y - v2.y);
    }
    function distCoord(v, x, y) {
        return Math.hypot(v.x - x, v.y - y);
    }
    function b64(s) {
        return btoa(String(s));
    }
    function getMyVillages() {
        return (villagesByPlayer[myPid] || []).slice();
    }
    function getCurrentVillage() {
        return villageById[myVid] || null;
    }

    // Slowest unit (highest mpf) among non-zero units in a troops object.
    function slowestUnit(troops) {
        var slowestName = null;
        var slowestMpf = -1;
        Object.keys(troops).forEach(function(u){
            if (!troops[u] || troops[u] <= 0) return;
            var mpf = UNIT_SPEEDS[u] || 0;
            if (mpf > slowestMpf) { slowestMpf = mpf; slowestName = u; }
        });
        return slowestName;
    }

    // Compute milliseconds of travel for the troops over the given distance.
    function travelMs(troops, distance) {
        var slow = slowestUnit(troops);
        if (!slow) return 0;
        return Math.round(distance * UNIT_SPEEDS[slow] * 60 / (worldSpeed * unitSpeed)) * 1000;
    }

    // Encode troops object into launchpad's workbench format.
    // Empty values for zero units, base64(count) for non-zero, militia always "MA==".
    function encodeTroopsWB(troops) {
        return WB_UNIT_ORDER.map(function(u){
            if (u === "militia") return "militia=MA==";
            var n = parseInt(troops[u] || 0, 10);
            return u + "=" + (n > 0 ? b64(n) : "");
        }).join("/");
    }

    // Build a single workbench line for one fake.
    function buildWorkbenchLine(originVid, targetVid, troops, arrivalMs) {
        var slowest = slowestUnit(troops) || "spear";
        return [
            originVid,
            targetVid,
            slowest,
            arrivalMs,
            "0",        // catapult target (fakes don't catapult)
            "false",    // unknown flag (launchpad always emits false)
            "false",    // unknown flag
            encodeTroopsWB(troops)
        ].join("&");
    }

    // Convert one parsed fake into launchpad's JSON entry format (mirrors parseLine).
    function fakeToLaunchpadEntry(originVid, targetVid, troops, arrivalMs) {
        var id = originVid + "_" + targetVid + "_" + arrivalMs;
        return {
            id: id,
            originId: String(originVid),
            targetId: String(targetVid),
            slowest: slowestUnit(troops) || "spear",
            arrivalMs: arrivalMs,
            catapultTarget: "0",
            troops: troops,
            raw: buildWorkbenchLine(originVid, targetVid, troops, arrivalMs),
            sent: false,
            sentBy: null,
            sentAt: null,
            type: "attack"
        };
    }

    // === Target selection ===
    function pickTargetsByTribe(tribeId, mode, frontX, frontY, count, opts) {
        opts = opts || {};
        // All enemy villages of that tribe.
        var enemyPids = players.filter(function(p){ return p.tid === tribeId; })
                               .map(function(p){ return p.pid; });
        var enemyPidSet = {};
        enemyPids.forEach(function(p){ enemyPidSet[p] = true; });
        var candidates = villages.filter(function(v){ return enemyPidSet[v.pid]; });

        // Filter by min/max points if set.
        if (opts.minPoints) {
            candidates = candidates.filter(function(v){ return v.points >= opts.minPoints; });
        }
        if (opts.maxPoints) {
            candidates = candidates.filter(function(v){ return v.points <= opts.maxPoints; });
        }
        // Optional: exclude players (e.g. inactives, specific allies of enemy).
        if (opts.excludePids && opts.excludePids.length) {
            var exSet = {};
            opts.excludePids.forEach(function(p){ exSet[p] = true; });
            candidates = candidates.filter(function(v){ return !exSet[v.pid]; });
        }

        if (mode === "front") {
            candidates.sort(function(a, b){
                return distCoord(a, frontX, frontY) - distCoord(b, frontX, frontY);
            });
        } else {
            // random — shuffle in place (Fisher-Yates)
            for (var i = candidates.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var tmp = candidates[i];
                candidates[i] = candidates[j];
                candidates[j] = tmp;
            }
        }
        return candidates.slice(0, count);
    }

    // (assignOrigins removed — generateAllFakes now does origin selection +
    // troop building in one pass, since the village's available troops
    // determine whether a target is even feasible from it.)

    // Filler order — preference for what fills the fake limit. Spies first
    // (cheapest strategically, fastest 9 mpf), then cheap defensive infantry.
    // Order matters: earlier units get used first when filling.
    var FILLER_ORDER = ["spy", "spear", "sword", "axe", "archer"];

    // Build the smallest possible fake for a target from one origin village's
    // actual at-home troops. Returns the troop object on success, or null if
    // the village can't pay the fake limit even using everything it has.
    //
    // Rules (auto-generated, no manual template):
    //   - Always include opts.minCats catapults (default 1) — they dictate
    //     runtime so the attack arrives in catapult-time, looking real.
    //   - Fill remaining farm-space requirement using FILLER_ORDER, taking
    //     ONLY what the village has available (minus already-reserved troops).
    //   - Use the smallest unit count that reaches the threshold.
    function buildFakeFromVillage(origin, target, reservedHere, opts) {
        var have = troopsByVid[origin.vid] || {};
        function avail(u) { return Math.max(0, (have[u] || 0) - (reservedHere[u] || 0)); }

        var minCats = Math.max(1, opts.minCats || 1);
        if (avail("catapult") < minCats) return null;  // no cats = no fake (runtime needs cat speed)

        var t = { catapult: minCats };
        var currentFs = minCats * UNIT_FARM_SPACE.catapult;
        var required = target && target.points > 0 ? target.points * worldFakeLimit : 0;

        if (currentFs >= required) return t;  // 1 cat already passes for small villages

        // Fill remaining required FS, walking the preferred filler list.
        for (var i = 0; i < FILLER_ORDER.length; i++) {
            var u = FILLER_ORDER[i];
            if (!UNIT_FARM_SPACE[u]) continue;
            var availUnits = avail(u);
            if (availUnits <= 0) continue;

            var neededFs = required - currentFs;
            var fsPer = UNIT_FARM_SPACE[u];
            var neededUnits = Math.ceil(neededFs / fsPer);
            var use = Math.min(neededUnits, availUnits);

            if (use > 0) {
                t[u] = (t[u] || 0) + use;
                currentFs += use * fsPer;
            }
            if (currentFs >= required) return t;
        }
        // Walked all filler options, still under the limit → village can't pay.
        return null;
    }

    // === Generation: pick origin + build troops in one pass ===
    // For each target, walk candidate villages in order of (assignment count,
    // distance). For each candidate, try buildFakeFromVillage. If it works,
    // reserve those troops and move on. If no village can build it, drop.
    function generateAllFakes(targets, myVillages, opts) {
        var perVillageCount = {};
        myVillages.forEach(function(v){ perVillageCount[v.vid] = 0; });
        var reservedByVid = {};

        var fakes = [];
        var droppedNoUnits = 0;
        var droppedFar = 0;

        targets.forEach(function(target){
            // Sort: villages with fewest current assignments first (round-robin),
            // then closest first (cheapest send). Each village can be picked
            // again only after every other has caught up.
            var ranked = myVillages.slice().sort(function(a, b){
                var c = perVillageCount[a.vid] - perVillageCount[b.vid];
                if (c !== 0) return c;
                return dist(a, target) - dist(b, target);
            });

            var built = null;
            for (var i = 0; i < ranked.length; i++) {
                var origin = ranked[i];
                var d = dist(origin, target);
                if (d > opts.maxDist) continue;  // ranked by dist within tie, but max applies
                var troops = buildFakeFromVillage(
                    origin, target, reservedByVid[origin.vid] || {}, opts
                );
                if (troops) {
                    reservedByVid[origin.vid] = reservedByVid[origin.vid] || {};
                    Object.keys(troops).forEach(function(u){
                        reservedByVid[origin.vid][u] =
                            (reservedByVid[origin.vid][u] || 0) + troops[u];
                    });
                    perVillageCount[origin.vid]++;
                    built = { origin: origin, target: target, troops: troops, dist: d };
                    break;
                }
            }

            if (!built) {
                // Check if it was a distance issue or a unit issue.
                var anyInRange = myVillages.some(function(v){
                    return dist(v, target) <= opts.maxDist;
                });
                if (!anyInRange) droppedFar++;
                else droppedNoUnits++;
            } else {
                fakes.push(built);
            }
        });
        return { fakes: fakes, droppedFar: droppedFar, droppedNoUnits: droppedNoUnits };
    }

    // === Arrival time spread ===
    // Returns N timestamps spread between start and end ms, with optional jitter.
    function spreadArrivals(startMs, endMs, n, jitterMs) {
        if (n === 1) return [Math.floor((startMs + endMs) / 2)];
        var out = [];
        var step = (endMs - startMs) / (n - 1);
        for (var i = 0; i < n; i++) {
            var t = startMs + i * step;
            if (jitterMs) t += (Math.random() - 0.5) * 2 * jitterMs;
            out.push(Math.floor(t));
        }
        return out;
    }

    // === GitHub I/O for the fakes file ===
    function authHeaders() {
        return { "Authorization": "Bearer " + GITHUB_TOKEN,
                 "Accept": "application/vnd.github+json" };
    }
    function ghGetFakes(done) {
        $.ajax({
            url: FAKES_API + "?ref=" + GITHUB_BRANCH + "&_=" + Date.now(),
            headers: authHeaders(),
            success: function(data){
                try {
                    var content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
                    done(null, { sha: data.sha, payload: JSON.parse(content) });
                } catch(e){ done(e); }
            },
            error: function(xhr){
                if (xhr.status === 404) done(null, { sha: null, payload: { fakes: [] } });
                else done(new Error("GitHub GET " + xhr.status));
            }
        });
    }
    function ghPutFakes(sha, payload, message, done) {
        var body = {
            message: message,
            content: btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2)))),
            branch: GITHUB_BRANCH
        };
        if (sha) body.sha = sha;
        $.ajax({
            url: FAKES_API,
            method: "PUT",
            headers: authHeaders(),
            contentType: "application/json",
            data: JSON.stringify(body),
            success: function(){ done(null); },
            error: function(xhr){ done(new Error("GitHub PUT " + xhr.status + ": " + xhr.responseText)); }
        });
    }

    // === Render Panel UI ===
    function renderUI() {
        var myVillages = getMyVillages();
        if (myVillages.length === 0) {
            setStatus("Keine eigenen Dörfer gefunden — kann nichts faken.", "red");
            return;
        }
        var current = getCurrentVillage() || myVillages[0];

        // Tribe options: only tribes that have at least one member, sorted by tag.
        var tribeOpts = tribes
            .filter(function(t){ return t.members > 0 && t.tag; })
            .sort(function(a, b){ return a.tag.toLowerCase().localeCompare(b.tag.toLowerCase()); })
            .map(function(t){
                return "<option value='" + t.tid + "'>" + escHtml(t.tag) +
                       " (" + escHtml(t.name) + ", " + t.members + ")</option>";
            })
            .join("");

        // My village options (for the front-center picker).
        var myVilOpts = myVillages
            .sort(function(a, b){ return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); })
            .map(function(v){
                return "<option value='" + v.vid + "'" + (v.vid === current.vid ? " selected" : "") +
                       ">" + escHtml(v.name) + " (" + v.x + "|" + v.y + ")</option>";
            }).join("");

        var nowDate = serverDate();  // server-time-based "today"
        var defaultStart = nowDate.toISOString().slice(0, 16);
        var endDate = new Date(nowDate.getTime() + 12 * 3600 * 1000);
        var defaultEnd = endDate.toISOString().slice(0, 16);

        var fakeLimitPct = (worldFakeLimit * 100).toFixed(1);
        body.html(
            "<div style='display:grid;grid-template-columns:150px minmax(260px, 1fr);" +
            "gap:6px;align-items:center;font-size:12px;'>" +

                "<label>Gegner-Stamm:</label>" +
                "<select id='fp-tribe' style='width:100%;'>" + tribeOpts + "</select>" +

                "<label>Modus:</label>" +
                "<select id='fp-mode' style='width:100%;'>" +
                    "<option value='front' selected>Front (nahegelegen)</option>" +
                    "<option value='random'>Zufall (gesamter Stamm)</option>" +
                "</select>" +

                "<label>Front-Zentrum:</label>" +
                "<select id='fp-front' style='width:100%;'>" + myVilOpts + "</select>" +

                "<label>Anzahl Fakes:</label>" +
                "<input id='fp-count' type='number' min='1' value='" +
                    Math.min(20, myVillages.length * 2) + "' style='width:100%;'>" +

                "<label>Max Felder:</label>" +
                "<input id='fp-maxdist' type='number' min='1' max='200' value='25' style='width:100%;' " +
                    "title='Ziele weiter weg werden ignoriert. Bedenke: mit Katas dauert 25F ~12h Reise.'>" +

                "<label>Min/Max Punkte:</label>" +
                "<div><input id='fp-minp' type='number' min='0' placeholder='min' style='width:48%;'> " +
                "<input id='fp-maxp' type='number' min='0' placeholder='max' style='width:48%;'></div>" +

                "<label>Min. Katapulte:</label>" +
                "<input id='fp-mincats' type='number' min='1' max='10' value='1' " +
                    "style='width:80px;' " +
                    "title='Mindest-Anzahl Katapulte pro Fake. Dient nur der Tarnung (Cat-Runtime). " +
                    "Höher = mehr Tarnung, aber mehr Kosten. 1 reicht meistens.'>" +

                "<label>Fake-Logik:</label>" +
                "<div style='font-size:11px;color:#555;'>" +
                    "<b>Welt-Fakelimit: " + fakeLimitPct + "%</b> der Dorf-Punkte<br>" +
                    "Generierung: <b>1+ Kata + Auffüllen mit " +
                    FILLER_ORDER.join(" → ") + "</b><br>" +
                    "<span style='color:#888;'>Pro Fake wird der kleinstmögliche Mix aus " +
                    "deinen verfügbaren Truppen gewählt der das Limit knackt.</span>" +
                "</div>" +

            "</div>" +

            // Time pickers FULL WIDTH on their own — grid was cramping them on
            // narrow panels and the iOS native picker was getting clipped.
            "<div style='margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;'>" +
                "<div>" +
                    "<label style='display:block;font-weight:bold;margin-bottom:3px;'>Ankunft von:</label>" +
                    "<input id='fp-start' type='datetime-local' value='" + defaultStart +
                        "' style='width:100%;padding:5px;font-size:13px;box-sizing:border-box;'>" +
                "</div>" +
                "<div>" +
                    "<label style='display:block;font-weight:bold;margin-bottom:3px;'>Ankunft bis:</label>" +
                    "<input id='fp-end' type='datetime-local' value='" + defaultEnd +
                        "' style='width:100%;padding:5px;font-size:13px;box-sizing:border-box;'>" +
                "</div>" +
            "</div>" +

            "<div style='margin-top:10px;'>" +
                "<button id='fp-generate' style='padding:6px 12px;font-weight:bold;'>" +
                    "▶ Fakes generieren</button>" +
                "<span id='fp-summary' style='margin-left:10px;font-size:11px;color:#555;'></span>" +
            "</div>" +

            "<div id='fp-preview'></div>" +

            "<textarea id='fp-output' readonly placeholder='Generierte Workbench-Befehle erscheinen hier…' " +
                "style='width:100%;height:160px;margin-top:8px;font-family:monospace;font-size:11px;" +
                "box-sizing:border-box;'></textarea>" +

            "<div style='margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;'>" +
                "<button id='fp-copy' disabled style='padding:5px 10px;'>📋 Alle kopieren</button>" +
                "<button id='fp-pushfakes' disabled style='padding:5px 10px;'>💾 In " + FAKES_FILE + " sichern</button>" +
                "<button id='fp-pushmain' disabled style='padding:5px 10px;background:#afa;font-weight:bold;'>" +
                    "🚀 In Launchpad-Plan (" + _playerName + ".json) übernehmen</button>" +
            "</div>"
        );

        body.show();

        // === Event handlers ===
        // Mode → toggle front-center visibility
        $("#fp-mode").on("change", function(){
            $("#fp-front").closest("select").prop("disabled", this.value !== "front");
        });

        $("#fp-generate").on("click", onGenerate);
        $("#fp-copy").on("click", function(){
            var $out = $("#fp-output");
            $out[0].select();
            try { document.execCommand("copy"); UI.SuccessMessage("Kopiert"); } catch(e){}
        });
        $("#fp-pushfakes").on("click", function(){ pushToFakesFile(); });
        $("#fp-pushmain").on("click", function(){ pushToMainPlan(); });

        setStatus("Bereit — " + tribeOpts.split("</option>").length + " Stämme, " +
                  myVillages.length + " eigene Dörfer geladen.", "green");
    }

    // Holds the last generation so the buttons can use it.
    var lastGenerated = [];  // [{originVid, targetVid, troops, arrivalMs, dist}]

    function readUIValues() {
        return {
            tribeId: $("#fp-tribe").val(),
            mode: $("#fp-mode").val(),
            frontVid: $("#fp-front").val(),
            count: parseInt($("#fp-count").val(), 10) || 0,
            minPoints: parseInt($("#fp-minp").val(), 10) || 0,
            maxPoints: parseInt($("#fp-maxp").val(), 10) || 0,
            startMs: new Date($("#fp-start").val()).getTime(),
            endMs: new Date($("#fp-end").val()).getTime(),
            minCats: parseInt($("#fp-mincats").val(), 10) || 1,
            maxDist: parseFloat($("#fp-maxdist").val()) || 25
        };
    }

    function onGenerate() {
        var ui = readUIValues();
        if (!ui.tribeId) { setStatus("Wähle einen Gegner-Stamm.", "red"); return; }
        if (!ui.count || ui.count < 1) { setStatus("Anzahl muss > 0 sein.", "red"); return; }
        if (!ui.startMs || !ui.endMs || ui.endMs <= ui.startMs) {
            setStatus("Ankunftszeit ist ungültig.", "red"); return;
        }

        var frontVil = villageById[ui.frontVid] || getCurrentVillage();
        var targets = pickTargetsByTribe(
            ui.tribeId, ui.mode,
            frontVil ? frontVil.x : 500, frontVil ? frontVil.y : 500,
            ui.count,
            { minPoints: ui.minPoints || 0, maxPoints: ui.maxPoints || 0 }
        );
        if (targets.length === 0) {
            setStatus("Keine Ziele gefunden (Stamm leer? Punkte-Filter zu streng?).", "red");
            return;
        }

        var myVillages = getMyVillages();
        var result = generateAllFakes(targets, myVillages, {
            minCats: ui.minCats,
            maxDist: ui.maxDist
        });
        var droppedFar = result.droppedFar;
        var droppedNoUnits = result.droppedNoUnits;
        var fakes = result.fakes;

        if (fakes.length === 0) {
            setStatus("Keine Fakes generiert — entweder kein eigenes Dorf hat 1 Kata + " +
                      "genug Späher/Speer/Schwert/Axt um das " +
                      (worldFakeLimit * 100).toFixed(1) +
                      "% Fakelimit zu knacken, oder alle Ziele sind > " +
                      ui.maxDist + "F entfernt.", "red");
            $("#fp-output").val("");
            $("#fp-preview").empty();
            $("#fp-summary").text("");
            return;
        }

        var arrivals = spreadArrivals(ui.startMs, ui.endMs, fakes.length, 60000);

        var totalCats = 0, totalSpies = 0, totalInf = 0;
        lastGenerated = fakes.map(function(f, i){
            if (f.troops.catapult) totalCats += f.troops.catapult;
            if (f.troops.spy) totalSpies += f.troops.spy;
            ["spear","sword","axe","archer"].forEach(function(u){
                if (f.troops[u]) totalInf += f.troops[u];
            });
            return {
                originVid: f.origin.vid,
                targetVid: f.target.vid,
                originLabel: f.origin.name + " (" + f.origin.x + "|" + f.origin.y + ")",
                targetLabel: f.target.name + " (" + f.target.x + "|" + f.target.y + ")",
                troops: f.troops,
                arrivalMs: arrivals[i],
                dist: f.dist
            };
        });

        // Build workbench output with readable comment lines above each command.
        // launchpad's parseLine returns null for lines without 8 `&`-separated
        // parts, so the comments are silently ignored when pasted — but a human
        // reading the textarea can see exactly what each command is for.
        var lines = [];
        lastGenerated.forEach(function(f, i){
            var arrText = new Date(f.arrivalMs).toLocaleString("de-DE", {
                day: "2-digit", month: "2-digit", hour: "2-digit",
                minute: "2-digit", second: "2-digit"
            });
            var troopText = Object.keys(f.troops).filter(function(u){ return f.troops[u] > 0; })
                .map(function(u){ return f.troops[u] + u.charAt(0).toUpperCase(); })
                .join("+");
            lines.push("# Fake " + (i+1) + ": " + f.originLabel + " → " + f.targetLabel +
                       "  ·  " + f.dist.toFixed(1) + "F  ·  " + troopText +
                       "  ·  Ankunft " + arrText);
            lines.push(buildWorkbenchLine(f.originVid, f.targetVid, f.troops, f.arrivalMs));
            lines.push("");
        });
        $("#fp-output").val(lines.join("\n"));

        // Render readable preview table below the textarea.
        renderPreviewTable(lastGenerated);

        // Travel + cat preview.
        var avgDist = lastGenerated.reduce(function(s, f){ return s + f.dist; }, 0) / lastGenerated.length;
        var summaryParts = [
            lastGenerated.length + " Fakes",
            "⌀ " + avgDist.toFixed(1) + "F"
        ];
        if (totalCats > 0) summaryParts.push("Σ " + totalCats + " Kata");
        if (totalSpies > 0) summaryParts.push("Σ " + totalSpies + " Späher");
        if (totalInf > 0) summaryParts.push("Σ " + totalInf + " Inf");
        if (droppedFar > 0) summaryParts.push(droppedFar + " zu weit weg");
        if (droppedNoUnits > 0) summaryParts.push(droppedNoUnits + " ohne genug Truppen");
        $("#fp-summary").text(summaryParts.join(" · "));

        $("#fp-copy, #fp-pushfakes, #fp-pushmain").prop("disabled", false);
        setStatus("✓ " + lines.filter(function(l){ return l && !l.startsWith("#"); }).length +
                  " Fakes generiert.", "green");
    }

    // Render a readable HTML table of generated fakes in the preview container.
    function renderPreviewTable(fakes) {
        if (fakes.length === 0) { $("#fp-preview").empty(); return; }
        var rows = fakes.map(function(f, i){
            var troopText = Object.keys(f.troops).filter(function(u){ return f.troops[u] > 0; })
                .map(function(u){
                    return "<img src='/graphic/unit/unit_" + u +
                           ".png' style='width:14px;height:14px;vertical-align:middle;' " +
                           "title='" + u + "'> " + f.troops[u];
                }).join(" ");
            var arrText = new Date(f.arrivalMs).toLocaleString("de-DE", {
                day: "2-digit", month: "2-digit",
                hour: "2-digit", minute: "2-digit", second: "2-digit"
            });
            return "<tr>" +
                "<td style='padding:3px 6px;'>" + (i+1) + "</td>" +
                "<td style='padding:3px 6px;'>" + escHtml(f.originLabel) + "</td>" +
                "<td style='padding:3px 6px;text-align:center;color:#a07030;'>→</td>" +
                "<td style='padding:3px 6px;'>" + escHtml(f.targetLabel) + "</td>" +
                "<td style='padding:3px 6px;text-align:right;'>" + f.dist.toFixed(1) + "F</td>" +
                "<td style='padding:3px 6px;'>" + troopText + "</td>" +
                "<td style='padding:3px 6px;font-size:10px;color:#555;white-space:nowrap;'>" +
                    arrText + "</td>" +
                "</tr>";
        }).join("");
        $("#fp-preview").html(
            "<details open style='margin-top:8px;'><summary style='cursor:pointer;font-weight:bold;'>" +
                "📋 Fake-Liste anzeigen/ausblenden</summary>" +
            "<table style='width:100%;font-size:11px;border-collapse:collapse;margin-top:5px;'>" +
                "<thead><tr style='background:#e0d4b0;'>" +
                    "<th style='padding:3px 6px;text-align:left;'>#</th>" +
                    "<th style='padding:3px 6px;text-align:left;'>Von</th>" +
                    "<th></th>" +
                    "<th style='padding:3px 6px;text-align:left;'>Nach</th>" +
                    "<th style='padding:3px 6px;'>Dist</th>" +
                    "<th style='padding:3px 6px;text-align:left;'>Truppen</th>" +
                    "<th style='padding:3px 6px;text-align:left;'>Ankunft</th>" +
                "</tr></thead>" +
                "<tbody>" + rows + "</tbody>" +
            "</table></details>"
        );
    }

    function pushToFakesFile() {
        if (lastGenerated.length === 0) { setStatus("Nichts zu speichern.", "orange"); return; }
        if (!GITHUB_TOKEN) { setStatus("Kein GitHub-Token (window.LAUNCHPAD_TOKEN nicht gesetzt).", "red"); return; }
        setStatus("Lade " + FAKES_FILE + "…");
        ghGetFakes(function(err, current){
            if (err) { setStatus("GitHub GET fehlgeschlagen: " + err.message, "red"); return; }
            var entries = (current.payload && current.payload.fakes) || [];
            var added = lastGenerated.map(function(f){
                return fakeToLaunchpadEntry(f.originVid, f.targetVid, f.troops, f.arrivalMs);
            });
            // Dedupe by id.
            var byId = {};
            entries.forEach(function(e){ byId[e.id] = e; });
            added.forEach(function(e){ byId[e.id] = e; });
            var merged = Object.values(byId);
            setStatus("Schreibe " + merged.length + " Einträge…");
            ghPutFakes(current.sha, { fakes: merged },
                "fakeplanner: +" + added.length + " (gesamt " + merged.length + ")",
                function(err){
                    if (err) setStatus("GitHub PUT fehlgeschlagen: " + err.message, "red");
                    else setStatus("✓ " + added.length + " Fakes in " + FAKES_FILE + " gespeichert.", "green");
                }
            );
        });
    }

    function pushToMainPlan() {
        if (lastGenerated.length === 0) { setStatus("Nichts zu pushen.", "orange"); return; }
        if (!GITHUB_TOKEN) { setStatus("Kein GitHub-Token (window.LAUNCHPAD_TOKEN nicht gesetzt).", "red"); return; }

        var mainApi = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_DATA_REPO
                      + "/contents/" + encodeURIComponent(_playerName + ".json");

        setStatus("Lade " + _playerName + ".json…");
        $.ajax({
            url: mainApi + "?ref=" + GITHUB_BRANCH + "&_=" + Date.now(),
            headers: authHeaders(),
            success: function(data){
                var sha = data.sha;
                var existing = { attacks: [] };
                try {
                    var content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
                    existing = JSON.parse(content);
                } catch(e){}
                pushMerge(mainApi, sha, existing.attacks || []);
            },
            error: function(xhr){
                if (xhr.status === 404) pushMerge(mainApi, null, []);
                else setStatus("GitHub GET fehlgeschlagen: " + xhr.status, "red");
            }
        });

        function pushMerge(api, sha, existingAttacks) {
            var added = lastGenerated.map(function(f){
                return fakeToLaunchpadEntry(f.originVid, f.targetVid, f.troops, f.arrivalMs);
            });
            // Dedupe by id; fakes don't replace existing real attacks if id collides.
            var byId = {};
            existingAttacks.forEach(function(e){ byId[e.id] = e; });
            added.forEach(function(e){ if (!byId[e.id]) byId[e.id] = e; });
            var merged = Object.values(byId);

            var body = {
                message: "fakeplanner: +" + added.length + " fakes (Plan total " + merged.length + ")",
                content: btoa(unescape(encodeURIComponent(JSON.stringify({ attacks: merged }, null, 2)))),
                branch: GITHUB_BRANCH
            };
            if (sha) body.sha = sha;
            setStatus("Pushe " + merged.length + " Angriffe…");
            $.ajax({
                url: api,
                method: "PUT",
                headers: authHeaders(),
                contentType: "application/json",
                data: JSON.stringify(body),
                success: function(){
                    setStatus("✓ " + added.length + " Fakes in Launchpad-Plan übernommen — Bot übernimmt!", "green");
                },
                error: function(xhr){
                    setStatus("GitHub PUT fehlgeschlagen: " + xhr.status + " — " + xhr.responseText, "red");
                }
            });
        }
    }

    // === Utility ===
    function escHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function serverDate() {
        // Server time from the in-page widget (#serverTime + #serverDate). Fall
        // back to client time if the widget isn't on this screen.
        var t = $("#serverTime").text() || "";
        var d = $("#serverDate").text() || "";
        if (t && d) {
            var p = d.split("/");
            // Date format: DD/MM/YYYY
            return new Date(p[2] + "-" + p[1] + "-" + p[0] + "T" + t);
        }
        return new Date();
    }

    // === Entry point ===
    loadWorldData(function(hadErr){
        if (hadErr) {
            setStatus("Fehler beim Laden der Weltdaten (village.txt / player.txt / ally.txt).", "red");
            return;
        }
        if (villages.length === 0 || players.length === 0 || tribes.length === 0) {
            setStatus("Weltdaten leer — falsches Welt-Setup?", "red");
            return;
        }
        renderUI();
    });

})();
