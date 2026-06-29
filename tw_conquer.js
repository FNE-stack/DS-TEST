/*
 * TW Conquer Checklist  (Schnellleiste / quickbar script)
 * ───────────────────────────────────────────────────────
 * Shows YOUR assigned conquer targets as a tap-friendly checklist (works on
 * mobile + desktop) AND highlights them on the browser map (red = conquer,
 * green = already yours). Targets you already own are auto-detected via
 * /map/village.txt and greyed/checked, so the list self-updates as you conquer.
 *
 * Paste your target coords in TARGETS below (one "x|y" per line is fine, or
 * comma-separated). Upload this file to your public DS-TEST repo and add a
 * quickbar button:
 *   javascript:$.getScript('https://fne-stack.github.io/DS-TEST/tw_conquer.js');
 *
 * The map highlight only works on screen=map with TWMap (desktop/mobile web).
 * The CHECKLIST works EVERYWHERE (including the app) — it's plain DOM.
 */
(function () {
  'use strict';

  // ── YOUR TARGETS — paste coords here (x|y). Edit freely. ────────────────
  var TARGETS = [
    "441|507","435|498","446|491","444|475","439|469","441|460","440|460",
    "440|459","435|457","437|456","445|457","445|456","445|455","446|456",
    "446|455","439|453","437|453","436|453","437|452","437|458","436|451",
    "438|453","439|459","436|457","443|452","422|434","420|434","423|435",
    "422|439","424|431","416|427","415|426","411|422","403|420","399|415",
    "397|414"
  ];

  // ── CONFIG ──────────────────────────────────────────────────────────────
  var W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  var WORLD_HOST = location.host;               // e.g. de257.die-staemme.de
  var COLOR_TODO = '#e23b3b';                   // red  = conquer this
  var COLOR_DONE = '#2ecc40';                   // green = already yours
  var DOT_R = 7;

  // Parse "x|y" -> {x,y}. Tolerates spaces / commas.
  function parseTargets(arr) {
    var out = [];
    arr.forEach(function (s) {
      var m = String(s).match(/(\d{1,3})\s*[|,]\s*(\d{1,3})/);
      if (m) out.push({ x: +m[1], y: +m[2], key: m[1] + '|' + m[2] });
    });
    return out;
  }
  var targets = parseTargets(TARGETS);

  // ── Who am I + which targets do I already own? (via village.txt/player.txt)
  var myName = null, myPlayerId = null;
  var ownedKeys = {};   // "x|y" -> true if owned by ME
  var ownerOf = {};     // "x|y" -> player_id (any owner)
  var vidOf = {};       // "x|y" -> village_id (for direct info_village links)

  // game_data has the logged-in player name.
  try { myName = (W.game_data && W.game_data.player && W.game_data.player.name) || null; } catch (e) {}

  function fetchText(url) {
    return fetch(url, { credentials: 'include' }).then(function (r) { return r.text(); });
  }

  // Resolve my player_id from player.txt by name, then scan village.txt for
  // which of my target coords are owned (and by whom / me).
  function loadOwnership() {
    var base = location.protocol + '//' + WORLD_HOST + '/map/';
    var want = {}; targets.forEach(function (t) { want[t.key] = true; });
    return fetchText(base + 'player.txt').then(function (ptxt) {
      ptxt.split('\n').forEach(function (line) {
        var p = line.split(',');
        if (p.length < 2) return;
        var name = decodeURIComponent(p[1].replace(/\+/g, '%20'));
        if (myName && name === myName) myPlayerId = p[0];
      });
      return fetchText(base + 'village.txt');
    }).then(function (vtxt) {
      vtxt.split('\n').forEach(function (line) {
        var p = line.split(',');
        if (p.length < 5) return;
        var key = (+p[2]) + '|' + (+p[3]);
        if (!want[key]) return;
        vidOf[key] = p[0];                 // village id — for direct info links
        ownerOf[key] = p[4] || '0';
        if (myPlayerId && p[4] === myPlayerId) ownedKeys[key] = true;
      });
    }).catch(function (e) { console.warn('[conquer] ownership load failed', e); });
  }

  // ── Distance from my current village (for sorting) ──────────────────────
  function myCoord() {
    try {
      var v = W.game_data && W.game_data.village;
      if (v && v.x != null) return { x: +v.x, y: +v.y };
    } catch (e) {}
    return null;
  }
  function dist(a, t) { return a ? Math.hypot(a.x - t.x, a.y - t.y) : 0; }

  // ── CHECKLIST PANEL (works everywhere, incl. mobile app) ────────────────
  function buildPanel() {
    var old = document.getElementById('twc_panel'); if (old) old.remove();
    var me = myCoord();
    var sorted = targets.slice().sort(function (a, b) {
      var da = ownedKeys[a.key] ? 1 : 0, db = ownedKeys[b.key] ? 1 : 0;
      if (da !== db) return da - db;                 // done ones sink to bottom
      return dist(me, a) - dist(me, b);              // nearest first
    });
    var left = targets.filter(function (t) { return !ownedKeys[t.key]; }).length;

    var p = document.createElement('div');
    p.id = 'twc_panel';
    p.style.cssText = [
      'position:fixed', 'z-index:2147483647',
      'top:calc(8px + env(safe-area-inset-top,0px))', 'right:8px',
      'max-height:70vh', 'overflow:auto', 'width:200px',
      'background:#f4e4bc', 'border:2px solid #804000', 'border-radius:6px',
      'font:12px/1.35 Verdana,Arial,sans-serif', 'color:#000',
      'box-shadow:0 3px 10px rgba(0,0,0,.4)', 'padding:6px'
    ].join(';');

    var head = document.createElement('div');
    head.style.cssText = 'font-weight:bold;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center';
    head.innerHTML = '<span>🎯 Conquer (' + left + '/' + targets.length + ')</span>';
    var x = document.createElement('span');
    x.textContent = '✕'; x.style.cssText = 'cursor:pointer;padding:0 4px';
    x.onclick = function () { p.remove(); };
    head.appendChild(x);
    p.appendChild(head);

    sorted.forEach(function (t) {
      var done = !!ownedKeys[t.key];
      var foreign = ownerOf[t.key] && !done && ownerOf[t.key] !== '0';
      var row = document.createElement('a');
      row.href = '/game.php?screen=info_village&id=' + (t.id || '') +
                 '&x=' + t.x + '&y=' + t.y;
      // open the map centered on the village (works app + web)
      row.href = '/game.php?screen=map&x=' + t.x + '&y=' + t.y;
      row.style.cssText = [
        'display:flex', 'justify-content:space-between', 'gap:6px',
        'padding:3px 4px', 'margin:1px 0', 'border-radius:4px',
        'text-decoration:none',
        'background:' + (done ? '#d7e9c8' : '#fff7e0'),
        'color:' + (done ? '#5a7a3a' : '#000'),
        'opacity:' + (done ? '0.65' : '1')
      ].join(';');
      var d = myCoord() ? Math.round(dist(myCoord(), t)) : 0;
      row.innerHTML =
        '<span>' + (done ? '✅' : (foreign ? '⚠️' : '⬜')) + ' ' + t.key + '</span>' +
        '<span style="opacity:.6">' + d + 'f</span>';
      p.appendChild(row);
    });

    var hint = document.createElement('div');
    hint.style.cssText = 'margin-top:4px;font-size:10px;opacity:.6';
    hint.textContent = '✅ owned · ⚠️ someone else has it · tap = open map';
    p.appendChild(hint);

    document.body.appendChild(p);
  }

  // ── MAP HIGHLIGHT (browser only — needs TWMap) ──────────────────────────
  function mapReady() {
    var m = W.TWMap;
    return !!(m && m.map && m.map.el && typeof m.map.pixelByCoord === 'function');
  }
  var canvas = null;
  function ensureCanvas() {
    var m = W.TWMap.map;
    var root = m.el.root || m.el.container || m.el;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'twc_canvas';
      canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:5';
      (m.el.container || root).appendChild(canvas);
    }
    canvas.width = root.clientWidth; canvas.height = root.clientHeight;
    return canvas;
  }
  function coordToScreen(x, y) {
    var m = W.TWMap.map;
    var px = m.pixelByCoord(x + 0.5, y + 0.5);   // +0.5 = village center
    return [px[0] - m.pos[0], px[1] - m.pos[1]];
  }
  function drawMap() {
    if (!mapReady()) return;
    var c = ensureCanvas(), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    targets.forEach(function (t) {
      var s = coordToScreen(t.x, t.y);
      if (s[0] < -20 || s[1] < -20 || s[0] > c.width + 20 || s[1] > c.height + 20) return;
      var done = !!ownedKeys[t.key];
      ctx.beginPath();
      ctx.arc(s[0], s[1], DOT_R, 0, 2 * Math.PI);
      ctx.fillStyle = done ? COLOR_DONE : COLOR_TODO;
      ctx.globalAlpha = done ? 0.5 : 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    });
  }
  function hookRedraw() {
    if (!mapReady() || W.TWMap.reload._twc) return;
    var orig = W.TWMap.reload;
    W.TWMap.reload = function () { var r = orig.apply(this, arguments); try { drawMap(); } catch (e) {} return r; };
    W.TWMap.reload._twc = true;
  }

  // ── INIT ────────────────────────────────────────────────────────────────
  loadOwnership().then(function () {
    buildPanel();
    if (mapReady()) { hookRedraw(); drawMap(); }
  });
  // map may load after us — retry the hook a few times
  var tries = 0;
  var iv = setInterval(function () {
    if (mapReady()) { hookRedraw(); drawMap(); }
    if (++tries > 20) clearInterval(iv);
  }, 1000);

  console.log('[conquer] loaded ' + targets.length + ' targets');
})();
