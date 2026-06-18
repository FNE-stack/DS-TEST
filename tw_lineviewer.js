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
  // Debug: draw a magenta frame + box on the embed canvas to prove it's
  // visible/on-top (separates canvas-placement issues from coord-math issues).
  // Set window.TWLV_DEBUG_MARKER=false in the loader to turn it off later.
  var TWLV_DEBUG_MARKER = (window.TWLV_DEBUG_MARKER !== false);

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
  var TWMap = null; // refreshed each time we touch the map

  // Re-running the quickbar just re-opens the panel (script already alive).
  if (W._twlv) { W._twlv.togglePanel(); return; }

  // Is the map (TWMap) present RIGHT NOW?
  function mapReady() {
    TWMap = W.TWMap;
    return !!(TWMap && TWMap.map && TWMap.map.el);
  }

  function boot() {

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
    var m = TWMap && TWMap.map;        // TWMap may be undefined (app has no TWMap)
    if (m && m.el && m.el.root) return m.el.root;
    return document.getElementById('map') ||
           document.getElementById('map_main') ||
           document.querySelector('#map_wrap');
  }

  var Viewer = {
    plan: { lines: [], labels: [] },
    canvas: null, ctx: null, container: null, panelEl: null, visible: true,

    lastError: '',
    ensureCanvas: function () {
      var mapEl = getMapEl();
      // getMapEl may return a jQuery object on some TW builds — unwrap it.
      if (mapEl && mapEl.jquery) mapEl = mapEl[0];
      if (!mapEl || !mapEl.appendChild) { this.lastError = 'kein Karten-Element'; return false; }
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
      } else if (this.canvas.parentNode !== mapEl) {
        // Map DOM was replaced (nav) — re-attach our canvas.
        mapEl.appendChild(this.canvas);
      }
      // Match the canvas to the map size (DPR-aware for crisp lines on phones).
      var w = mapEl.clientWidth || mapEl.offsetWidth || 0;
      var h = mapEl.clientHeight || mapEl.offsetHeight || 0;
      if (w === 0 || h === 0) { this.lastError = 'Karte 0×0 (noch nicht geladen)'; return false; }
      var dpr = window.devicePixelRatio || 1;
      if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
        this.canvas.width = w * dpr; this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this.lastError = '';
      return true;
    },

    // World coord (x,y) → on-screen pixel inside the map viewport.
    //
    // Derived from TWMap's OWN definition:
    //   getCenter() = coordByPixel(pos[0] + size[0]/2, pos[1] + size[1]/2)
    // → `this.pos` is the map-plane pixel at the viewport's TOP-LEFT corner.
    //   pixelByCoord(x,y) = [x*scale[0], y*scale[1]]  (absolute map-plane pixel)
    // So on-screen = absolutePixel − pos. (Earlier I used the container's CSS
    // offset, which has TWMap's `bias` baked in → off-screen. `pos` is bias-free
    // and is exactly what TWMap uses to map pixels↔coords.)
    // `center` = add +0.5 to land on the tile CENTER (for labels, which sit on
    // a village). Lines use raw coords (tile corner/grid line) so a corridor
    // runs BETWEEN village columns, not through them — matches the original
    // TWLineDrawer (no +0.5 for lines).
    coordToScreen: function (x, y, center) {
      try {
        var m = TWMap && TWMap.map;
        if (!m || !m.pos) return null;
        var off = center ? 0.5 : 0;
        var p = m.pixelByCoord(x + off, y + off);
        return { sx: p[0] - m.pos[0], sy: p[1] - m.pos[1] };
      } catch (e) { return null; }
    },

    lastDrawn: 0,
    draw: function () {
      if (!this.ensureCanvas()) { return; }
      var ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.visible) { this.lastDrawn = 0; return; }
      var plotted = 0;

      // Lines
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineJoin = 'round';
      this.plan.lines.forEach(function (ln) {
        ctx.beginPath();
        var first = true;
        for (var i = 0; i < ln.points.length; i++) {
          var s = Viewer.coordToScreen(ln.points[i][0], ln.points[i][1], false);
          if (!s) continue;
          if (first) { ctx.moveTo(s.sx, s.sy); first = false; }
          else ctx.lineTo(s.sx, s.sy);
          plotted++;
        }
        ctx.strokeStyle = ln.color || DEFAULT_COLOR;
        ctx.stroke();
      });

      // Labels
      ctx.font = '700 12px Verdana, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.plan.labels.forEach(function (lb) {
        var s = Viewer.coordToScreen(lb.x, lb.y, true); // center on the village
        if (!s) return;
        // dark outline for readability over the map
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(lb.text, s.sx, s.sy);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(lb.text, s.sx, s.sy);
        plotted++;
      });
      ctx.lineWidth = LINE_WIDTH;
      this.lastDrawn = plotted;
    },

    setPlan: function (plan) { this.plan = plan; this.draw(); },

    // ── Persistent hook: survives navigation; draws whenever the map exists ─
    // Launched from ANY screen (e.g. Übersicht where the quickbar lives). We
    // don't require the map at launch — a rAF loop checks each frame whether the
    // map is present and (re-)hooks + draws when it appears. This is what lets
    // you tap the button off-map, then open the Karte and see the lines (same
    // survival trick as launchpad.js).
    hookMap: function () {
      var self = this;
      function ensureReloadHook() {
        if (!mapReady()) return;
        var origReload = TWMap.reload;
        if (origReload && !origReload._twlv) {
          TWMap.reload = function () {
            var r = origReload.apply(this, arguments);
            setTimeout(function () { self.draw(); }, 30);
            return r;
          };
          TWMap.reload._twlv = true;
        }
      }
      // SELF-HEAL: the app swaps the DOM on navigation (AJAX, no reload) — our
      // panel/canvas get detached. The loop re-creates them whenever they've
      // fallen out of the live document, so the panel survives screen switches.
      function heal() {
        // Panel gone from the document? Rebuild it from the remembered plans.
        if (self.panelEl && !document.body.contains(self.panelEl)) {
          self.panelEl = null;
        }
        if (!self.panelEl && self._plans) {
          self.buildPanel(self._plans);
        }
        // Canvas detached? ensureCanvas() re-appends it (called by draw()).
      }
      function loop() {
        heal();
        if (mapReady()) {       // map present on this screen
          ensureReloadHook();
          if (self.visible) self.draw();
        }
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
      window.addEventListener('resize', function () { if (mapReady()) self.draw(); });
    },

    // ── UI PANEL (plan dropdown + toggle) ────────────────────────────────
    _plans: null,
    buildPanel: function (plans) {
      var self = this;
      this._plans = plans;  // remembered so the self-heal loop can rebuild
      if (this.panelEl) { this.panelEl.remove(); this.panelEl = null; }
      var p = document.createElement('div');
      p.id = 'twlv_panel';
      // Anchored TOP-left (not bottom): the app's nav/safe-area cuts off
      // bottom-pinned panels so the buttons fall off-screen. Top is always
      // visible. Uses safe-area inset so it clears any notch/status bar.
      p.style.cssText =
        'position:fixed;left:8px;top:calc(8px + env(safe-area-inset-top,0px));' +
        'z-index:2147483000;background:#f4e4bc;' +
        'border:1px solid #804000;border-radius:6px;padding:6px 8px;font:12px Verdana;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.4);max-width:240px;' +
        'max-height:calc(100vh - 24px);overflow:auto;';
      var world = (W.game_data && W.game_data.world) || '';
      var opts = plans.map(function (pl, i) {
        var lbl = pl.name + (pl.world ? ' (' + pl.world + ')' : '');
        return '<option value="' + i + '">' + lbl + '</option>';
      }).join('');
      p.innerHTML =
        '<div style="font-weight:700;margin-bottom:4px;">📐 Line Viewer</div>' +
        '<select id="twlv_sel" style="width:100%;margin-bottom:5px;">' + opts + '</select>' +
        '<div style="display:flex;gap:4px;margin-bottom:4px;">' +
        '  <button id="twlv_show" style="flex:1;">Zeigen</button>' +
        '  <button id="twlv_toggle" style="flex:1;">Aus/Ein</button>' +
        '  <button id="twlv_close">✕</button>' +
        '</div>' +
        // "Karte" opens the embedded full-screen map (the app-friendly mode).
        '<button id="twlv_embedbtn" style="width:100%;">🗺️ Karte öffnen</button>' +
        '<div id="twlv_status" style="margin-top:4px;color:#603000;font-size:10px;"></div>';
      document.body.appendChild(p);
      this.panelEl = p;

      function loadByIndex(i) {
        var pl = plans[i]; if (!pl) return;
        var st = document.getElementById('twlv_status');
        st.textContent = 'lade ' + pl.name + '…';
        // Remember the selection so a navigation/reload re-loads the same plan
        // automatically (panel + lines survive switching to the Karte).
        try { sessionStorage.setItem('twlv_sel_idx', String(i)); } catch (e) {}
        fetchText(pl.file, pl).then(function (txt) {
          var plan = parsePlan(txt);
          self.setPlan(plan);
          // Cache the parsed plan too, so even before the next fetch finishes we
          // can redraw instantly after a screen change.
          try { sessionStorage.setItem('twlv_plan', JSON.stringify(plan)); } catch (e) {}
          // Report what was parsed AND what actually drew — turns a silent
          // "nothing happened" into a precise reason (no map element, 0×0
          // canvas, transform off-screen, etc.).
          var msg = plan.lines.length + ' Linien, ' + plan.labels.length + ' Labels';
          if (self.lastError) msg += ' · ⚠ ' + self.lastError;
          else msg += ' · ' + self.lastDrawn + ' Punkte gezeichnet';
          st.textContent = msg;
        }).catch(function (e) {
          st.textContent = 'Fehler: ' + e;
        });
      }

      p.querySelector('#twlv_show').onclick = function () {
        loadByIndex(+document.getElementById('twlv_sel').value);
      };
      p.querySelector('#twlv_toggle').onclick = function () {
        self.visible = !self.visible; self.draw();
      };
      p.querySelector('#twlv_close').onclick = function () { p.style.display = 'none'; };
      p.querySelector('#twlv_embedbtn').onclick = function () { self.openEmbed(); };

      // Draw any cached plan from a previous screen IMMEDIATELY (survives nav),
      // then pick which index to (re)load.
      try {
        var cached = sessionStorage.getItem('twlv_plan');
        if (cached) self.setPlan(JSON.parse(cached));
      } catch (e) {}

      if (AUTO_LOAD && plans.length) {
        // Prefer the plan the user last selected this session; else the first
        // plan matching the current world; else plan 0.
        var idx = -1;
        try {
          var saved = parseInt(sessionStorage.getItem('twlv_sel_idx'), 10);
          if (!isNaN(saved) && saved >= 0 && saved < plans.length) idx = saved;
        } catch (e) {}
        if (idx < 0) {
          idx = 0;
          for (var i = 0; i < plans.length; i++) {
            if (plans[i].world && world && plans[i].world.toLowerCase() === world.toLowerCase()) {
              idx = i; break;
            }
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

    // ── EMBEDDED MAP MODE (the "blanket" — for the app) ──────────────────
    // The app tears down injected scripts when you open its NATIVE Karte. So
    // instead we load the REAL screen=map into an <iframe> INSIDE our own
    // full-screen overlay, on a screen where the script survives. screen=map
    // sends X-Frame-Options: NONE (no framing block), and the iframe is
    // same-origin → we get full access to its TWMap and draw inside it. This
    // is the FarmGod trick: work within a surviving context, not the native one.
    openEmbed: function () {
      var self = this;
      if (this.embedEl) { this.embedEl.style.display = 'block'; return; }

      var ov = document.createElement('div');
      ov.id = 'twlv_embed';
      ov.style.cssText =
        'position:fixed;inset:0;z-index:99999;background:#000;' +
        'display:flex;flex-direction:column;';
      // Top bar: plan dropdown + toggle + close.
      var bar = document.createElement('div');
      bar.style.cssText =
        'flex:0 0 auto;display:flex;gap:6px;align-items:center;' +
        'padding:calc(6px + env(safe-area-inset-top,0px)) 8px 6px 8px;' +
        'background:#f4e4bc;border-bottom:1px solid #804000;font:12px Verdana;';
      var opts = (this._plans || []).map(function (pl, i) {
        return '<option value="' + i + '">' + pl.name +
               (pl.world ? ' (' + pl.world + ')' : '') + '</option>';
      }).join('');
      bar.innerHTML =
        '<b style="white-space:nowrap;">📐</b>' +
        '<select id="twlv_esel" style="flex:1;min-width:0;">' + opts + '</select>' +
        '<button id="twlv_etoggle">Linien aus</button>' +
        '<button id="twlv_eclose">✕</button>';
      ov.appendChild(bar);

      // The embedded real map — wrapped so we can lay OUR canvas on top of it
      // in the OUTER document (avoids iframe-internal clipping/stacking that
      // hid the canvas in the app).
      var stage = document.createElement('div');
      stage.style.cssText = 'flex:1 1 auto;position:relative;overflow:hidden;';
      var frame = document.createElement('iframe');
      frame.id = 'twlv_eframe';
      frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;';
      var vid = (W.game_data && W.game_data.village && W.game_data.village.id) || '';
      frame.src = '/game.php' + (vid ? '?village=' + vid + '&' : '?') + 'screen=map';
      stage.appendChild(frame);
      ov.appendChild(stage);
      // Outer overlay canvas — appended to the OVERLAY ROOT (not the stage) with
      // an extreme z-index, so even if the app's native map renders at a high
      // layer inside/over the iframe, our canvas is above it. pointer-events off
      // so map gestures pass through.
      var ocanvas = document.createElement('canvas');
      ocanvas.id = 'twlv_ocanvas';
      ocanvas.style.cssText =
        'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;' +
        'z-index:2147483646;';
      ov.appendChild(ocanvas);
      this.embedStage = stage;
      this.outerCanvas = ocanvas;

      // DOM PROBE: a plain coloured DIV over the map. If even THIS doesn't show
      // in the app, the app's native map composites above ALL webview DOM and no
      // overlay (canvas or div) can ever appear over it — the hard wall.
      if (TWLV_DEBUG_MARKER) {
        var probe = document.createElement('div');
        probe.id = 'twlv_probe';
        probe.textContent = 'TWLV PROBE';
        probe.style.cssText =
          'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
          'z-index:2147483647;background:#ff00ff;color:#fff;font:bold 16px Verdana;' +
          'padding:10px 16px;border-radius:6px;pointer-events:none;';
        ov.appendChild(probe);
      }

      var status = document.createElement('div');
      status.id = 'twlv_estatus';
      status.style.cssText =
        'flex:0 0 auto;padding:3px 8px;background:#f4e4bc;border-top:1px solid #804000;' +
        'font:10px Verdana;color:#603000;';
      status.textContent = 'lade Karte…';
      ov.appendChild(status);

      document.body.appendChild(ov);
      this.embedEl = ov;
      this.embedFrame = frame;
      this.embedVisible = true;

      bar.querySelector('#twlv_eclose').onclick = function () { self.closeEmbed(); };
      bar.querySelector('#twlv_etoggle').onclick = function () {
        self.embedVisible = !self.embedVisible;
        this.textContent = self.embedVisible ? 'Linien aus' : 'Linien an';
        self.drawEmbed();
      };
      bar.querySelector('#twlv_esel').onchange = function () {
        var i = +this.value;
        try { sessionStorage.setItem('twlv_sel_idx', String(i)); } catch (e) {}
        self.loadPlanInto(i, status);
      };

      // When the iframe's map is ready, start drawing into it.
      var tries = 0;
      var waitMap = setInterval(function () {
        tries++;
        var fw;
        try { fw = frame.contentWindow; } catch (e) { fw = null; }
        var fmap = fw && fw.TWMap && fw.TWMap.map;
        // Wait for the map to have ACTUALLY rendered (pos is [-1,-1] until the
        // first sector spawns). Drawing before that = wrong/no coords.
        var ready = fmap && fmap.el && fmap.pos && fmap.pos[0] !== -1;
        if (ready) {
          clearInterval(waitMap);
          self.embedWin = fw;
          self.hookEmbed();
          var sel = bar.querySelector('#twlv_esel');
          var i = sel ? +sel.value : 0;
          self.loadPlanInto(i, status);
        } else if (fmap && fmap.el) {
          // TWMap exists but hasn't rendered — keep the loop alive longer.
          status.textContent = 'Karte rendert… (' + tries + ')';
          if (tries > 120) { clearInterval(waitMap); status.textContent = '⚠ Karte rendert nicht (pos bleibt -1).'; }
        } else if (tries > 60) {
          clearInterval(waitMap);
          status.textContent = '⚠ Karte im Rahmen nicht geladen (TWMap fehlt).';
        }
      }, 300);
    },

    closeEmbed: function () {
      if (this._embedRAF) { cancelAnimationFrame(this._embedRAF); this._embedRAF = null; }
      if (this.embedEl) { this.embedEl.remove(); this.embedEl = null; }
      this.embedFrame = null; this.embedWin = null;
      this.embedStage = null; this.outerCanvas = null;
    },

    // World coord → pixel on the OUTER canvas (which overlays the iframe in the
    // parent doc). The pixel inside the iframe's map viewport is (coordPixel −
    // pos); we then add the iframe map viewport's OFFSET within the iframe (in
    // case the map sits below a header), so it lines up with the outer canvas.
    embedCoordToScreen: function (x, y, center) {
      try {
        var fw = this.embedWin;
        var m = fw && fw.TWMap && fw.TWMap.map;
        if (!m || !m.pos) return null;
        var off = center ? 0.5 : 0;
        var p = m.pixelByCoord(x + off, y + off);
        // Pixel inside the iframe's map VIEWPORT.
        var vx = p[0] - m.pos[0], vy = p[1] - m.pos[1];
        // Convert to OUTER-canvas pixels:
        //   + map viewport's position within the iframe document
        //   + iframe's position within the parent (== outer canvas origin, since
        //     both the canvas and iframe share the overlay's top-left)
        var root = m.el && m.el.root;
        if (root && root.jquery) root = root[0];
        var rootRect = root && root.getBoundingClientRect
          ? root.getBoundingClientRect() : { left: 0, top: 0 };
        var frame = this.embedFrame;
        var frameRect = frame && frame.getBoundingClientRect
          ? frame.getBoundingClientRect() : { left: 0, top: 0 };
        var canvasRect = this.outerCanvas && this.outerCanvas.getBoundingClientRect
          ? this.outerCanvas.getBoundingClientRect() : { left: 0, top: 0 };
        // screen-in-parent = frame.left + root.left(in-iframe) + viewportPixel
        // then subtract the canvas's own origin so we get canvas-local coords.
        var sx = frameRect.left + rootRect.left + vx - canvasRect.left;
        var sy = frameRect.top + rootRect.top + vy - canvasRect.top;
        return { sx: sx, sy: sy };
      } catch (e) { return null; }
    },

    embedDiag: '',
    // Draw onto the OUTER canvas (in the parent document) that overlays the
    // iframe — NOT a canvas inside the iframe. Inside the app's iframe the canvas
    // was hidden/clipped; an outer overlay can't be. We only READ pos/pixelByCoord
    // from the iframe's TWMap for the transform.
    drawEmbed: function () {
      var fw = this.embedWin;
      var c = this.outerCanvas;
      var stage = this.embedStage;
      if (!c || !stage) { this.embedDiag = 'kein outer-canvas'; return; }

      // Size the outer canvas to its OWN box (covers the whole overlay).
      var rect = c.getBoundingClientRect();
      var w = Math.round(rect.width) || stage.clientWidth || 0;
      var h = Math.round(rect.height) || stage.clientHeight || 0;
      if (!w || !h) { this.embedDiag = 'canvas 0×0'; return; }
      var dpr = window.devicePixelRatio || 1;
      if (c.width !== w * dpr || c.height !== h * dpr) {
        c.width = w * dpr; c.height = h * dpr;
        c.style.width = w + 'px'; c.style.height = h + 'px';
      }
      var ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!this.embedVisible) { this.embedDiag = 'ausgeblendet'; return; }

      // TEST MARKER (temporary) on the OUTER canvas — must be visible now.
      if (TWLV_DEBUG_MARKER) {
        ctx.save();
        ctx.strokeStyle = '#ff00ff'; ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, w - 4, h - 4);
        ctx.fillStyle = 'rgba(255,0,255,0.85)';
        ctx.fillRect(10, 10, 70, 30);
        ctx.fillStyle = '#fff'; ctx.font = '14px Verdana';
        ctx.fillText('TWLV', 16, 30);
        ctx.restore();
      }

      if (!fw || !fw.TWMap || !fw.TWMap.map) { this.embedDiag = 'kein iframe-TWMap'; return; }
      var m = fw.TWMap.map;
      var posOk = !!(m.pos && m.pos[0] !== -1);
      var plotted = 0;
      var self = this;
      ctx.lineWidth = LINE_WIDTH; ctx.lineJoin = 'round';
      this.plan.lines.forEach(function (ln) {
        ctx.beginPath(); var first = true;
        for (var i = 0; i < ln.points.length; i++) {
          var s = self.embedCoordToScreen(ln.points[i][0], ln.points[i][1], false);
          if (!s) continue;
          if (first) { ctx.moveTo(s.sx, s.sy); first = false; } else ctx.lineTo(s.sx, s.sy);
          plotted++;
        }
        ctx.strokeStyle = ln.color || DEFAULT_COLOR; ctx.stroke();
      });
      ctx.font = '700 12px Verdana, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      this.plan.labels.forEach(function (lb) {
        var s = self.embedCoordToScreen(lb.x, lb.y, true);
        if (!s) return;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(lb.text, s.sx, s.sy);
        ctx.fillStyle = '#fff'; ctx.fillText(lb.text, s.sx, s.sy);
        plotted++;
      });
      // Diagnostic surfaced in the embed status bar so we see WHY nothing shows.
      this.embedDiag = 'mapEl ' + w + '×' + h +
        ' · pos=' + (m.pos ? m.pos[0] + ',' + m.pos[1] : 'null') +
        ' · ' + plotted + ' Pkt' + (posOk ? '' : ' · ⚠pos nicht bereit');
      // Push to the status bar the user can read.
      var outerSt = document.getElementById('twlv_estatus');
      if (outerSt) outerSt.textContent =
        this.plan.lines.length + ' Linien, ' + this.plan.labels.length + ' Labels · ' + this.embedDiag;
    },

    // Keep the embed canvas glued to the iframe map (pan/zoom) via rAF.
    hookEmbed: function () {
      var self = this;
      function loop() {
        if (!self.embedEl) return; // closed
        self.drawEmbed();
        self._embedRAF = requestAnimationFrame(loop);
      }
      this._embedRAF = requestAnimationFrame(loop);
    },

    // Fetch + parse a plan and store it (used by both overlay and embed).
    loadPlanInto: function (i, statusEl) {
      var self = this;
      var pl = (this._plans || [])[i]; if (!pl) return;
      if (statusEl) statusEl.textContent = 'lade ' + pl.name + '…';
      fetchText(pl.file, pl).then(function (txt) {
        var plan = parsePlan(txt);
        self.plan = plan;
        try { sessionStorage.setItem('twlv_plan', JSON.stringify(plan)); } catch (e) {}
        self.drawEmbed();
        if (statusEl) statusEl.textContent =
          plan.lines.length + ' Linien, ' + plan.labels.length + ' Labels';
      }).catch(function (e) {
        if (statusEl) statusEl.textContent = 'Fehler: ' + e;
      });
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
