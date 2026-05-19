(function () {

    // === CONFIG ===
    var VERSION  = 'v2';
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
        if (cached !== undefined) { cb(cached); return; }

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
    // Strategy A: info_village link with id= param → village map lookup
    // Strategy B: coordinate text regex → exclude current village coord
    function getAttackerXY($row, callback) {
        // Current village coord for exclusion
        var currentCoord = null;
        if (currentVid && villageMap[currentVid]) {
            var cv = villageMap[currentVid];
            currentCoord = cv.x + '|' + cv.y;
        }

        // Strategy A — find enemy info_village link
        var $links = $row.find('a[href*="info_village"]');
        var found = null;
        $links.each(function () {
            var href = $(this).attr('href') || '';
            var m    = href.match(/[?&]id=(\d+)/);
            if (!m) return;
            if (m[1] === currentVid) return; // skip link to own village
            var v = villageMap[m[1]];
            if (v) { found = { x: v.x, y: v.y }; return false; }
        });
        if (found) { callback(found.x, found.y); return; }

        // Strategy B — coordinate regex on row text (works on incomings overview)
        var rowText = $row.text();
        var re = /\b(\d{1,3})\|(\d{1,3})\b/g;
        var match;
        while ((match = re.exec(rowText)) !== null) {
            var coord = match[1] + '|' + match[2];
            if (coord !== currentCoord) {
                callback(match[1], match[2]);
                return;
            }
        }
    }

    // ── Threat assessment ─────────────────────────────────────────────────
    // TODO: update field paths once we see the real API response in the console log.
    function assessThreat(data) {
        if (data === null) {
            return { label: 'KEIN DB', bg: '#888', title: 'Kein Datenbankeintrag' };
        }

        var buildings  = data.buildings || data.gebaeude || data.b || null;
        var smithLevel = null;
        var nobleLevel = null;

        if (buildings) {
            smithLevel = buildings.smith    != null ? buildings.smith    :
                         buildings.schmiede != null ? buildings.schmiede : null;
            nobleLevel = buildings.snob     != null ? buildings.snob     :
                         buildings.noble    != null ? buildings.noble    :
                         buildings.adelshof != null ? buildings.adelshof : null;
        }
        if (smithLevel === null) smithLevel = data.smith    != null ? data.smith    :
                                              data.schmiede != null ? data.schmiede : null;
        if (nobleLevel === null) nobleLevel = data.snob     != null ? data.snob     :
                                              data.noble    != null ? data.noble    : null;

        var hasSmith20 = smithLevel !== null ? +smithLevel >= 20 : null;
        var hasNoble   = nobleLevel !== null ? +nobleLevel > 0   : null;
        var isOff      = +data.type === 1;

        if (hasSmith20 === false) {
            return { label: 'FAKE',     bg: '#2a8a2a', title: 'Schmiede ' + smithLevel + '/20 — Adel unmöglich' };
        }
        if (hasNoble === true) {
            return { label: 'ADEL!',    bg: '#b00000', title: 'Adelshof vorhanden — Adelszug möglich!' };
        }
        if (hasSmith20 === true) {
            return { label: isOff ? 'OFF+ADM' : 'ADM?', bg: isOff ? '#c84800' : '#9a6000',
                     title: 'Schmiede 20 — Adel möglich' + (isOff ? ', Off-Dorf' : '') };
        }
        if (isOff) {
            return { label: 'OFF',  bg: '#d06000', title: 'Off-Dorf laut DB (keine Gebäudedaten)' };
        }
        return     { label: 'DEFF', bg: '#4466aa', title: 'Deff-Dorf laut DB (keine Gebäudedaten)' };
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
            // Attach spinner to first non-empty cell that has visible text
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
        // info_village incoming commands
        $('#commands_incomings').find('tr.command-row, tr[id^="cmd"]').each(function () { processRow($(this)); });
        // incomings overview table (multiple possible selectors across TW versions)
        $('table.overview_table tr, table#in_table tr, .commands-table tr').filter('.command-row, [id^="cmd"]').each(function () { processRow($(this)); });
        // broad fallback: any command-row on the page
        $('tr.command-row').not('[data-ic-done]').each(function () { processRow($(this)); });
    }

    // ── Init ──────────────────────────────────────────────────────────────
    withVillageMap(function () {
        scanRows();
        // Re-scan when TW updates the DOM (AJAX table refresh)
        var _t = null;
        new MutationObserver(function () {
            clearTimeout(_t);
            _t = setTimeout(scanRows, 300);
        }).observe(document.getElementById('contentContainer') || document.body, { childList: true, subtree: true });
    });

    console.log('[IncCheck] ' + VERSION + ' geladen — ' + twScreen + (twMode ? '/' + twMode : ''));

})();
