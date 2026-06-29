/*
 * TW Noble Guide  (RestedXP-style step-by-step opening, Schnellleiste script)
 * ──────────────────────────────────────────────────────────────────────────
 * Shows the SINGLE next action on the optimal path to your first noble
 * (Adelshof + 1 coin), computed by noble_optimizer.py for a de256-style world
 * (speed 1, non-premium, scavenge ON, raid-capped, first-to-level rewards).
 *
 * It is a GUIDE, not a bot: tapping a step NAVIGATES you to the right screen
 * and highlights the building — YOU click the game's own build/recruit button.
 * Nothing is ever sent by the script. Zero automation = zero ban surface.
 *
 * It reads your live building levels (game_data / overview) and auto-advances
 * past steps you've already completed, always pointing at the next one.
 *
 * Quickbar:  javascript:$.getScript('https://fne-stack.github.io/DS-TEST/tw_noble_guide.js');
 */
(function () {
  'use strict';
  var W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  // ── THE PLAN (from noble_optimizer.py, 150-spear sweet spot, ~9.8 days) ──
  // Each entry: ["building", targetLevel]  or  ["scav", tier] (scavenge unlock)
  // ["spear", N] markers are interleaved as army checkpoints (train toward N).
  var PLAN = [
    ["place",1],["place",2],["scav",1],["scav",2],["main",1],["main",2],
    ["main",3],["main",4],["barracks",1],["barracks",2],["wood",1],["stone",1],
    ["iron",1],["wood",2],["wood",3],["stone",2],["stone",3],["storage",1],
    ["storage",2],["wood",4],["wood",5],["wood",6],["stone",4],["stone",5],
    ["iron",2],["iron",3],["stone",6],["stone",7],["iron",4],["farm",1],
    ["farm",2],["iron",5],["iron",6],["iron",7],["wood",7],["wood",8],
    ["farm",3],["wood",9],["wood",10],["stone",8],["farm",4],["farm",5],
    ["wood",11],["stone",9],["stone",10],["wood",12],["storage",3],["farm",6],
    ["farm",7],["storage",4],["storage",5],["storage",6],["storage",7],["wood",13],
    ["iron",8],["stone",11],["storage",8],["storage",9],["farm",8],["farm",9],
    ["wood",14],["iron",9],["iron",10],["scav",3],["stone",12],["storage",10],
    ["storage",11],["storage",12],["wood",15],["stone",13],["wood",16],["iron",11],
    ["farm",10],["farm",11],["storage",13],["storage",14],["storage",15],["wood",17],
    ["stone",14],["iron",12],["iron",13],["wood",18],["stone",15],["storage",16],
    ["storage",17],["wood",19],["farm",12],["iron",14],["wood",20],["stone",16],
    ["farm",13],["farm",14],["storage",18],["storage",19],["iron",15],["stone",17],
    ["iron",16],["iron",17],["stone",18],["stone",19],["iron",18],["iron",19],
    ["farm",15],["stone",20],["iron",20],["iron",21],["farm",16],["market",1],
    ["market",2],["market",3],["main",5],["smith",1],["smith",2],["smith",3],
    ["smith",4],["smith",5],["smith",6],["main",6],["smith",7],["main",7],
    ["smith",8],["farm",17],["farm",18],["market",4],["main",8],["main",9],
    ["smith",9],["smith",10],["market",5],["main",10],["main",11],["main",12],
    ["smith",11],["smith",12],["market",6],["smith",13],["main",13],["smith",14],
    ["market",7],["main",14],["main",15],["farm",19],["farm",20],["smith",15],
    ["smith",16],["market",8],["main",16],["smith",17],["main",17],["smith",18],
    ["market",9],["main",18],["smith",19],["farm",21],["main",19],["smith",20],
    ["market",10],["main",20],["smith",21],["snob",1]
  ];
  // Army checkpoints: by these build-progress fractions, have this many spears.
  // (Spears don't gate the noble per the optimizer, so this is a gentle guide:
  // keep a scavenge army growing toward ~150 without overspending.)
  var SPEAR_GOAL = 150;

  // ── building slug → label + which screen builds it ───────────────────────
  var BMETA = {
    main:    ["Hauptgebäude",     "main"],
    place:   ["Versammlungsplatz", "place"],
    barracks:["Kaserne",          "main"],
    smith:   ["Schmiede",         "main"],
    market:  ["Marktplatz",       "main"],
    wood:    ["Holzfäller",       "main"],
    stone:   ["Lehmgrube",        "main"],
    iron:    ["Eisenmine",        "main"],
    farm:    ["Bauernhof",        "main"],
    storage: ["Speicher",         "main"],
    snob:    ["Adelshof (Akademie)","main"],
    scav:    ["Raubzug freischalten","place"]
  };

  // ── read live building levels from game_data / DOM ───────────────────────
  function liveLevels() {
    var lv = {};
    // 1) game_data.village.buildings (present on most screens)
    try {
      var b = W.game_data && W.game_data.village && W.game_data.village.buildings;
      if (b) {
        Object.keys(b).forEach(function (k) { lv[k] = parseInt(b[k], 10) || 0; });
      }
    } catch (e) {}
    // 2) fallback: parse the main-building rows if present
    if (Object.keys(lv).length === 0) {
      document.querySelectorAll('[id^="main_buildrow_"]').forEach(function (tr) {
        var slug = tr.id.replace('main_buildrow_', '');
        var m = tr.textContent.match(/(?:Stufe|Level)\s*(\d+)/i);
        if (m) lv[slug] = parseInt(m[1], 10);
      });
    }
    return lv;
  }
  // how many scavenge tiers are unlocked (best-effort from DOM)
  function scavTiers() {
    try {
      // unlocked options don't show the "unlock" button; count locked ones
      var locked = document.querySelectorAll('.unlock-button, .scavenge-option.is-locked').length;
      // can't always tell — fall back to a stored manual value
    } catch (e) {}
    return W.__twng_scav || 0;
  }

  // ── find the first incomplete step ───────────────────────────────────────
  function firstPending(lv) {
    for (var i = 0; i < PLAN.length; i++) {
      var b = PLAN[i][0], target = PLAN[i][1];
      if (b === "scav") {
        if (scavTiers() < target) return i;
      } else {
        if ((lv[b] || 0) < target) return i;
      }
    }
    return PLAN.length; // all done!
  }

  // ── navigate + highlight (NO build is sent — you click the game button) ──
  function gotoStep(step) {
    var b = step[0];
    var screen = (BMETA[b] && BMETA[b][1]) || "main";
    var vid = (W.game_data && W.game_data.village && W.game_data.village.id) || "";
    var url = "/game.php?village=" + vid + "&screen=" + screen;
    if (b === "scav") url += ""; // place→scavenge tab
    // stash which building to flash once the page reloads
    try { sessionStorage.setItem("twng_flash", b); } catch (e) {}
    W.location.href = url;
  }
  // after navigation, flash the target building row so it's obvious
  function flashIfNeeded() {
    var b;
    try { b = sessionStorage.getItem("twng_flash"); sessionStorage.removeItem("twng_flash"); } catch (e) {}
    if (!b) return;
    var row = document.getElementById("main_buildrow_" + b);
    if (!row) return;
    row.style.transition = "background .3s";
    var on = false, n = 0;
    var iv = setInterval(function () {
      row.style.background = (on = !on) ? "#ffe08a" : "";
      if (++n > 6) { clearInterval(iv); row.style.background = ""; }
    }, 350);
    row.scrollIntoView({ block: "center" });
  }

  // ── panel ─────────────────────────────────────────────────────────────
  function render() {
    var lv = liveLevels();
    var idx = firstPending(lv);
    var done = idx >= PLAN.length;

    var old = document.getElementById("twng_panel"); if (old) old.remove();
    var p = document.createElement("div");
    p.id = "twng_panel";
    p.style.cssText = [
      "position:fixed","z-index:2147483647",
      "bottom:calc(10px + env(safe-area-inset-bottom,0px))","left:8px",
      "width:230px","background:#f4e4bc","border:2px solid #804000",
      "border-radius:8px","font:12px/1.35 Verdana,Arial,sans-serif","color:#000",
      "box-shadow:0 3px 12px rgba(0,0,0,.45)","padding:8px"
    ].join(";");

    var pct = Math.round(100 * idx / PLAN.length);
    var head = document.createElement("div");
    head.style.cssText = "font-weight:bold;display:flex;justify-content:space-between;margin-bottom:5px";
    head.innerHTML = "<span>👑 Noble Guide</span><span style='opacity:.6'>" + pct + "%</span>";
    var x = document.createElement("span");
    x.textContent = "✕"; x.style.cssText = "cursor:pointer;padding:0 3px";
    x.onclick = function () { p.remove(); };
    head.appendChild(x);
    p.appendChild(head);

    if (done) {
      var d = document.createElement("div");
      d.innerHTML = "✅ <b>Plan complete!</b><br>Academy built — mint a coin at the Marktplatz and recruit your noble.";
      d.style.cssText = "padding:6px;background:#d7e9c8;border-radius:5px";
      p.appendChild(d);
      document.body.appendChild(p);
      return;
    }

    // current step (big, tappable)
    var step = PLAN[idx];
    var label = (BMETA[step[0]] && BMETA[step[0]][0]) || step[0];
    var cur = document.createElement("div");
    cur.style.cssText = "background:#fff7e0;border:1px solid #c0a060;border-radius:6px;padding:7px;cursor:pointer;margin-bottom:4px";
    if (step[0] === "scav") {
      cur.innerHTML = "<div style='font-size:10px;opacity:.6'>NEXT — tap to open Raubzug</div>" +
                      "<div style='font-size:14px;font-weight:bold'>🔓 Unlock scavenge tier " + step[1] + "</div>";
    } else {
      var have = lv[step[0]] || 0;
      cur.innerHTML = "<div style='font-size:10px;opacity:.6'>NEXT — tap to open & highlight</div>" +
                      "<div style='font-size:14px;font-weight:bold'>" + label + " → Stufe " + step[1] + "</div>" +
                      "<div style='font-size:10px;opacity:.6'>currently " + have + "</div>";
    }
    cur.onclick = function () { gotoStep(step); };
    p.appendChild(cur);

    // upcoming preview (next 4)
    var up = document.createElement("div");
    up.style.cssText = "font-size:10px;opacity:.7;line-height:1.5";
    var lines = ["<u>coming up</u>"];
    for (var j = idx + 1; j < Math.min(idx + 5, PLAN.length); j++) {
      var s = PLAN[j];
      var lab = (BMETA[s[0]] && BMETA[s[0]][0]) || s[0];
      lines.push((s[0] === "scav" ? "🔓 scavenge t" + s[1] : lab + " → " + s[1]));
    }
    up.innerHTML = lines.join("<br>");
    p.appendChild(up);

    // scavenge tier manual sync (DOM can't always read it)
    var sc = document.createElement("div");
    sc.style.cssText = "margin-top:6px;font-size:10px;opacity:.7";
    sc.innerHTML = "scavenge tiers unlocked: ";
    [0,1,2,3].forEach(function (n) {
      var btn = document.createElement("span");
      btn.textContent = n;
      btn.style.cssText = "cursor:pointer;padding:1px 5px;margin:0 1px;border:1px solid #999;border-radius:3px;" +
                          (scavTiers() === n ? "background:#804000;color:#fff" : "background:#fff");
      btn.onclick = function () { W.__twng_scav = n; render(); };
      sc.appendChild(btn);
    });
    p.appendChild(sc);

    var note = document.createElement("div");
    note.style.cssText = "margin-top:6px;font-size:9px;opacity:.5";
    note.textContent = "Guide only — you click the game's own build button. ~9.8 days to first noble.";
    p.appendChild(note);

    document.body.appendChild(p);
  }

  flashIfNeeded();
  render();
  // re-render periodically so it auto-advances as builds finish
  setInterval(render, 8000);
  console.log("[noble-guide] loaded, " + PLAN.length + " steps");
})();
