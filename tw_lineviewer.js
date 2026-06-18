/*
 * TW Schnellleisten Line Viewer  (self-contained, app-friendly)
 * ─────────────────────────────────────────────────────────────
 * A Schnellleiste (quickbar) script that draws planned lines + labels
 * onto the live TW map (screen=map). Works wherever screen=map runs with
 * TWMap — desktop browser, mobile web, and the Launchpad webview (in-app).
 *
 * Unlike the old TWLineDrawer it does NOT depend on Browndy's external
 * bundle. It hooks TWMap directly (TWMap.map.pixelByCoord / coordByPixel),
 * overlays its own canvas, and re-draws on pan/zoom.
 *
 * Plans live in the PRIVATE DS-PLAN repo and are fetched via the GitHub API
 * with a token (same pattern as launchpad.js). DS-PLAN/index.json lists plans:
 *   index.json = [{ "name": "Front Nord", "world": "de256", "file": "plans/front_nord.txt" }, ...]
 * Each plan file is the classic "Korriskript" paste format:
 *   [[[457,520],[457,450]]]          ← a line (array of [x,y] points)
 *   [[452,500],"Stfn"]               ← a label  ([x,y], text)
 * (Comment lines / headers like "Korriskript für TW Line Drawer" are ignored.)
 *
 * USAGE: upload THIS file to the public DS-TEST repo, then add a Schnellleiste
 * button (same $.getScript + token style as launchpad.js) — see
 * tw_lineviewer_quickbar.txt:
 *   javascript: window.TWLV_TOKEN='ghp_xxx';$.getScript('https://fne-stack.github.io/DS-TEST/tw_lineviewer.js');
 */
