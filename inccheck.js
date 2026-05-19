(function () {

    // === CONFIG ===
    var VERSION  = 'v3';
    var API_URL  = (window.serverConfig && window.serverConfig.sfAPI) || 'https://api.twmeta.net/intel/village';
    var DB_KEY   = window.INCCHECK_DB_KEY || localStorage.getItem('dbkey') || '';
    var CACHE_TTL = 10 * 60 * 1000; // 10 min

    if (!DB_KEY) {
        alert('[IncCheck] Kein DB-Key gefunden.\nBitte "dbkey" in localStorage setzen oder window.INCCHECK_DB_KEY definieren.');
        return;
    }

    var params   = new URL(location.href).searchParams;
    var twScreen = params.get('screen');
    var twMode   = params.get('mode');

    var isInfoVillage = twScreen === 'info_village';
    var isIncomings   = (twScreen === 'overview_villages' || twScreen === 'overview') && twMode === 'incomings';

    if (!isInfoVillage && !isIncomings) {
        alert('[IncCheck] Bitte auf der Dorfinfoseite oder der Eingehenden-Übersicht ausführen.');
        return;
    }

    var currentVid = (typeof game_data !== 'undefined' && game_data.village) ? String(game_data.village.id) : null;

    // ── Village map ────────────────────────────────────────────────────────
    var villageMap      = {};
    var villageMapReady = false;
    var vmQueue         = [];

    function withVillageMap(cb) {
        if (villageMapReady) { cb(); return; }
        vmQueue.push(cb);
        if (vmQueue.length > 1) return;
        $.get('/map/village.txt', function (txt) {
            txt.split('\n').forEach(function (line) {
                var p = line.split(',');
                if (p.length >= 4) {
                    villageMap[p[0]] = { x: p[2], y: p[3], name: decodeURIComponent(p[1].replace(/\+/g, '%20')) };
                }
            });
            console.log('[IncCheck] Village map loaded, entries: ' + Object.keys(villageMap).length);
        }).always(function () {
            villageMapReady = true;
            vmQueue.forEach(function (fn) { fn(); });
            vmQueue = [];
        });
    }

    // ── Cache ─────────────────────────────────────────────────────────────
    var NS = 'inccheck_' + VERSION + '_';

    function cacheGet(coord) {
        try {
            var raw = sessionStorage.getItem(NS + coord);
            if (!raw) return undefined;
            var e = JSON.parse(raw);
            if (Date.now() - e.ts > CACHE_TTL) { sessionStorage.removeItem(NS + coord); return undefined; }
            return e.data;
        } catch (_) { return undefined; }
    }

    function cacheSet(coord, data) {
        try { sessionStorage.setItem(NS + coord, JSON.stringify({ ts: Date.now(), data: data })); } catch (_) {}
    }

    // ── API ───────────────────────────────────────────────────────────────
    var _debugLogged = false;

    function queryVillage(x, y, cb) {
        var coord  = x + '|' + y;
        var cached = cacheGet(coord);
        if (cached !== undefined) {
            if (!_debugLogged) {
                _debugLogged = true;
                console.log('[IncCheck] API-Antwort gecacht (' + coord + '):', JSON.stringify(cached, null, 2));
            }
            cb(cached);
            return;
        }

        var fd = new FormData();
        fd.append('Key', DB_KEY);
        fd.append('X', x);
        fd.append('Y', y);

        fetch(API_URL, { method: 'POST', body: fd, credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!_debugLogged) {
                    _debugLogged = true;
                    console.log('[IncCheck] API-Antwort (' + coord + '):', JSON.stringify(data, null, 2));
                }
                cacheSet(coord, data);
                cb(data);
            })
            .catch(function (err) {
                console.warn('[IncCheck] API-Fehler für', coord, err);
                cacheSet(coord, null);
                cb(null);
            });
    }

    // ── Find attacker coords from a row ───────────────────────────────────
    // On incomings overview: row is [defender link] [attacker link] → use LAST link
    // On info_village: row has only attacker link → use first non-own link
    function getAttackerXY($row, callback) {
        var $links = $row.find('a[href*="info_village"]').filter(function () {
            return /[?&]id=\d+/.test($(this).attr('href') || '');
        });

        if (isIncomings) {
            // Attacker is always the LAST info_village link in the row
            // (layout: defender | attacker)
            var found = null;
            $links.each(function () {
                var m = ($(this).attr('href') || '').match(/[?&]id=(\d+)/);
                if (m && villageMap[m[1]]) {
                    found = { x: villageMap[m[1]].x, y: villageMap[m[1]].y };
                    // don't break — we want the LAST one
                }
            });
            if (found) { callback(found.x, found.y); return; }

            // Fallback: last coordinate pair in row text
            var coords = [];
            var re = /\b(\d{1,3})\|(\d{1,3})\b/g;
            var rowText = $row.text();
            var m2;
            while ((m2 = re.exec(rowText)) !== null) { coords.push([m2[1], m2[2]]); }
            if (coords.length) {
                var last = coords[coords.length - 1];
                callback(last[0], last[1]);
                return;
            }

        } else {
            // info_village: skip own village, pick first attacker link
            var currentCoord = (currentVid && villageMap[currentVid])
                ? villageMap[currentVid].x + '|' + villageMap[currentVid].y : null;

            var found2 = null;
            $links.each(function () {
                var href = $(this).attr('href') || '';
                var m = href.match(/[?&]id=(\d+)/);
                if (!m || m[1] === currentVid) return;
                var v = villageMap[m[1]];
                if (v) { found2 = { x: v.x, y: v.y }; return false; }
            });
            if (found2) { callback(found2.x, found2.y); return; }

            // Fallback: first coordinate that isn't own village
            var re2 = /\b(\d{1,3})\|(\d{1,3})\b/g;
            var rowText2 = $row.text();
            var m3;
            while ((m3 = re2.exec(rowText2)) !== null) {
                if ((m3[1] + '|' + m3[2]) !== currentCoord) {
                    callback(m3[1], m3[2]);
                    return;
                }
            }
        }

        console.warn('[IncCheck] Keine Angriffskoordinaten in Zeile gefunden:', $row.text().trim().substring(0, 80));
    }

    // ── Threat assessment ─────────────────────────────────────────────────
    // API returns attack_report / defend_report with troop counts, no building data.
    function assessThreat(data) {
        if (data === null) {
            return { label: '?', bg: '#888', title: 'Nicht in Datenbank' };
        }

        var ar = data.attack_report;
        var hasReport = ar && +ar.fighttime > 0;
        var snob = hasReport ? +ar.snob || 0 : 0;
        var axe  = hasReport ? +ar.axe   || 0 : 0;
        var lc   = hasReport ? +ar.light  || 0 : 0;
        var hc   = hasReport ? +ar.heavy  || 0 : 0;
        var ram  = hasReport ? +ar.ram    || 0 : 0;
        var cat  = hasReport ? +ar.catapult || 0 : 0;
        var totalOff = axe + lc + hc + ram + cat;

        if (snob > 0) {
            return { label: 'ADEL!', bg: '#b00000',
                     title: 'Hat ' + snob + ' Adel eingesetzt — Adelszug möglich!' };
        }

        if (!hasReport) {
            var t = +data.type;
            return { label: t === 1 ? 'OFF' : t === 0 ? 'DEFF' : 'DB',
                     bg:    t === 1 ? '#d06000' : '#4466aa',
                     title: 'Kein Angriffsbericht in DB' };
        }

        if (totalOff === 0) {
            return { label: 'FAKE?', bg: '#2a8a2a',
                     title: 'Nur Aufklärer im letzten Bericht — wahrscheinlich Fake' };
        }

        var parts = [];
        if (axe) parts.push(axe + ' Äxte');
        if (lc)  parts.push(lc  + ' LA');
        if (hc)  parts.push(hc  + ' SA');
        if (ram) parts.push(ram + ' Rammen');
        if (cat) parts.push(cat + ' Katas');
        return { label: 'OFF', bg: '#d06000',
                 title: 'Letzter Angriff: ' + parts.join(', ') + ' — kein Adel gesehen' };
    }

    // ── Badge ─────────────────────────────────────────────────────────────
    function makeBadge(threat) {
        return $('<span class="icbadge">')
            .text(threat.label)
            .attr('title', threat.title)
            .css({ display: 'inline-block', padding: '1px 5px', background: threat.bg,
                   color: '#fff', fontWeight: 'bold', fontSize: '10px',
                   borderRadius: '2px', marginLeft: '5px', cursor: 'default', verticalAlign: 'middle' });
    }

    function makeSpinner() {
        return $('<span class="icbadge">…</span>').css({
            display: 'inline-block', padding: '1px 5px', background: '#aaa',
            color: '#fff', fontWeight: 'bold', fontSize: '10px',
            borderRadius: '2px', marginLeft: '5px', verticalAlign: 'middle' });
    }

    // ── Process one row ───────────────────────────────────────────────────
    function processRow($row) {
        if ($row.data('ic-done')) return;
        $row.data('ic-done', true);

        getAttackerXY($row, function (x, y) {
            var $cell = $row.find('td').filter(function () { return $(this).text().trim().length > 0; }).first();
            if (!$cell.length) $cell = $row.find('td').first();

            var $spinner = makeSpinner();
            $cell.append($spinner);

            queryVillage(x, y, function (data) {
                $spinner.replaceWith(makeBadge(assessThreat(data)));
            });
        });
    }

    // ── Scan ──────────────────────────────────────────────────────────────
    function scanRows() {
        var $rows;
        if (isIncomings) {
            // Find the incomings table by its column headers, not by class/id
            var $table = $();
            $('th').each(function () {
                var t = $(this).text().trim();
                if (t === 'Befehl' || t === 'Herkunft') {
                    $table = $(this).closest('table');
                    return false;
                }
            });
            if ($table.length) {
                $rows = $table.find('tr').filter(function () { return $(this).find('td').length >= 3; });
            } else {
                // Fallback: coordinate-based scan
                $rows = $('tr').filter(function () {
                    return $(this).find('td').length >= 3 && /\d{1,3}\|\d{1,3}/.test($(this).text());
                });
            }
        } else {
            $rows = $('#commands_incomings tr').filter(function () { return $(this).find('td').length >= 2; });
        }
        console.log('[IncCheck] scanRows: ' + $rows.length + ' candidate rows');
        $rows.each(function () { processRow($(this)); });
    }

    // ── Init ──────────────────────────────────────────────────────────────
    withVillageMap(function () {
        scanRows();
        var _t = null;
        new MutationObserver(function () {
            clearTimeout(_t);
            _t = setTimeout(scanRows, 300);
        }).observe(document.getElementById('contentContainer') || document.body, { childList: true, subtree: true });
    });

    console.log('[IncCheck] ' + VERSION + ' geladen — ' + twScreen + (twMode ? '/' + twMode : ''));

})();
