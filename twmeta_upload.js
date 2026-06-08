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
    var LINKED_ACCOUNT_ID  = 46;          // aus dem HAR — ggf. anpassen
    var API_URL            = "https://api.twmeta.net/tribalwars/attack-planner/village-troops";
    var THROTTLE_MS        = 80;          // Pause zwischen POSTs, damit die API nicht spamt

    // === Sanity: richtige Screen-Seite? ===
    var qs = new URLSearchParams(location.search);
    if (qs.get("screen") !== "overview_villages" || qs.get("mode") !== "units") {
        UI.ErrorMessage("Bitte zuerst auf 'Übersichten → Truppen (Komplett)' öffnen.");
        return;
    }

    // === Parsing (Desktop und Mobile) ===
    var isMobile = $("#mobileHeader").length > 0;

    function parseDesktop() {
        var $rows = $("#combined_table tr.nowrap");
        var $head = $("#combined_table tr:eq(0) th");
        if (!$rows.length || !$head.length) return [];

        // Spalten-Index → Unit-Slug aus den th-Bildern
        var colUnit = {};
        $head.each(function(idx) {
            var src = $(this).find("img").attr("src") || "";
            var m = src.match(/unit_([a-z_]+)\.(png|webp)/i);
            if (m) colUnit[idx] = m[1];
        });

        var villages = [];
        $rows.each(function() {
            var $tds = $(this).find("td");
            // Koord aus dem Namens-/Link-Feld extrahieren — "(444|516)" Form
            var txt = $(this).text();
            var c = txt.match(/\((\d+)\|(\d+)\)/);
            if (!c) return;
            var coord = String(c[1]).padStart(3, "0") + String(c[2]).padStart(3, "0");

            var troops = {};
            Object.keys(colUnit).forEach(function(idx) {
                var cell = $tds.eq(parseInt(idx, 10));
                var n = parseInt((cell.text() || "").replace(/\D/g, ""), 10);
                troops[colUnit[idx]] = isNaN(n) ? 0 : n;
            });
            villages.push({ coord: coord, troops: troops });
        });
        return villages;
    }

    function parseMobile() {
        var villages = [];
        $(".overview-container > div").each(function() {
            var $el = $(this);
            var txt = $el.text();
            var c = txt.match(/\((\d+)\|(\d+)\)/);
            if (!c) return;
            var coord = String(c[1]).padStart(3, "0") + String(c[2]).padStart(3, "0");

            var troops = {};
            $el.find(".overview-units-row > div.unit-row-item").each(function() {
                var src = $(this).find("img").attr("src") || "";
                var m = src.match(/unit_([a-z_]+)(?:@2x)?\.(png|webp)/i);
                if (!m) return;
                var unit = m[1];
                var n = parseInt(($(this).find("span.unit-row-name").text() || "").replace(/\D/g, ""), 10);
                troops[unit] = isNaN(n) ? 0 : n;
            });
            villages.push({ coord: coord, troops: troops });
        });
        return villages;
    }

    var villages = isMobile ? parseMobile() : parseDesktop();
    if (!villages.length) {
        UI.ErrorMessage("Keine Dörfer aus der Tabelle geparst. Richtige Seite (mode=units)?");
        return;
    }

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
