// twmeta troop-upload quickbar script
// Auf der Truppen-Seite ausfuehren:
//   /game.php?screen=overview_villages&type=complete&mode=units&group=0
// Liest die Truppen aller Doerfer aus der Tabelle und POSTet sie an die twmeta-API.
//
// Quickbar-Eintrag:
//   javascript:$.getScript('https://YOUR-HOST/twmeta_upload.js');
//
// CORS-Hinweis: Wenn der Browser den POST mit
//   "blocked by CORS policy: No 'Access-Control-Allow-Origin' header"
// abweist, muss das Ganze als Userscript mit GM_xmlhttpRequest laufen
// (siehe Block am Ende dieser Datei) — der Quickbar-fetch() unterliegt
// der CORS-Policy von api.twmeta.net.

(function(){
    "use strict";

    // === CONFIG ===
    var API_KEY            = "tw_IC1liGAw25BfyJ961jo8-rxWsj6V3I9H4uKVmVgr87HumN_b";
    var LINKED_ACCOUNT_ID  = 46;
    var API_URL            = "https://api.twmeta.net/tribalwars/attack-planner/village-troops";
    var THROTTLE_MS        = 80;          // Pause zwischen POSTs, damit die API nicht spamt

    // === Page selber holen (egal wo der User gerade ist) ===
    // mode=combined&page=-1 → ALLE Dörfer auf einer Seite mit Truppen-Spalten.
    // Genau dieselbe Quelle die snipe.js benutzt.
    var fetchUrl = (typeof game_data !== "undefined" && game_data.link_base_pure)
                   ? game_data.link_base_pure + "overview_villages&mode=combined&group=0&page=-1"
                   : "/game.php?screen=overview_villages&mode=combined&group=0&page=-1";

    UI.SuccessMessage("Lese Truppen aus überdorfsicht…");

    $.get(fetchUrl).done(function(html) {
        parseAndUpload(html);
    }).fail(function(xhr) {
        UI.ErrorMessage("Konnte Übersicht nicht laden (Status " + (xhr && xhr.status) + ").");
    });

    function parseAndUpload(html) {
        var $doc = $($.parseHTML(html));
        var isMobile = $doc.find("#mobileHeader").length > 0 || $("#mobileHeader").length > 0;

        var villages = isMobile ? parseMobile($doc) : parseDesktop($doc);
        if (!villages.length) {
            console.warn("[twmeta] Parser fand keine Dörfer. Erste 500 Zeichen der Response:",
                         html.substring(0, 500));
            UI.ErrorMessage("Keine Dörfer in Übersicht gefunden — siehe Console.");
            return;
        }
        uploadAll(villages);
    }

    function parseDesktop($doc) {
        // Erst #combined_table, dann jede beliebige Tabelle deren Header Unit-Bilder enthält.
        var $table = $doc.find("#combined_table");
        if (!$table.length) {
            $doc.find("table").each(function() {
                if ($(this).find("th img[src*='unit_']").length >= 3) { $table = $(this); return false; }
            });
        }
        if (!$table.length) { console.warn("[twmeta] keine Truppen-Tabelle gefunden"); return []; }

        var $head = $table.find("tr").first().find("th");
        var colUnit = {};
        $head.each(function(idx) {
            var src = $(this).find("img").attr("src") || "";
            var m = src.match(/unit_([a-z_]+)\.(png|webp)/i);
            if (m) colUnit[idx] = m[1];
        });
        console.log("[twmeta] Spalten:", colUnit);

        var villages = [];
        $table.find("tr").each(function() {
            var $tr = $(this);
            if (!$tr.find("td").length) return; // Header-Reihe
            var c = $tr.text().match(/\((\d+)\|(\d+)\)/);
            if (!c) return;
            var coord = String(c[1]).padStart(3, "0") + String(c[2]).padStart(3, "0");
            var troops = {};
            var $tds = $tr.find("td");
            Object.keys(colUnit).forEach(function(idx) {
                var n = parseInt(($tds.eq(parseInt(idx,10)).text() || "").replace(/\D/g, ""), 10);
                troops[colUnit[idx]] = isNaN(n) ? 0 : n;
            });
            villages.push({ coord: coord, troops: troops });
        });
        return villages;
    }

    function parseMobile($doc) {
        var villages = [];
        $doc.find(".overview-container > div").each(function() {
            var $el = $(this);
            var c = $el.text().match(/\((\d+)\|(\d+)\)/);
            if (!c) return;
            var coord = String(c[1]).padStart(3, "0") + String(c[2]).padStart(3, "0");
            var troops = {};
            $el.find(".overview-units-row > div.unit-row-item").each(function() {
                var src = $(this).find("img").attr("src") || "";
                var m = src.match(/unit_([a-z_]+)(?:@2x)?\.(png|webp)/i);
                if (!m) return;
                var n = parseInt(($(this).find("span.unit-row-name").text() || "").replace(/\D/g, ""), 10);
                troops[m[1]] = isNaN(n) ? 0 : n;
            });
            villages.push({ coord: coord, troops: troops });
        });
        return villages;
    }

    function uploadAll(villages) {

    // twmeta erwartet exakt diese Unit-Keys — alles andere wird verworfen.
    // (Aus dem HAR: spear, sword, axe, spy, light, heavy, ram, catapult, snob.)
    var ALLOWED = ["spear","sword","axe","spy","light","heavy","ram","catapult","snob"];
    villages = villages.map(function(v) {
        var t = {};
        ALLOWED.forEach(function(k) { t[k] = v.troops[k] || 0; });
        return { coord: v.coord, troops: t };
    });

    console.log("[twmeta] parsed " + villages.length + " villages:", villages);
    UI.SuccessMessage("Lade " + villages.length + " Dörfer hoch…");

    // === Upload (sequentiell mit Throttle) ===
    var idx = 0, ok = 0, fail = 0, errors = [];

    function postOne(v, cb) {
        fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": "Bearer " + API_KEY
            },
            body: JSON.stringify({
                linkedAccountId: LINKED_ACCOUNT_ID,
                coord: v.coord,
                troops: v.troops
            })
        })
        .then(function(r) {
            if (r.status >= 200 && r.status < 300) { ok++; cb(); }
            else {
                fail++;
                r.text().then(function(t){ errors.push(v.coord + ": " + r.status + " " + t.slice(0,120)); cb(); });
            }
        })
        .catch(function(e) {
            fail++;
            errors.push(v.coord + ": " + (e && e.message || e));
            cb();
        });
    }

    function next() {
        if (idx >= villages.length) {
            console.log("[twmeta] done — ok:", ok, "fail:", fail, "errors:", errors);
            var msg = "twmeta-Upload fertig: " + ok + " OK, " + fail + " Fehler.";
            if (fail) UI.ErrorMessage(msg + " (Details in der Console)");
            else UI.SuccessMessage(msg);
            return;
        }
        var v = villages[idx++];
        postOne(v, function(){ setTimeout(next, THROTTLE_MS); });
    }
    next();

    } // uploadAll

})();

/* === Userscript-Fallback bei CORS-Block ===
 * Falls der Browser den POST mit CORS abweist, in Tampermonkey/Violentmonkey
 * als Userscript installieren — GM_xmlhttpRequest umgeht die same-origin-Policy.
 *
 * // ==UserScript==
 * // @name         twmeta troop upload
 * // @match        https://*.die-staemme.de/game.php*overview_villages*mode=units*
 * // @grant        GM_xmlhttpRequest
 * // @connect      api.twmeta.net
 * // ==/UserScript==
 *
 * Im obigen Script jeden `fetch(...)`-Aufruf ersetzen durch:
 *
 *   GM_xmlhttpRequest({
 *       method: "POST",
 *       url: API_URL,
 *       headers: {
 *           "Content-Type": "application/json",
 *           "Accept": "application/json",
 *           "Authorization": "Bearer " + API_KEY
 *       },
 *       data: JSON.stringify({ linkedAccountId: LINKED_ACCOUNT_ID, coord: v.coord, troops: v.troops }),
 *       onload:  function(r){ if (r.status>=200 && r.status<300) ok++; else { fail++; errors.push(...); } cb(); },
 *       onerror: function(e){ fail++; errors.push(v.coord + ": " + e.error); cb(); }
 *   });
 */