(function () {
  'use strict';

  // ── CONFIG ────────────────────────────────────────────────────────────
  // Plans live in the PRIVATE DS-PLAN repo and are fetched via the GitHub API
  // with a token (same pattern as launchpad.js). Pass the token + repo from the
  // quickbar loader; sensible defaults below.
  var GH_OWNER  = window.TWLV_OWNER  || 'FNE-stack';
  var GH_REPO   = window.TWLV_REPO   || 'DS-PLAN';   // private — holds the plans
  var GH_BRANCH = window.TWLV_BRANCH || 'main';
  // GitHub PAT (repo: read). Accepts TWLV_TOKEN, or falls back to the same
  // LAUNCHPAD_TOKEN your launchpad quickbar already sets — so one token works
  // for both scripts.
  var GH_TOKEN  = window.TWLV_TOKEN || window.LAUNCHPAD_TOKEN || '';
  // Index file inside DS-PLAN listing the available plans.
  var INDEX_FILE = window.TWLV_INDEX_FILE || 'index.json';
  // Auto-load the first plan matching the current world on map open.
  var AUTO_LOAD = (window.TWLV_AUTO_LOAD !== false);
  var LINE_WIDTH = 2;
  var DEFAULT_COLOR = '#ff0000'; // red default for lines

  // GitHub API content endpoint for a file in the private DS-PLAN repo.
  function ghContentsUrl(path) {
    return 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO +
           '/contents/' + path.split('/').map(encodeURIComponent).join('/') +
           '?ref=' + GH_BRANCH + '&_=' + Date.now();
  }
  function ghHeaders() {
    return {
      'Authorization': 'Bearer ' + GH_TOKEN,
      'Accept': 'application/vnd.github.raw',  // ask for raw file body directly
    };
  }

  var W = window;
  var TWMap = null; // set in boot() once the map screen is ready

  function boot() {
  TWMap = W.TWMap;
  if (!TWMap || !TWMap.map) {
    // Not on the map screen (or map not ready yet) — retry a few times.
    W._twlvRetries = (W._twlvRetries || 0) + 1;
    if (W._twlvRetries < 20) { setTimeout(boot, 400); return; }
    alert('TW Line Viewer: Karte (TWMap) nicht gefunden. Öffne den Kartenbildschirm.');
    return;
  }

  // Singleton guard — re-running the quickbar just re-opens the panel.
  if (W._twlv) { W._twlv.togglePanel(); return; }

  // ── PARSER: classic Korriskript paste → {lines:[], labels:[]} ──────────
  function parsePlan(text) {
    var lines = [], labels = [];
    var rows = String(text).split(/\r?\n/);
    for (var i = 0; i < rows.length; i++) {
      var s = rows[i].trim();
      if (!s || s[0] !== '[') continue; // skip headers / blank / comments
      var parsed;
      try { parsed = JSON.parse(s); } catch (e) { continue; }

      // Label: [[x,y], "text"]  → first elem is a 2-number array, 2nd a string.
      if (Array.isArray(parsed) && parsed.length === 2 &&
          Array.isArray(parsed[0]) && typeof parsed[0][0] === 'number' &&
          typeof parsed[1] === 'string') {
        labels.push({ x: +parsed[0][0], y: +parsed[0][1], text: parsed[1] });
        continue;
      }

      // Line: unwrap nested arrays down to a list of [x,y] points.
      var pts = parsed;
      while (Array.isArray(pts) && pts.length === 1 && Array.isArray(pts[0]) &&
             Array.isArray(pts[0][0])) {
        pts = pts[0];
      }
      if (Array.isArray(pts) && pts.length >= 2 && Array.isArray(pts[0]) &&
          typeof pts[0][0] === 'number') {
        var clean = pts
          .map(function (p) { return [+p[0], +p[1]]; })
          .filter(function (p) { return !isNaN(p[0]) && !isNaN(p[1]); });
        if (clean.length >= 2) lines.push({ points: clean, color: DEFAULT_COLOR });
      }
    }
    return { lines: lines, labels: labels };
  }

  // ── CANVAS OVERLAY ─────────────────────────────────────────────────────
  // We overlay ONE absolutely-positioned canvas over the map container and
  // redraw on every pan/zoom using TWMap's own coordinate→pixel transform.
  // The VIEWPORT element (the fixed-size window the map pans INSIDE). Our
  // overlay canvas sits on this — NOT on the inner panning container, so it
  // stays still while coordToScreen accounts for the pan via the container's
  // CSS offset. TWMap.map.el.root is the viewport; .el.container is the panner.
  function getMapEl() {
    var m = TWMap.map;
    if (m && m.el && m.el.root) return m.el.root;
    return document.getElementById('map') ||
           document.getElementById('map_main') ||
           document.querySelector('#map_wrap');
  }

  var Viewer = {
    plan: { lines: [], labels: [] },
    canvas: null, ctx: null, container: null, panelEl: null, visible: true,

    ensureCanvas: function () {
      var mapEl = getMapEl();
      if (!mapEl) return false;
      this.container = mapEl;
      // The map container must be a positioning context.
      var pos = getComputedStyle(mapEl).position;
      if (pos === 'static') mapEl.style.position = 'relative';
      if (!this.canvas) {
        var c = document.createElement('canvas');
        c.id = 'twlv_overlay';
        c.style.cssText =
          'position:absolute;left:0;top:0;pointer-events:none;z-index:5000;';
        mapEl.appendChild(c);
        this.canvas = c; this.ctx = c.getContext('2d');
      }
      // Match the canvas to the map size (DPR-aware for crisp lines on phones).
      var w = mapEl.clientWidth, h = mapEl.clientHeight;
      var dpr = window.devicePixelRatio || 1;
      if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
        this.canvas.width = w * dpr; this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      return true;
    },

    // World coord (x,y) → on-screen pixel inside the map viewport.
    //
    // TWMap renders all sectors into ONE inner container (TWMap.map.el.container)
    // and PANS by setting that container's CSS left/top to a negative offset:
    //   container.style.left = -panX + "px"
    // pixelByCoord(x,y) returns the ABSOLUTE map-plane pixel (= x*scale, y*scale).
    // So the on-screen position is: absolutePixel + containerOffset.
    // (containerOffset is negative when panned, exactly cancelling the abs pixel
    //  for whatever coord is currently top-left of the viewport.)
    coordToScreen: function (x, y) {
      try {
        var m = TWMap.map;
        var p = m.pixelByCoord(x + 0.5, y + 0.5); // center of the tile
        var cont = (m.el && m.el.container) ? m.el.container : null;
        var offL = 0, offT = 0;
        if (cont) {
          // Prefer the live inline style (what the pan writes); fall back to
          // offsetLeft/Top relative to the overlay's positioning parent.
          offL = parseFloat(cont.style.left) || cont.offsetLeft || 0;
          offT = parseFloat(cont.style.top) || cont.offsetTop || 0;
        }
        return { sx: p[0] + offL, sy: p[1] + offT };
      } catch (e) { return null; }
    },

    draw: function () {
      if (!this.ensureCanvas()) return;
      var ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.visible) return;

      // Lines
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineJoin = 'round';
      this.plan.lines.forEach(function (ln) {
        ctx.beginPath();
        var first = true;
        for (var i = 0; i < ln.points.length; i++) {
          var s = Viewer.coordToScreen(ln.points[i][0], ln.points[i][1]);
          if (!s) continue;
          if (first) { ctx.moveTo(s.sx, s.sy); first = false; }
          else ctx.lineTo(s.sx, s.sy);
        }
        ctx.strokeStyle = ln.color || DEFAULT_COLOR;
        ctx.stroke();
      });

      // Labels
      ctx.font = '700 12px Verdana, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.plan.labels.forEach(function (lb) {
        var s = Viewer.coordToScreen(lb.x, lb.y);
        if (!s) return;
        // dark outline for readability over the map
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(lb.text, s.sx, s.sy);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(lb.text, s.sx, s.sy);
      });
      ctx.lineWidth = LINE_WIDTH;
    },

    setPlan: function (plan) { this.plan = plan; this.draw(); },

    // ── Hook TWMap pan/zoom so the overlay follows the map ───────────────
    hookMap: function () {
      var self = this;
      // Redraw after any map reload/redraw. TWMap reloads sectors on pan/zoom;
      // we also bind a rAF loop fallback so it stays glued during drags.
      var origReload = TWMap.reload;
      if (origReload && !origReload._twlv) {
        TWMap.reload = function () {
          var r = origReload.apply(this, arguments);
          setTimeout(function () { self.draw(); }, 30);
          return r;
        };
        TWMap.reload._twlv = true;
      }
      // Continuous re-glue (cheap clear+redraw) — keeps lines aligned while
      // panning even between reloads. Stops nothing else; ~30fps.
      function loop() { if (self.visible) self.draw(); requestAnimationFrame(loop); }
      requestAnimationFrame(loop);
      window.addEventListener('resize', function () { self.draw(); });
    },

    // ── UI PANEL (plan dropdown + toggle) ────────────────────────────────
    buildPanel: function (plans) {
      var self = this;
      if (this.panelEl) { this.panelEl.remove(); this.panelEl = null; }
      var p = document.createElement('div');
      p.id = 'twlv_panel';
      p.style.cssText =
        'position:fixed;left:8px;bottom:8px;z-index:6000;background:#f4e4bc;' +
        'border:1px solid #804000;border-radius:6px;padding:6px 8px;font:12px Verdana;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.4);max-width:240px;';
      var world = (W.game_data && W.game_data.world) || '';
      var opts = plans.map(function (pl, i) {
        var lbl = pl.name + (pl.world ? ' (' + pl.world + ')' : '');
        return '<option value="' + i + '">' + lbl + '</option>';
      }).join('');
      p.innerHTML =
        '<div style="font-weight:700;margin-bottom:4px;">📐 Line Viewer</div>' +
        '<select id="twlv_sel" style="width:100%;margin-bottom:5px;">' + opts + '</select>' +
        '<div style="display:flex;gap:4px;">' +
        '  <button id="twlv_show" style="flex:1;">Zeigen</button>' +
        '  <button id="twlv_toggle" style="flex:1;">Aus/Ein</button>' +
        '  <button id="twlv_close">✕</button>' +
        '</div>' +
        '<div id="twlv_status" style="margin-top:4px;color:#603000;font-size:10px;"></div>';
      document.body.appendChild(p);
      this.panelEl = p;

      function loadByIndex(i) {
        var pl = plans[i]; if (!pl) return;
        document.getElementById('twlv_status').textContent = 'lade ' + pl.name + '…';
        fetchText(pl.file, pl).then(function (txt) {
          var plan = parsePlan(txt);
          self.setPlan(plan);
          document.getElementById('twlv_status').textContent =
            plan.lines.length + ' Linien, ' + plan.labels.length + ' Labels';
        }).catch(function (e) {
          document.getElementById('twlv_status').textContent = 'Fehler: ' + e;
        });
      }

      p.querySelector('#twlv_show').onclick = function () {
        loadByIndex(+document.getElementById('twlv_sel').value);
      };
      p.querySelector('#twlv_toggle').onclick = function () {
        self.visible = !self.visible; self.draw();
      };
      p.querySelector('#twlv_close').onclick = function () { p.style.display = 'none'; };

      // Auto-load: first plan matching this world (or the first plan).
      if (AUTO_LOAD && plans.length) {
        var idx = 0;
        for (var i = 0; i < plans.length; i++) {
          if (plans[i].world && world && plans[i].world.toLowerCase() === world.toLowerCase()) {
            idx = i; break;
          }
        }
        document.getElementById('twlv_sel').value = idx;
        loadByIndex(idx);
      }
    },

    togglePanel: function () {
      if (this.panelEl) {
        this.panelEl.style.display =
          this.panelEl.style.display === 'none' ? 'block' : 'none';
      }
    },
  };

  // ── FETCH a plan file from the PRIVATE DS-PLAN repo via the GitHub API ──
  // `file` is a repo-relative path from index.json (e.g. "plans/front_nord.txt").
  // Uses Accept: application/vnd.github.raw so the body is the file text directly.
  function fetchText(file, planMeta) {
    return fetch(ghContentsUrl(file), { headers: ghHeaders(), cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('GitHub ' + r.status + ' (' + file + ')');
        return r.text();
      });
  }

  // ── BOOT (runs once TWMap is ready) ─────────────────────────────────────
  W._twlv = Viewer;
  Viewer.hookMap();

  if (!GH_TOKEN) {
    alert('TW Line Viewer: kein GitHub-Token gesetzt.\n' +
          'Setze window.TWLV_TOKEN im Schnellleisten-Loader (Lesezugriff auf ' +
          GH_OWNER + '/' + GH_REPO + ').');
    return;
  }

  // Load the plan index (index.json) from the private DS-PLAN repo via API.
  fetchText(INDEX_FILE)
    .then(function (txt) { return JSON.parse(txt); })
    .then(function (plans) {
      if (!Array.isArray(plans) || !plans.length) throw new Error('index leer');
      Viewer.buildPanel(plans);
    })
    .catch(function (e) {
      alert('TW Line Viewer: ' + INDEX_FILE + ' konnte nicht geladen werden (' + e +
            ').\nPrüfe Token / Repo (' + GH_OWNER + '/' + GH_REPO + ').');
    });

  } // end boot()

  boot();
})();
