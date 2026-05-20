(function () {

    // === CONFIG ===
    var VERSION    = 'v3';
    var API_URL    = (window.serverConfig && window.serverConfig.sfAPI) || 'https://api.twmeta.net/intel/village';
    var REPORT_URL  = (window.serverConfig && window.serverConfig.reportPage)   || 'https://twmeta.net/dashboard/reports?reportid=$$reportID$$';
    var VILLAGE_URL = (window.serverConfig && window.serverConfig.villageDetail) || 'https://twmeta.net/dashboard/villages/$$village$$';
    var DB_KEY     = window.INCCHECK_DB_KEY || localStorage.getItem('dbkey') || '';
    var CACHE_TTL  = 10 * 60 * 1000; // 10 min

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
                    villageMap[p[0]] = { x: p[2], y: p[3],
                        name: decodeURIComponent(p[1].replace(/\+/g, '%20')),
                        pid: (p[4] || '').trim() };
                }
            });
            console.log('[IncCheck] Village map loaded, entries: ' + Object.keys(villageMap).length);
        }).always(function () {
            villageMapReady = true;
            vmQueue.forEach(function (fn) { fn(); });
            vmQueue = [];
        });
    }

    // ── Conquer map ───────────────────────────────────────────────────────
    // /map/conquer.txt: village_id,unix_ts,new_player_id,old_player_id
    var conquerMap      = {};
    var conquerMapReady = false;
    var cmQueue         = [];

    function withConquerMap(cb) {
        if (conquerMapReady) { cb(); return; }
        cmQueue.push(cb);
        if (cmQueue.length > 1) return;
        $.get('/map/conquer.txt', function (txt) {
            txt.split('\n').forEach(function (line) {
                var p = line.trim().split(',');
                if (p.length < 3) return;
                var vid = p[0], ts = +p[1], newPid = p[2], oldPid = (p[3] || '').trim();
                if (!conquerMap[vid] || ts > conquerMap[vid].ts) {
                    conquerMap[vid] = { ts: ts, newPid: newPid, oldPid: oldPid };
                }
            });
            console.log('[IncCheck] Conquer map loaded, entries: ' + Object.keys(conquerMap).length);
        }).always(function () {
            conquerMapReady = true;
            cmQueue.forEach(function (fn) { fn(); });
            cmQueue = [];
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
    function queryVillage(x, y, cb) {
        var coord  = x + '|' + y;
        var cached = cacheGet(coord);
        if (cached !== undefined) {
            console.log('[IncCheck] gecacht (' + coord + '):', JSON.stringify(cached, null, 2));
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
                console.log('[IncCheck] API (' + coord + '):', JSON.stringify(data, null, 2));
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
                    found = { x: villageMap[m[1]].x, y: villageMap[m[1]].y, id: m[1] };
                    // don't break — we want the LAST one
                }
            });
            if (found) { callback(found.x, found.y, found.id); return; }

            // Fallback: last coordinate pair in row text (no village ID available)
            var coords = [];
            var re = /\b(\d{1,3})\|(\d{1,3})\b/g;
            var rowText = $row.text();
            var m2;
            while ((m2 = re.exec(rowText)) !== null) { coords.push([m2[1], m2[2]]); }
            if (coords.length) {
                var last = coords[coords.length - 1];
                callback(last[0], last[1], null);
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
                if (v) { found2 = { x: v.x, y: v.y, id: m[1] }; return false; }
            });
            if (found2) { callback(found2.x, found2.y, found2.id); return; }

            // Fallback: first coordinate that isn't own village
            var re2 = /\b(\d{1,3})\|(\d{1,3})\b/g;
            var rowText2 = $row.text();
            var m3;
            while ((m3 = re2.exec(rowText2)) !== null) {
                if ((m3[1] + '|' + m3[2]) !== currentCoord) {
                    callback(m3[1], m3[2], null);
                    return;
                }
            }
        }

        console.warn('[IncCheck] Keine Angriffskoordinaten in Zeile gefunden:', $row.text().trim().substring(0, 80));
    }

    // ── Building data extraction ──────────────────────────────────────────
    var BUILDING_KEYS = {
        main: 'Hauptgebäude', barracks: 'Kaserne', stable: 'Stall', garage: 'Werkstatt',
        smith: 'Schmiede', snob: 'Adelshof', wall: 'Wall', storage: 'Speicher',
        hide: 'Versteck', farm: 'Bauernhof', market: 'Markt', wood: 'Sägewerk',
        stone: 'Lehmgrube', iron: 'Eisenmine', watchtower: 'Wachturm'
    };

    function findBuildings(data) {
        if (!data) return null;
        var nested = data.buildings || data.gebaeude || data.gdb || data.gdbdata || data.b;
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
        var top = Object.keys(BUILDING_KEYS);
        for (var i = 0; i < top.length; i++) {
            if (data[top[i]] != null) return data;
        }
        return null;
    }

    // ── Threat assessment ─────────────────────────────────────────────────
    // Priority: 1) noble unit in TW table  2) noble seen in ANY report
    // 3) building data  4) unit type fallback
    // Report history beats stale building data — if nobles were ever seen,
    // the village had smithy 20 at some point regardless of what buildings say now.
    function assessThreat(data, unitType) {
        // Noble unit directly in this wave — certain
        if (unitType === 'snob') {
            return { label: 'ADEL!', bg: '#b00000', title: 'Adelszug in diesem Angriff!' };
        }

        // Noble seen in any report — overrides everything including building data,
        // because building data can be months old while report proves capability existed.
        var snobSeen = (data && data.attack_report && +data.attack_report.snob > 0)
                    || (data && data.defend_report  && +data.defend_report.snob  > 0);
        if (snobSeen) {
            return { label: 'ADEL!', bg: '#b00000', title: 'Adel in Berichten gesehen!' };
        }

        // Building data — reliable when fresh
        var buildings = findBuildings(data);
        if (buildings) {
            var smith = +(buildings.smith || buildings.schmiede || 0);
            var snob  = +(buildings.snob  || buildings.adelshof  || 0);
            if (smith >= 20 && snob > 0) {
                return { label: 'ADEL!', bg: '#b00000', title: 'Schmiede 20 + Adelshof — adelsfähig!' };
            }
            if (smith >= 20) {
                return { label: 'ADM?', bg: '#c84800', title: 'Schmiede 20, kein Adelshof' };
            }
            return { label: 'FAKE', bg: '#2a8a2a', title: 'Schmiede ' + smith + '/20 laut DB' };
        }

        // Nothing useful in DB
        if (!data) return { label: '?', bg: '#555', title: 'Nicht in DB' };
        if (unitType === 'ram' || unitType === 'catapult') {
            return { label: 'RAM', bg: '#888', title: 'Ramme — keine Gebäudedaten in DB' };
        }
        return { label: '?', bg: '#666', title: 'Keine Gebäudedaten in DB' };
    }

    // ── Popup — buildings + report link only ──────────────────────────────
    function showPopup($badge, data, coord) {
        $('.icpopup').remove();
        if ($badge.data('pop')) { $badge.data('pop', false); return; }
        $badge.data('pop', true);

        // Fight report link — only valid when there's an actual recorded fight
        var hasFightReport = data && (
            (data.attack_report && +data.attack_report.fighttime) ||
            (data.defend_report  && +data.defend_report.fighttime)
        );
        var reportUrl  = (hasFightReport && data.report_id)
            ? REPORT_URL.replace('$$reportID$$', data.report_id) : null;
        // Village detail link — shows building scans and all report history
        var villageUrl = (data && data.village_id)
            ? VILLAGE_URL.replace('$$village$$', data.village_id) : null;

        var $p = $('<div class="icpopup">').css({
            position: 'fixed', zIndex: 99999, background: '#f4e4bc',
            border: '2px solid #7d510f', borderRadius: '4px',
            padding: '8px 10px', fontSize: '12px', minWidth: '200px', maxWidth: '300px',
            boxShadow: '3px 3px 10px rgba(0,0,0,0.5)', cursor: 'auto',
            top:  Math.min($badge.offset().top - $(window).scrollTop() + 24, $(window).height() - 180) + 'px',
            left: Math.min($badge.offset().left, $(window).width() - 310) + 'px'
        });

        // Header
        var $hdr = $('<div>').css({ fontWeight: 'bold', borderBottom: '1px solid #7d510f',
            paddingBottom: '4px', marginBottom: '6px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
        $hdr.append($('<span>').text(coord));
        $hdr.append($('<span>').text('✕').css({ cursor: 'pointer', opacity: 0.6 })
            .on('click', function () { $p.remove(); $badge.data('pop', false); }));
        $p.append($hdr);

        // Off troops warning
        var off = offSummary(data);
        if (off) {
            $p.append($('<div>').css({ background: '#d06000', color: '#fff', borderRadius: '3px',
                padding: '3px 6px', marginBottom: '6px', fontWeight: 'bold', fontSize: '11px' })
                .text('⚔ OFF: ' + off.parts.join(', ')));
        }

        // Buildings
        var buildings = findBuildings(data);
        if (buildings) {
            var ts = data.gdb_ts || data.updated_at || data.ts || null;
            if (ts) {
                $p.append($('<div>').css({ fontSize: '10px', color: '#888', marginBottom: '5px' })
                    .text('Stand: ' + new Date(+ts * (ts < 1e10 ? 1000 : 1)).toLocaleDateString('de-DE')));
            }
            var $bldgs = $('<div>').css({ display: 'flex', flexWrap: 'wrap', gap: '6px' });
            Object.keys(BUILDING_KEYS).forEach(function (k) {
                var lvl = buildings[k];
                if (lvl == null) return;
                var highlight = (k === 'smith' && +lvl >= 20) || (k === 'snob' && +lvl > 0);
                $bldgs.append(
                    $('<span>').attr('title', BUILDING_KEYS[k] + ' ' + lvl).css({
                        display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
                        fontSize: '10px', background: highlight ? '#c84800' : '#e8d5a3',
                        color: highlight ? '#fff' : '#333',
                        borderRadius: '3px', padding: '2px 4px' })
                        .append($('<img>').attr('src', '/graphic/buildings/' + k + '.png')
                            .css({ width: '24px', height: '24px' }))
                        .append($('<span>').text(lvl))
                );
            });
            $p.append($bldgs);
        } else {
            $p.append($('<div>').css({ color: '#999', fontSize: '11px' })
                .text('Keine Gebäudedaten in DB'));
        }

        // Links
        if (reportUrl || villageUrl) {
            var $links = $('<div>').css({ marginTop: '8px', display: 'flex', gap: '10px' });
            if (reportUrl) {
                $links.append($('<a>').attr({ href: reportUrl, target: '_blank' })
                    .css({ color: '#004494', fontSize: '11px' })
                    .text('Kampfbericht →'));
            }
            if (villageUrl) {
                $links.append($('<a>').attr({ href: villageUrl, target: '_blank' })
                    .css({ color: '#004494', fontSize: '11px' })
                    .text('Dorf-Detail →'));
            }
            $p.append($links);
        }

        $('body').append($p);
        setTimeout(function () {
            $(document).one('click.icpopup', function (e) {
                if (!$(e.target).closest('.icpopup, .icbadge').length) {
                    $p.remove(); $badge.data('pop', false);
                }
            });
        }, 50);
    }

    // ── Off troop detection ───────────────────────────────────────────────
    function offSummary(data) {
        var ar = data && data.attack_report;
        if (!ar || !+ar.fighttime) return null;
        var axe   = +ar.axe   || 0;
        var light = +ar.light || 0;
        var heavy = +ar.heavy || 0;
        var ram   = +ar.ram   || 0;
        var total = axe + light + heavy + ram;
        if (!total) return null;
        var parts = [];
        if (axe)   parts.push(axe   + ' Äxte');
        if (light) parts.push(light + ' LA');
        if (heavy) parts.push(heavy + ' SA');
        if (ram)   parts.push(ram   + ' Rammen');
        return { total: total, parts: parts };
    }

    // ── Badge ─────────────────────────────────────────────────────────────
    function makeBadge(threat, data, coord) {
        var $b = $('<span class="icbadge">')
            .text(threat.label)
            .attr('title', threat.title)
            .css({ display: 'inline-block', padding: '2px 6px', background: threat.bg,
                   color: '#fff', fontWeight: 'bold', fontSize: '11px',
                   borderRadius: '3px', marginLeft: '5px', cursor: 'pointer',
                   verticalAlign: 'middle', userSelect: 'none' })
            .on('click', function (e) { e.stopPropagation(); showPopup($(this), data, coord); });

        var off = offSummary(data);
        if (off) {
            var $off = $('<span class="icbadge">')
                .text('OFF')
                .attr('title', 'Bekannte Off-Truppen: ' + off.parts.join(', '))
                .css({ display: 'inline-block', padding: '2px 6px', background: '#d06000',
                       color: '#fff', fontWeight: 'bold', fontSize: '11px',
                       borderRadius: '3px', marginLeft: '3px', cursor: 'pointer',
                       verticalAlign: 'middle', userSelect: 'none' })
                .on('click', function (e) { e.stopPropagation(); showPopup($b, data, coord); });
            return $('<span>').append($b).append($off);
        }

        return $b;
    }

    function makeSpinner() {
        return $('<span class="icbadge">…</span>').css({
            display: 'inline-block', padding: '1px 5px', background: '#aaa',
            color: '#fff', fontWeight: 'bold', fontSize: '10px',
            borderRadius: '2px', marginLeft: '5px', verticalAlign: 'middle' });
    }

    // ── Read slowest unit from TW's own Befehl cell ───────────────────────
    // TW shows the slowest unit icon/name in the first cell. Noble (35 mpf) is
    // slower than ram (30 mpf), so "Ramme" in Befehl = this wave cannot be noble.
    function getUnitFromRow($row) {
        var $td  = $row.find('td').first();
        var src  = ($td.find('img').attr('src') || '').toLowerCase();
        var txt  = $td.text().toLowerCase();
        if (/snob/.test(src)   || /snob|adel/.test(txt))       return 'snob';
        if (/ram/.test(src)    || /ramme/.test(txt))            return 'ram';
        if (/catapult/.test(src) || /katapult/.test(txt))       return 'catapult';
        if (/heavy/.test(src)  || /schwere\s+kavallerie/.test(txt)) return 'heavy';
        if (/light/.test(src)  || /leichte\s+kavallerie/.test(txt)) return 'light';
        if (/axe/.test(src)    || /\baxt\b/.test(txt))          return 'axe';
        if (/spy/.test(src)    || /sp[äa]her/.test(txt))        return 'spy';
        if (/spear/.test(src)  || /speer/.test(txt))            return 'spear';
        if (/sword/.test(src)  || /schwert/.test(txt))          return 'sword';
        return null;
    }

    // ── Process one row ───────────────────────────────────────────────────
    function processRow($row) {
        if ($row.data('ic-done')) return;
        $row.data('ic-done', true);

        var unitType = getUnitFromRow($row);

        getAttackerXY($row, function (x, y, vid) {
            var $cell = $row.find('td').filter(function () { return $(this).text().trim().length > 0; }).first();
            if (!$cell.length) $cell = $row.find('td').first();

            var $spinner = makeSpinner();
            $cell.append($spinner);

            queryVillage(x, y, function (data) {
                var threat = assessThreat(data, unitType);

                withConquerMap(function () {
                    var recentlyConquered = false;
                    var daysAgo = 0;
                    var c = null;
                    if (vid && conquerMap[vid]) {
                        c = conquerMap[vid];
                        var curPid = villageMap[vid] && villageMap[vid].pid;
                        daysAgo = Math.floor((Date.now() / 1000 - c.ts) / 86400);
                        if (curPid && c.newPid === curPid && daysAgo <= 21) {
                            recentlyConquered = true;
                        }
                    }

                    var $badge;
                    if (recentlyConquered) {
                        // Find the newest report timestamp we have — if it's after the conquest,
                        // the data belongs to the new owner and is valid.
                        var ar = data && data.attack_report;
                        var dr = data && data.defend_report;
                        var latestReportTs = 0;
                        var arFt = ar && +ar.fighttime;
                        var drFt = dr && +dr.fighttime;
                        // fighttime is a unix timestamp when > 1e9 (post-2001)
                        if (arFt > 1e9) latestReportTs = Math.max(latestReportTs, arFt);
                        if (drFt > 1e9) latestReportTs = Math.max(latestReportTs, drFt);
                        if (!latestReportTs) {
                            var dataTs = +(data && (data.gdb_ts || data.updated_at || data.ts) || 0);
                            if (dataTs > 1e9) latestReportTs = dataTs;
                        }
                        var hasNewOwnerData = latestReportTs > 0 && latestReportTs > c.ts;

                        var $adelt = $('<span class="icbadge">')
                            .text('ADELT ' + daysAgo + 'd')
                            .attr('title', 'Dorf vor ' + daysAgo + 'd übernommen — DB-Daten ggf. vom Vorbesitzer')
                            .css({ display: 'inline-block', padding: '2px 6px', background: '#c84800',
                                   color: '#fff', fontWeight: 'bold', fontSize: '11px',
                                   borderRadius: '3px', marginLeft: '3px', cursor: 'default',
                                   verticalAlign: 'middle', userSelect: 'none' });

                        if (unitType === 'snob') {
                            // TW Befehl column shows noble — live game data, always trust it
                            var $adel = $('<span class="icbadge">')
                                .text('ADEL!')
                                .attr('title', 'Adelszug laut Befehlsspalte!')
                                .css({ display: 'inline-block', padding: '2px 6px', background: '#b00000',
                                       color: '#fff', fontWeight: 'bold', fontSize: '11px',
                                       borderRadius: '3px', marginLeft: '5px', cursor: 'pointer',
                                       verticalAlign: 'middle', userSelect: 'none' })
                                .on('click', function (e) { e.stopPropagation(); showPopup($(this), data, x + '|' + y); });
                            $badge = $('<span>').append($adel).append($adelt);
                        } else if (hasNewOwnerData) {
                            // Report is from after the conquest — new owner's data, use it normally
                            $badge = $('<span>').append(makeBadge(threat, data, x + '|' + y)).append($adelt);
                        } else {
                            // No post-conquest data — can't assess threat, just flag the conquest
                            $badge = $adelt;
                        }
                    } else {
                        $badge = makeBadge(threat, data, x + '|' + y);
                    }
                    $spinner.replaceWith($badge);
                });
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
        withConquerMap(function () {
            scanRows();
            var _t = null;
            new MutationObserver(function () {
                clearTimeout(_t);
                _t = setTimeout(scanRows, 300);
            }).observe(document.getElementById('contentContainer') || document.body, { childList: true, subtree: true });
        });
    });

    console.log('[IncCheck] ' + VERSION + ' geladen — ' + twScreen + (twMode ? '/' + twMode : ''));

})();
