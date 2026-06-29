/*
 * TW Noble LIVE Advisor  (Schnellleiste script)
 * ─────────────────────────────────────────────
 * Unlike the static tw_noble_guide.js (a fixed pre-computed order), THIS reads
 * your ACTUAL live game state every time it runs and computes the best next
 * move against reality:
 *   • current wood/clay/iron + storage cap + pop  (from game_data)
 *   • building levels                              (from game_data)
 *   • troops home + scavenge squad status          (read-only GET of screens)
 * and then tells you:
 *   • BUILD: the next on-plan building — affordable NOW, or "wait ~N min"
 *   • SCAVENGE: the loot/hour-MAXIMISING troop split to send right now
 *     (exact TW water-fill math, ported from the bot's _optimal_carry_split)
 *   • POP: warns when you're farm-capped (the limiter you asked about)
 *
 * It only READS the game (GETs, same as loading a page) and shows advice. The
 * build button optionally sends the build (AUTO_BUILD) — you drive every tap.
 *
 * Quickbar: javascript:$.getScript('https://fne-stack.github.io/DS-TEST/tw_noble_live.js');
 */
(function () {
  'use strict';
  var W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  // ⚠️ See tw_noble_guide.js note. false = navigate+highlight; true = send build.
  var AUTO_BUILD = false;

  // ── THE PLAN (build order from noble_optimizer.py) ───────────────────────
  var PLAN = [
    ["place",1],["main",1],["scav",1],["scav",2],["main",2],["main",3],
    ["main",4],["barracks",1],["wood",1],["stone",1],["iron",1],["wood",2],
    ["wood",3],["stone",2],["stone",3],["storage",1],["storage",2],["wood",4],
    ["wood",5],["wood",6],["stone",4],["stone",5],["iron",2],["iron",3],
    ["stone",6],["stone",7],["iron",4],["iron",5],["farm",1],["iron",6],
    ["iron",7],["farm",2],["farm",3],["storage",3],["storage",4],["wood",7],
    ["wood",8],["wood",9],["wood",10],["stone",8],["farm",4],["farm",5],
    ["wood",11],["stone",9],["stone",10],["wood",12],["farm",6],["farm",7],
    ["storage",5],["storage",6],["storage",7],["storage",8],["wood",13],["iron",8],
    ["stone",11],["storage",9],["storage",10],["scav",3],["wood",14],["farm",8],
    ["iron",9],["storage",11],["storage",12],["storage",13],["iron",10],["storage",14],
    ["stone",12],["farm",9],["farm",10],["wood",15],["stone",13],["storage",15],
    ["wood",16],["iron",11],["wood",17],["stone",14],["storage",16],["iron",12],
    ["farm",11],["storage",17],["iron",13],["storage",18],["wood",18],["stone",15],
    ["wood",19],["farm",12],["iron",14],["wood",20],["stone",16],["farm",13],
    ["farm",14],["iron",15],["stone",17],["iron",16],["iron",17],["stone",18],
    ["stone",19],["iron",18],["iron",19],["farm",15],["stone",20],["iron",20],
    ["iron",21],["farm",16],["market",1],["market",2],["market",3],["main",5],
    ["smith",1],["smith",2],["smith",3],["smith",4],["smith",5],["smith",6],
    ["main",6],["smith",7],["main",7],["smith",8],["farm",17],["farm",18],
    ["market",4],["main",8],["main",9],["smith",9],["smith",10],["market",5],
    ["main",10],["main",11],["main",12],["smith",11],["smith",12],["market",6],
    ["smith",13],["main",13],["smith",14],["market",7],["main",14],["main",15],
    ["farm",19],["farm",20],["smith",15],["smith",16],["market",8],["main",16],
    ["smith",17],["main",17],["smith",18],["market",9],["main",18],["smith",19],
    ["farm",21],["main",19],["smith",20],["market",10],["main",20],["snob",1]
  ];

  var BMETA = {
    main:["Hauptgebäude","main"], place:["Versammlungsplatz","place"],
    barracks:["Kaserne","main"], smith:["Schmiede","main"],
    market:["Marktplatz","main"], wood:["Holzfäller","main"],
    stone:["Lehmgrube","main"], iron:["Eisenmine","main"],
    farm:["Bauernhof","main"], storage:["Speicher","main"],
    snob:["Adelshof","main"], scav:["Raubzug","place"]
  };

  // ── TW scavenge constants (verified from Scavenging.js) ──────────────────
  var SCAV_LOOT = {1:0.10, 2:0.25, 3:0.50, 4:0.75};
  var DUR_EXP = 0.45, DUR_INITIAL = 1800.0, DUR_FACTOR = 0.7722074896557402;
  var CARRY = {spear:25, sword:15, axe:10, archer:10, light:80, marcher:50,
               heavy:50, spy:0, ram:0, catapult:0, knight:100};

  // exact TW run duration (seconds) for a squad of `carry` on tier loot factor lf
  function scavDuration(carry, lf) {
    if (carry <= 0) return 1;
    var inner = carry * (100 * lf) * carry * lf;
    return (Math.pow(inner, DUR_EXP) + DUR_INITIAL) * DUR_FACTOR;
  }
  function scavRate(carry, lf) {           // loot per second for the squad
    if (carry <= 0) return 0;
    return (carry * lf) / scavDuration(carry, lf);
  }
  // water-fill: carry budget per tier that MAXIMISES total loot/hour
  function optimalSplit(totalCarry, tiers) {
    var budget = {}; tiers.forEach(function (t) { budget[t] = 0; });
    if (!tiers.length || totalCarry <= 0) return budget;
    var nChunks = 200, chunk = totalCarry / nChunks;
    for (var k = 0; k < nChunks; k++) {
      var bestT = null, bestGain = -1;
      tiers.forEach(function (t) {
        var lf = SCAV_LOOT[t];
        var gain = scavRate(budget[t] + chunk, lf) - scavRate(budget[t], lf);
        if (gain > bestGain) { bestGain = gain; bestT = t; }
      });
      if (bestT === null) break;
      budget[bestT] += chunk;
    }
    return budget;
  }

  // ── LIVE STATE ───────────────────────────────────────────────────────────
  var GD = W.game_data || {};
  function res() {
    var v = GD.village || {};
    return { wood: Math.floor(v.wood||0), stone: Math.floor(v.stone||0),
             iron: Math.floor(v.iron||0), cap: v.storage_max||0,
             pop: v.pop||0, popMax: v.pop_max||0 };
  }
  function levels() {
    var b = (GD.village && GD.village.buildings) || {};
    var o = {}; Object.keys(b).forEach(function (k){ o[k]=parseInt(b[k],10)||0; });
    return o;
  }
  // production per hour (game_data exposes it on most screens)
  function prodPerHour() {
    var v = GD.village || {};
    // game_data.village.*_prod is per-hour on de worlds; fall back to 0.
    return { wood: v.wood_prod ? v.wood_prod*3600 : (v.wood_production||0),
             stone: v.stone_prod ? v.stone_prod*3600 : (v.stone_production||0),
             iron: v.iron_prod ? v.iron_prod*3600 : (v.iron_production||0) };
  }

  // scavenge tiers unlocked — fetched live (see fetchScavenge), manual fallback
  function scavTiers() {
    if (typeof W.__twnl_scav === "number") return W.__twnl_scav;
    return 0;
  }

  // troops home — fetched live (see fetchTroops), cached on W.__twnl_troops
  function troopsHome() {
    if (GD.village && GD.village.unit_counts) return GD.village.unit_counts;
    return W.__twnl_troops || null;
  }

  // ── LIVE FETCH (read-only GETs — same request type as loading the page) ──
  var _fetchedTroops = false, _fetchedScav = false;
  function vidParam() { return (GD.village && GD.village.id) || ""; }

  // Read troops currently HOME from the place (Versammlungsplatz) screen. The
  // unit-input form on screen=place lists home counts per unit as the max each
  // input can take, e.g. <a ...>(123)</a> next to each unit row.
  function fetchTroops() {
    if (_fetchedTroops) return Promise.resolve();
    _fetchedTroops = true;
    return fetch("/game.php?village=" + vidParam() + "&screen=place",
                 { credentials: "include" })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var t = {};
        // TW lists home count per unit as: id="units_entry_all_spear">(123)<
        var re = /units_entry_all_(\w+)"[^>]*>\s*\(?(\d+)\)?\s*</gi, m;
        while ((m = re.exec(html))) { t[m[1]] = parseInt(m[2], 10) || 0; }
        // fallback: unit links like unit_link_spear ... (123)
        if (Object.keys(t).length === 0) {
          var re2 = /name="(\w+)"[^>]*max="(\d+)"/gi;
          while ((m = re2.exec(html))) {
            if (CARRY[m[1]] !== undefined) t[m[1]] = parseInt(m[2], 10) || 0;
          }
        }
        if (Object.keys(t).length) W.__twnl_troops = t;
      })
      .catch(function (e) { console.warn("[noble-live] troops fetch failed", e); });
  }

  // Read scavenge state: how many tiers unlocked + which squads are out. The
  // scavenge screen embeds an inline JSON (ScavengeScreen) with options[].
  function fetchScavenge() {
    if (_fetchedScav) return Promise.resolve();
    _fetchedScav = true;
    return fetch("/game.php?village=" + vidParam() + "&screen=place&mode=scavenge",
                 { credentials: "include" })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        // Count unlocked options: each unlocked tier lacks an "unlock" CTA and
        // is marked is_fully_unlocked / unlocked in the inline JSON. Use a
        // robust signal: count "scavenge_option_..." blocks whose unlock flag
        // is true.
        var unlocked = 0;
        // Inline JSON often has "is_fully_unlocked":true per unlocked option.
        var mm = html.match(/"is_fully_unlocked":true/g);
        if (mm) unlocked = mm.length;
        if (!unlocked) {
          // fallback: count option rows NOT showing an "unlock" button
          var opts = (html.match(/class="[^"]*scavenge-option[^"]*"/g) || []).length;
          var locks = (html.match(/unlock-button|ScavengeUnlockButton/g) || []).length;
          if (opts) unlocked = Math.max(0, opts - locks);
        }
        W.__twnl_scav = unlocked;

        // squads currently OUT + their return time (seconds): inline JSON has
        // "scavenging_squad":{...,"return_time" / "duration"...} per busy option.
        var out = [];
        var re = /"squad_id"\s*:\s*\d+[\s\S]{0,400}?"return_time"\s*:\s*"?(\d+)"?/g, m;
        while ((m = re.exec(html))) out.push(parseInt(m[1], 10));
        W.__twnl_scav_out = out;  // unix seconds of returns (best-effort)
      })
      .catch(function (e) { console.warn("[noble-live] scavenge fetch failed", e); });
  }

  // ── BUILD ADVISOR ────────────────────────────────────────────────────────
  function nextBuild(lv) {
    for (var i=0;i<PLAN.length;i++){
      var b=PLAN[i][0], t=PLAN[i][1];
      if (b==="scav"){ if (scavTiers()<t) return {i:i,b:b,t:t}; }
      else if ((lv[b]||0)<t) return {i:i,b:b,t:t};
    }
    return null;
  }
  // wait-time (min) until the village can afford a cost, from live income
  function waitMinutes(cost, r, prod) {
    function need(have, want, perHr){
      if (have>=want) return 0;
      if (perHr<=0) return Infinity;
      return (want-have)/perHr*60;
    }
    return Math.ceil(Math.max(
      need(r.wood, cost.wood||0, prod.wood),
      need(r.stone, cost.stone||0, prod.stone),
      need(r.iron, cost.iron||0, prod.iron)));
  }

  // ── PANEL ────────────────────────────────────────────────────────────────
  function render() {
    var r = res(), lv = levels(), prod = prodPerHour();
    var nb = nextBuild(lv);
    var th = troopsHome();

    var old=document.getElementById("twnl"); if(old) old.remove();
    var p=document.createElement("div"); p.id="twnl";
    p.style.cssText=["position:fixed","z-index:2147483647",
      "bottom:calc(10px + env(safe-area-inset-bottom,0px))","left:8px",
      "width:248px","background:#f4e4bc","border:2px solid #804000",
      "border-radius:8px","font:12px/1.35 Verdana,Arial,sans-serif","color:#000",
      "box-shadow:0 3px 12px rgba(0,0,0,.45)","padding:8px","max-height:80vh",
      "overflow:auto"].join(";");

    var head=document.createElement("div");
    head.style.cssText="font-weight:bold;display:flex;justify-content:space-between;margin-bottom:5px";
    var pct = nb ? Math.round(100*nb.i/PLAN.length) : 100;
    head.innerHTML="<span>👑 Noble LIVE</span><span style='opacity:.6'>"+pct+"%</span>";
    var x=document.createElement("span"); x.textContent="✕";
    x.style.cssText="cursor:pointer;padding:0 3px"; x.onclick=function(){p.remove();};
    head.appendChild(x); p.appendChild(head);

    // resources line
    var rl=document.createElement("div");
    rl.style.cssText="font-size:10px;opacity:.7;margin-bottom:5px";
    rl.textContent="🪵"+r.wood+" 🧱"+r.stone+" ⚙️"+r.iron+"  pop "+r.pop+"/"+r.popMax;
    p.appendChild(rl);

    // ── BUILD card ──
    var bc=document.createElement("div");
    bc.style.cssText="background:#fff7e0;border:1px solid #c0a060;border-radius:6px;padding:7px;margin-bottom:6px;cursor:pointer";
    if (!nb) {
      bc.innerHTML="✅ <b>Plan done — build Academy/mint coin.</b>";
    } else if (nb.b==="scav") {
      bc.innerHTML="<div style='font-size:10px;opacity:.6'>NEXT BUILD</div><b>🔓 Unlock scavenge tier "+nb.t+"</b>";
    } else {
      var label=(BMETA[nb.b]&&BMETA[nb.b][0])||nb.b;
      var cost = costFromDom(nb.b);   // try to read live cost off the page
      var wait = cost ? waitMinutes(cost, r, prod) : null;
      var afford = cost ? (r.wood>=(cost.wood||0)&&r.stone>=(cost.stone||0)&&r.iron>=(cost.iron||0)) : null;
      // pop check
      var popBlock = (nb.b!=="farm" && cost && cost.pop && (r.pop+cost.pop>r.popMax));
      bc.innerHTML="<div style='font-size:10px;opacity:.6'>NEXT BUILD"+
        (AUTO_BUILD?" — tap to BUILD ⚠️":" — tap to open")+"</div>"+
        "<div style='font-size:14px;font-weight:bold'>"+label+" → "+nb.t+"</div>"+
        (popBlock ? "<div style='color:#b00;font-size:11px'>⚠ pop-capped — build Bauernhof first</div>"
          : afford===true ? "<div style='color:#2a8;font-size:11px'>✓ affordable now</div>"
          : afford===false ? "<div style='font-size:11px;opacity:.7'>⏳ wait ~"+wait+" min</div>"
          : "<div style='font-size:10px;opacity:.5'>open to see cost</div>");
    }
    if (nb) bc.onclick=function(){ doBuild(nb); };
    p.appendChild(bc);

    // ── SCAVENGE card ──
    var sc=document.createElement("div");
    sc.style.cssText="background:#eaf3e0;border:1px solid #9bbf7a;border-radius:6px;padding:7px;margin-bottom:6px";
    var tiers=[]; for(var t=1;t<=scavTiers();t++) tiers.push(t);
    if (!tiers.length) {
      sc.innerHTML="<div style='font-size:10px;opacity:.6'>SCAVENGE</div>"+
        "<div style='font-size:11px'>No tiers unlocked yet — unlock tier 1 at the Raubzug.</div>";
    } else if (!th) {
      sc.innerHTML="<div style='font-size:10px;opacity:.6'>SCAVENGE</div>"+
        "<div style='font-size:11px'>Open the Raubzug/Versammlungsplatz once so I can read your troops, then reopen me.</div>";
    } else {
      var totalCarry=0; Object.keys(th).forEach(function(u){ totalCarry+=(th[u]||0)*(CARRY[u]||0); });
      var split=optimalSplit(totalCarry, tiers);
      var lines=["<div style='font-size:10px;opacity:.6'>SCAVENGE — optimal split (max loot/h)</div>"];
      var lph=0;
      tiers.slice().reverse().forEach(function(t){
        var c=Math.round(split[t]);
        if (c<=0) return;
        var dur=scavDuration(c, SCAV_LOOT[t]);
        lph += scavRate(c, SCAV_LOOT[t])*3600;
        lines.push("• Tier "+t+": ~"+c+" carry  ("+(Math.round(dur/60))+" min/run)");
      });
      lines.push("<div style='font-size:10px;opacity:.6;margin-top:3px'>≈ "+Math.round(lph)+" res/hour total</div>");
      sc.innerHTML=lines.join("<br>");
      var go=document.createElement("a");
      go.href="/game.php?village="+(GD.village&&GD.village.id||"")+"&screen=place&mode=scavenge";
      go.textContent="→ open Raubzug to send";
      go.style.cssText="display:inline-block;margin-top:4px;font-size:11px;color:#36c";
      sc.appendChild(go);
    }
    p.appendChild(sc);

    // scavenge tier sync buttons
    var tg=document.createElement("div");
    tg.style.cssText="font-size:10px;opacity:.7;margin-bottom:3px";
    tg.innerHTML="scavenge tiers unlocked: ";
    [0,1,2,3].forEach(function(n){
      var b=document.createElement("span"); b.textContent=n;
      b.style.cssText="cursor:pointer;padding:1px 5px;margin:0 1px;border:1px solid #999;border-radius:3px;"+
        (scavTiers()===n?"background:#804000;color:#fff":"background:#fff");
      b.onclick=function(){ W.__twnl_scav=n; render(); };
      tg.appendChild(b);
    });
    p.appendChild(tg);

    // refresh button — re-fetch troops + scavenge (e.g. after you send a run)
    var rf=document.createElement("span");
    rf.textContent="🔄 refresh troops/scavenge";
    rf.style.cssText="display:inline-block;margin-bottom:4px;font-size:10px;color:#36c;cursor:pointer";
    rf.onclick=function(){
      _fetchedTroops=false; _fetchedScav=false;
      Promise.all([fetchTroops(),fetchScavenge()]).then(function(){
        _fetchedTroops=false; _fetchedScav=false; render();
      });
    };
    p.appendChild(rf);

    var note=document.createElement("div");
    note.style.cssText="font-size:9px;opacity:.5";
    note.textContent="Reads live state. "+(AUTO_BUILD?"⚠️ AUTO-BUILD ON.":"You click the game's buttons.");
    p.appendChild(note);

    document.body.appendChild(p);
  }

  // read the live upgrade cost for a building from the main screen DOM (if we're
  // on it); returns null if not visible (then we just can't show "wait N min").
  function costFromDom(b) {
    var tr=document.getElementById("main_buildrow_"+b);
    if(!tr) return null;
    function num(sel){ var e=tr.querySelector(sel); if(!e) return 0;
      var m=(e.getAttribute("data-cost")|| e.textContent||"").replace(/\D/g,""); return parseInt(m,10)||0; }
    return { wood:num(".cost_wood"), stone:num(".cost_stone"), iron:num(".cost_iron"), pop:0 };
  }

  // build action: navigate+highlight (safe) OR send (AUTO_BUILD)
  function doBuild(nb) {
    var vid=(GD.village&&GD.village.id)||"";
    if (nb.b==="scav" || !AUTO_BUILD) {
      var screen=(BMETA[nb.b]&&BMETA[nb.b][1])||"main";
      try{ sessionStorage.setItem("twnl_flash", nb.b); }catch(e){}
      W.location.href="/game.php?village="+vid+"&screen="+screen+(nb.b==="scav"?"&mode=scavenge":"");
      return;
    }
    var mainUrl="/game.php?village="+vid+"&screen=main";
    fetch(mainUrl,{credentials:"include"}).then(function(r){return r.text();}).then(function(html){
      var re=new RegExp('href="([^"]*action=upgrade_building[^"]*id='+nb.b+'(?:&amp;|&)[^"]*)"','i');
      var m=html.match(re);
      if(!m){ alert("Can't build "+nb.b+" now (cost/prereq/queue). Opening screen."); W.location.href=mainUrl; return; }
      var link=m[1].replace(/&amp;/g,"&"); if(link.charAt(0)!=="/") link="/"+link.replace(/^.*game\.php/,"game.php");
      return fetch(link,{credentials:"include"}).then(function(){ setTimeout(function(){W.location.href=mainUrl;},400); });
    }).catch(function(e){ alert("Build failed: "+e); W.location.href=mainUrl; });
  }

  function flash(){
    var b; try{ b=sessionStorage.getItem("twnl_flash"); sessionStorage.removeItem("twnl_flash"); }catch(e){}
    if(!b) return; var row=document.getElementById("main_buildrow_"+b); if(!row) return;
    var on=false,n=0,iv=setInterval(function(){ row.style.background=(on=!on)?"#ffe08a":""; if(++n>6){clearInterval(iv);row.style.background="";} },350);
    row.scrollIntoView({block:"center"});
  }

  flash();
  render();                                  // immediate paint from game_data
  // then fetch live troops + scavenge state (read-only) and re-render with them
  Promise.all([fetchTroops(), fetchScavenge()]).then(function () {
    _fetchedTroops = false; _fetchedScav = false;  // allow manual refresh later
    render();
  });
  console.log("[noble-live] loaded");
})();
