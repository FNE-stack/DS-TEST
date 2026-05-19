(function () {

    // === CONFIG ===
    var VERSION  = 'v1';
    var API_URL  = (window.serverConfig && window.serverConfig.sfAPI) || 'https://api.twmeta.net/intel/village';
    var DB_KEY   = window.INCCHECK_DB_KEY || localStorage.getItem('dbkey') || '';
    var CACHE_TTL = 10 * 60 * 1000; // 10 min per coord

    if (!DB_KEY) {
        alert('[IncCheck] Kein DB-Key gefunden.\nBitte "dbkey" in localStorage setzen oder window.INCCHECK_DB_KEY vor dem Aufruf definieren.');
        return;
    }

    var params     = new URL(location.href).searchParams;
    var twScreen   = params.get('screen');
    var twMode     = params.get('mode');
    var currentVid = (typeof game_data !== 'undefined' && game_data.village) ? String(game_data.village.id) : null;

    if (twScreen !== 'info_village' && !(twScreen === 'overview' && twMode === 'incomings')) {
        alert('[IncCheck] Bitte auf der Dorfinfoseite oder der Eingehenden-Übersicht ausführen.');
        return;
    }

    // ── Village map (id → {x, y, name}) ──────────────────────────────────
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
                    villageMap[p[0]] = {
                        x:    p[2],
                        y:    p[3],
                        name: decodeURIComponent(p[1].replace(/\+/g, '%20'))
                    };
                }
            });
        }).always(function () {
            villageMapReady = true;
            vmQueue.forEach(function (fn) { fn(); });
            vmQueue = [];
        });
    }

    // ── Session cache ─────────────────────────────────────────────────────
    var NS = 'inccheck_' + VERSION + '_';

    function cacheGet(coord) {
        try {
            var raw = sessionStorage.getItem(NS + coord);
            if (!raw) return undefined;
            var e = JSON.parse(raw);
            if (Date.now() - e.ts > CACHE_TTL) { sessionStorage.removeItem(NS + coord); return undefined; }
            return e.data; // may be null (no DB entry)
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
                    console.log('[IncCheck] Beispiel-API-Antwort (' + coord + '):', JSON.stringify(data, null, 2));
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

    // ── Threat assessment ─────────────────────────────────────────────────
    // TODO: update field paths below once we see the real API response in the console.
    function assessThreat(data) {
        if (data === null) {
            return { label: 'KEIN DB', bg: '#888', title: 'Kein Datenbankeintrag für dieses Dorf' };
        }

        var buildings  = data.buildings || data.gebaeude || data.b || null;
        var smithLevel = null;
        var nobleLevel = null;

        if (buildings) {
            smithLevel = buildings.smith    ?? buildings.schmiede ?? buildings.smithy   ?? null;
            nobleLevel = buildings.snob     ?? buildings.noble    ?? buildings.adelshof ?? null;
        }
        if (smithLevel === null) smithLevel = data.smith    ?? data.schmiede ?? null;
        if (nobleLevel === null) nobleLevel = data.snob     ?? data.noble    ?? null;

        var hasSmith20 = smithLevel !== null ? +smithLevel >= 20 : null;
        var hasNoble   = nobleLevel !== null ? +nobleLevel > 0   : null;
        var isOff      = +data.type === 1;

        if (hasSmith20 === false) {
            return {
                label: 'FAKE',
                bg: '#2a8a2a',
                title: 'Schmiede ' + smithLevel + '/20 — Adel unmöglich, Fake ignorieren'
            };
        }
        if (hasNoble === true) {
            return {
                label: 'ADEL!',
                bg: '#b00000',
                title: 'Adelshof vorhanden — Adelszug möglich!'
            };
        }
        if (hasSmith20 === true) {
            return {
                label: isOff ? 'OFF+ADM' : 'ADM?',
                bg: isOff ? '#c84800' : '#9a6000',
                title: 'Schmiede 20 — Adel möglich' + (isOff ? ', Off-Dorf' : '')
            };
        }

        // No building data — fall back to village type
        if (isOff) {
            return { label: 'OFF', bg: '#d06000', title: 'Off-Dorf laut DB (keine Gebäudedaten)' };
        }

        return { label: 'DEFF', bg: '#4466aa', title: 'Deff-Dorf laut DB (keine Gebäudedaten)' };
    }

    // ── Badge ─────────────────────────────────────────────────────────────
    function makeBadge(threat) {
        return $('<span class="icbadge">')
            .text(threat.label)
            .attr('title', threat.title)
            .css({
                display:       'inline-block',
                padding:       '1px 5px',
                background:    threat.bg,
                color:         '#fff',
                fontWeight:    'bold',
                fontSize:      '10px',
                borderRadius:  '2px',
                marginLeft:    '5px',
                cursor:        'default',
                verticalAlign: 'middle',
            });
    }

    // ── Process one row ───────────────────────────────────────────────────
    function processRow($row) {
        if ($row.data('ic-done')) return;
        $row.data('ic-done', true);

        var $link = $row.find('a[href*="info_village"]').filter(function () {
            var m = $(this).attr('href').match(/[?&]id=(\d+)/);
            return m && m[1] !== currentVid;
        }).first();

        if (!$link.length) return;

        var m = $link.attr('href').match(/[?&]id=(\d+)/);
        if (!m) return;

        withVillageMap(function () {
            var v = villageMap[m[1]];
            if (!v) return;

            // Show loading spinner
            var $spinner = $('<span class="icbadge">…</span>').css({
                display: 'inline-block', padding: '1px 5px', background: '#aaa',
                color: '#fff', fontWeight: 'bold', fontSize: '10px',
                borderRadius: '2px', marginLeft: '5px', verticalAlign: 'middle',
            });
            $link.after($spinner);

            queryVillage(v.x, v.y, function (data) {
                $spinner.replaceWith(makeBadge(assessThreat(data)));
            });
        });
    }

    // ── Scan all incoming rows ────────────────────────────────────────────
    function scanRows() {
        $('#commands_incomings tr.command-row').each(function () { processRow($(this)); });
        $('table.overview_table tr.command-row, #in_table tr.command-row, tr.command-row').each(function () { processRow($(this)); });
    }

    // ── Run ───────────────────────────────────────────────────────────────
    withVillageMap(scanRows);

    // Re-scan if TW refreshes the table
    var _t = null;
    new MutationObserver(function () {
        clearTimeout(_t);
        _t = setTimeout(scanRows, 300);
    }).observe(document.getElementById('contentContainer') || document.body, { childList: true, subtree: true });

    console.log('[IncCheck] ' + VERSION + ' geladen — ' + twScreen + (twMode ? '/' + twMode : ''));

})();
