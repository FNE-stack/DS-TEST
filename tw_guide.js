/*
 * TW Noble Guide — pre-planned timeline + live check  (Schnellleiste script)
 * ──────────────────────────────────────────────────────────────────────────
 * The build order, costs, pop curve, scavenge income and 150/150/100 first-to-
 * level rewards were ALL solved offline by noble_optimizer.py. The resulting
 * 157-step TIMELINE is baked in below (TL) — each step knows: when it happens,
 * its cost, the pop after it, the scavenge tier active, and the resources you
 * should have on hand at that moment. So the guide is a finished route, not a
 * live calculator.
 *
 * Live game state is used only as a CHECK: it reads your real resources + pop
 * and compares to the timeline's expectation at your current step → "✓ on
 * track" / "⚠ behind on iron, scavenge more" / "ahead → pull next build
 * forward". Read-only; the build button optionally sends the build (AUTO_BUILD).
 *
 * Parallel queues (build / scavenge-unlock / scavenge-send / troops) run at the
 * same time, so the board shows the best action in EACH simultaneously.
 *
 * Quickbar: javascript:$.getScript('https://fne-stack.github.io/DS-TEST/tw_noble_live.js');
 */
(function () {
  'use strict';
  var W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  var GD = W.game_data || {};

  // ⚠️ false = navigate+highlight (you click the game's button). true = the
  // script sends the build (automation; the de256 ban vector). See discussion.
  var AUTO_BUILD = true;

  // ── EMBEDDED TIMELINE (from noble_optimizer.py) ──────────────────────────
  // row = [type, building, level, at_h, cw,cs,ci,cpop, pop_used,pop_cap, tiers, ew,es,ei]
  //   type: 1=build, 0=scavenge-unlock ;  e* = expected resources on hand
  var TL = [
  [1,"place",1,0.0,10,40,30,0,0,240,0,490,460,470],
  [1,"main",1,0.0,90,80,70,5,5,240,0,400,380,400],
  [0,"scavenge",1,0.17,25,30,25,0,5,240,1,526,501,476],
  [0,"scavenge",2,0.17,250,300,250,0,5,240,2,276,201,226],
  [1,"main",2,0.17,113,101,88,6,11,240,2,163,100,138],
  [1,"main",3,0.25,143,127,111,7,18,240,2,170,123,127],
  [1,"main",4,0.47,180,160,140,8,26,240,2,141,114,88],
  [1,"barracks",1,0.6,200,170,90,7,33,240,2,92,95,99],
  [1,"wood",1,1.03,50,60,40,5,38,240,2,344,337,261],
  [1,"stone",1,1.03,65,50,40,5,43,240,2,279,287,221],
  [1,"iron",1,1.25,75,65,70,10,53,240,2,505,523,352],
  [1,"wood",2,1.25,62,75,50,6,59,240,2,443,448,302],
  [1,"wood",3,1.5,78,94,62,7,66,240,2,673,662,442],
  [1,"stone",2,1.5,83,64,51,6,72,240,2,590,598,391],
  [1,"stone",3,1.75,105,81,65,7,79,240,2,644,674,433],
  [1,"storage",1,1.8,60,50,40,0,79,240,2,735,776,495],
  [1,"storage",2,2.05,76,63,51,0,79,240,2,820,872,551],
  [1,"wood",4,2.08,98,117,78,8,92,240,2,629,762,530],
  [1,"wood",5,2.38,122,146,98,9,103,240,2,569,719,521],
  [1,"wood",6,2.45,153,183,122,10,114,240,2,519,658,491],
  [1,"stone",4,2.82,133,102,82,8,123,240,2,520,708,527],
  [1,"stone",5,2.97,169,130,104,9,132,240,2,509,734,527],
  [1,"iron",2,3.18,94,81,88,11,143,240,2,598,831,565],
  [1,"iron",3,3.4,118,102,110,13,158,240,2,544,829,541],
  [1,"stone",6,3.48,215,165,132,10,168,240,2,484,819,512],
  [1,"stone",7,3.77,273,210,168,12,180,240,2,402,797,477],
  [1,"iron",4,4.0,147,128,137,15,195,240,2,420,832,449],
  [1,"iron",5,4.38,184,160,172,17,212,240,2,434,870,416],
  [1,"farm",1,4.43,45,40,30,0,212,240,2,542,983,488],
  [1,"iron",6,4.72,231,200,215,19,232,281,2,452,947,399],
  [1,"iron",7,4.9,289,250,270,21,253,281,2,325,861,238],
  [1,"farm",2,5.33,53,47,35,0,253,281,2,474,1021,352],
  [1,"farm",3,5.65,62,55,41,0,253,281,2,583,1139,431],
  [1,"storage",3,5.67,96,80,64,0,253,330,2,638,1210,468],
  [1,"storage",4,6.05,121,101,81,0,255,386,2,616,1253,520],
  [1,"wood",7,6.07,191,229,153,12,269,386,2,476,1115,449],
  [1,"wood",8,6.53,238,286,191,14,283,386,2,451,1047,425],
  [1,"wood",9,6.68,298,358,238,16,299,386,2,313,850,299],
  [1,"wood",10,7.28,373,447,298,18,317,386,2,201,664,212],
  [1,"stone",8,7.58,346,266,213,14,331,386,2,31,570,121],
  [1,"farm",4,8.33,72,64,48,0,331,386,2,251,778,295],
  [1,"farm",5,8.35,84,75,56,0,331,386,2,318,855,340],
  [1,"wood",11,8.82,466,559,373,21,352,453,2,90,519,135],
  [1,"stone",9,9.97,440,338,271,16,368,531,2,1,497,116],
  [1,"stone",10,11.37,559,430,344,18,386,531,2,30,594,175],
  [1,"wood",12,14.98,582,698,466,24,417,531,2,7,508,274],
  [1,"farm",6,22.37,99,88,66,0,453,531,2,443,1406,1546],
  [1,"farm",7,22.37,115,103,77,0,453,531,2,328,1303,1469],
  [1,"storage",5,23.42,154,128,102,0,461,729,2,502,1620,1827],
  [1,"storage",6,23.43,194,162,130,0,461,729,2,311,1460,1699],
  [1,"storage",7,26.62,246,205,164,0,489,729,2,493,2113,2715],
  [1,"storage",8,27.15,311,259,207,0,490,729,2,416,2086,2738],
  [1,"wood",13,27.68,728,873,582,28,520,729,2,26,1570,2479],
  [1,"iron",8,28.22,362,313,338,24,544,729,2,103,1673,2485],
  [1,"stone",11,29.28,709,546,437,21,567,729,2,25,1754,2621],
  [1,"storage",9,32.48,393,328,262,0,598,729,2,385,2628,3945],
  [1,"storage",10,33.02,498,415,332,0,598,729,2,258,2559,3932],
  [1,"farm",8,34.67,135,120,90,0,622,729,2,398,3114,4815],
  [1,"farm",9,34.67,158,140,105,0,622,729,2,240,2974,4710],
  [1,"wood",14,36.28,909,1091,728,33,674,1002,2,3,2858,5156],
  [1,"iron",9,36.83,453,392,423,28,702,1002,2,14,2903,5143],
  [1,"iron",10,37.9,567,491,529,31,734,1002,2,105,3040,5158],
  [1,"storage",11,39.03,630,525,420,0,748,1002,2,275,3524,5936],
  [1,"storage",12,39.58,796,664,531,0,748,1002,2,140,3478,5961],
  [1,"stone",12,41.23,901,693,554,24,790,1002,2,72,3849,6749],
  [0,"scavenge",3,42.88,1000,1200,1000,0,811,1002,3,27,3898,7284],
  [1,"wood",15,43.97,1137,1364,909,38,863,1002,3,380,4243,8320],
  [1,"farm",10,43.97,185,164,123,0,863,1002,3,195,4079,8197],
  [1,"storage",13,45.57,1007,840,672,0,908,1175,3,718,5580,10650],
  [1,"storage",14,46.63,1274,1062,850,0,944,1175,3,589,6323,11082],
  [1,"farm",11,48.02,216,192,144,0,1009,1175,3,468,7399,11615],
  [1,"farm",12,49.58,253,225,169,0,1122,1175,3,405,9482,14234],
  [1,"storage",15,49.83,1612,1343,1075,0,1124,1377,3,1001,10364,15364],
  [1,"storage",16,51.97,2039,1700,1360,0,1271,1614,3,2027,14475,16677],
  [1,"storage",17,53.37,2580,2150,1720,0,1271,1614,3,5362,16037,16417],
  [1,"storage",18,56.2,3264,2720,2176,0,1271,1614,3,16495,19607,20101],
  [1,"storage",19,58.45,4128,3440,2752,0,1271,1614,3,23288,23976,24614],
  [1,"stone",13,62.3,1144,880,704,28,1299,1614,3,32529,32793,32919],
  [1,"wood",16,64.15,1421,1705,1137,43,1342,1614,3,39796,39512,40080],
  [1,"iron",11,65.77,710,615,662,35,1377,1614,3,40657,40752,40655],
  [1,"farm",13,67.3,296,263,197,0,1377,1614,3,46309,46338,46154],
  [1,"farm",14,67.33,346,308,231,0,1377,1614,3,46122,46186,46028],
  [1,"wood",17,69.75,1776,2132,1421,50,1427,1893,3,48899,48543,49254],
  [1,"stone",14,70.28,1453,1118,894,33,1460,2219,3,49222,49557,49781],
  [1,"iron",12,72.5,889,770,829,40,1500,2219,3,49786,49905,49846],
  [1,"iron",13,73.57,1113,964,1038,46,1546,2219,3,49562,49711,49637],
  [1,"wood",18,74.35,2220,2665,1776,58,1604,2219,3,48455,48010,48899],
  [1,"stone",15,75.78,1846,1420,1136,38,1642,2219,3,48829,49255,49539],
  [1,"wood",19,78.43,2776,3331,2220,67,1709,2219,3,47899,47344,48455],
  [1,"iron",14,78.92,1393,1207,1300,52,1761,2219,3,49282,49116,49375],
  [1,"wood",20,81.57,3469,4163,2776,77,1838,2219,3,47206,46512,47899],
  [1,"stone",16,83.92,2344,1803,1442,43,1881,2219,3,48331,48872,49233],
  [1,"iron",15,87.1,1744,1511,1628,59,1940,2219,3,48931,49164,49047],
  [1,"farm",15,88.15,405,360,270,0,1940,2219,3,50270,50315,50405],
  [1,"farm",16,90.28,474,422,316,0,1940,2219,3,50201,50253,50359],
  [1,"stone",17,91.68,2977,2290,1832,50,1990,2602,3,47698,48385,48843],
  [1,"iron",16,94.52,2183,1892,2038,67,2057,3050,3,48492,48783,48637],
  [1,"iron",17,95.5,2734,2369,2551,76,2133,3050,3,47941,48306,48124],
  [1,"stone",18,98.33,3781,2908,2327,58,2191,3050,3,46894,47767,48348],
  [1,"stone",19,100.07,4802,3693,2955,67,2258,3050,3,45873,46982,47720],
  [1,"iron",18,102.9,3422,2966,3194,86,2344,3050,3,47253,47709,47481],
  [1,"iron",19,105.55,4285,3714,3999,98,2442,3050,3,46390,46961,46676],
  [1,"stone",20,108.38,6098,4691,3753,77,2519,3050,3,44577,45984,46922],
  [1,"iron",20,112.13,5365,4649,5007,111,2630,3050,3,45310,46026,45668],
  [1,"farm",17,114.97,555,493,370,0,2630,3050,3,50120,50182,50305],
  [1,"farm",18,120.03,649,577,433,0,2630,3050,3,50026,50098,50242],
  [1,"market",1,120.05,100,100,100,10,2640,3576,3,50085,50157,50251],
  [1,"market",2,120.68,126,126,126,12,2652,3576,3,50549,50549,50549],
  [1,"main",5,121.43,227,202,176,9,2661,3576,3,50448,50473,50499],
  [1,"smith",1,121.87,220,180,240,20,2681,3576,3,50455,50495,50435],
  [1,"smith",2,123.18,277,227,302,23,2704,3576,3,50398,50448,50373],
  [1,"smith",3,124.77,349,286,381,27,2731,3576,3,50326,50389,50294],
  [1,"smith",4,126.13,440,360,480,32,2763,4192,3,50235,50315,50195],
  [1,"smith",5,126.65,555,454,605,37,2800,4192,3,50120,50221,50070],
  [1,"smith",6,128.4,699,572,762,44,2844,4192,3,49976,50103,49913],
  [1,"market",3,129.37,159,159,159,14,2858,4192,3,50516,50516,50516],
  [1,"main",6,130.22,286,254,222,11,2869,4192,3,50389,50421,50453],
  [1,"smith",7,130.72,880,720,960,51,2920,4192,3,49795,49955,49715],
  [1,"main",7,131.65,360,320,280,13,2933,4192,3,50315,50355,50395],
  [1,"smith",8,132.22,1109,908,1210,60,2993,4192,3,49566,49767,49465],
  [1,"market",4,134.43,200,200,200,16,3009,4192,3,50475,50475,50475],
  [1,"main",8,135.37,454,403,353,15,3024,4192,3,50221,50272,50322],
  [1,"smith",9,136.02,1398,1144,1525,70,3094,4192,3,49277,49531,49150],
  [1,"main",9,136.47,572,508,445,18,3112,4192,3,50103,50167,50230],
  [1,"smith",10,137.2,1761,1441,1921,82,3194,4192,3,48914,49234,48754],
  [1,"market",5,140.88,252,252,252,19,3213,4192,3,50423,50423,50423],
  [1,"main",10,141.9,720,640,560,21,3234,4192,3,49955,50035,50115],
  [1,"smith",11,142.73,2219,1815,2421,96,3330,4192,3,48456,48860,48254],
  [1,"main",11,142.75,908,807,706,24,3354,4192,3,47707,48212,47657],
  [1,"smith",12,143.72,2796,2287,3050,112,3466,4192,3,47879,48388,47625],
  [1,"market",6,149.08,318,318,318,22,3488,4192,3,50357,50357,50357],
  [1,"main",12,150.18,1144,1017,890,28,3516,4192,3,49531,49658,49785],
  [1,"main",13,150.97,1441,1281,1121,33,3549,4192,3,49234,49394,49554],
  [1,"main",14,151.28,1816,1614,1412,38,3587,4192,3,47736,48098,48410],
  [1,"farm",19,152.28,760,675,506,0,3587,4192,3,49915,50000,50169],
  [1,"farm",20,152.78,889,790,592,0,3587,4192,3,49786,49885,50083],
  [1,"smith",13,157.0,3523,2882,3843,132,3719,4914,3,47152,47793,46832],
  [1,"smith",14,158.17,4439,3632,4842,154,3873,5760,3,46236,47043,45833],
  [1,"market",7,164.52,400,400,400,26,3899,5760,3,50275,50275,50275],
  [1,"smith",15,165.65,5593,4576,6101,180,4079,5760,3,45082,46099,44574],
  [1,"main",15,167.18,2288,2034,1779,45,4124,5760,3,48387,48641,48896],
  [1,"smith",16,168.82,7047,5765,7687,211,4335,5760,3,43628,44910,42988],
  [1,"market",8,176.47,504,504,504,30,4365,5760,3,50171,50171,50171],
  [1,"main",16,177.77,2883,2562,2242,53,4418,5760,3,47792,48113,48433],
  [1,"smith",17,179.63,8879,7264,9686,247,4665,5760,3,41796,43411,40989],
  [1,"main",17,181.18,3632,3229,2825,62,4727,5760,3,44552,46570,44502],
  [1,"smith",18,183.32,11187,9153,12204,289,5016,5760,3,39488,41522,38471],
  [1,"farm",21,193.75,1040,924,693,0,5016,5760,3,49635,49751,49982],
  [1,"market",9,199.33,635,635,635,35,5051,6752,3,50040,50040,50040],
  [1,"market",10,199.45,800,800,800,41,5092,6752,3,49875,49875,49875],
  [1,"main",18,200.75,4577,4068,3560,72,5164,6752,3,46098,46607,47115],
  [1,"main",19,201.15,5767,5126,4485,84,5248,6752,3,43401,44551,45650],
  [1,"main",20,203.18,7266,6458,5651,99,5347,6752,3,43409,44217,45024],
  [1,"smith",19,204.07,14096,11533,15377,338,5685,6752,3,35348,38719,35298],
  [1,"smith",20,206.52,17761,14532,19375,395,6080,6752,3,32577,36143,30863],
  [1,"farm",22,221.63,1217,1081,811,0,6080,6752,3,49458,49594,49864],
  [1,"snob",1,226.6,15000,25000,10000,80,6160,6752,3,35675,25675,40675]
  ];
  // column indices
  var T_TYPE=0,T_B=1,T_LV=2,T_AT=3,T_CW=4,T_CS=5,T_CI=6,T_CP=7,T_PU=8,T_PC=9,T_TIER=10,T_EW=11,T_ES=12,T_EI=13;

  var LEVEL_REWARD = { wood:150, stone:150, iron:100 };
  var SPEAR_GOAL = 150;
  // FARM-vs-SCAVENGE crossover (from the rate math): on a raid-capped, scavenge-
  // uncapped world, farming a barb beats scavenging the SAME troops ONLY within
  // ~2 fields (spears, full haul ≈2.3, half ≈1.2). Beyond that, those troops
  // earn MORE scavenging — farming further is a net efficiency LOSS. So the
  // perfect policy is: only flag point-blank barbs; scavenge everything else.
  var FARM_CROSSOVER_FIELDS = 2.0;
  var SCAV_LOOT = {1:0.10,2:0.25,3:0.50,4:0.75};
  var DUR_EXP=0.45, DUR_INITIAL=1800.0, DUR_FACTOR=0.7722074896557402;
  var CARRY={spear:25,sword:15,axe:10,archer:10,light:80,marcher:50,heavy:50,spy:0,ram:0,catapult:0,knight:100};

  var BLABEL = {
    main:"Hauptgebäude", place:"Versammlungsplatz", barracks:"Kaserne",
    smith:"Schmiede", market:"Marktplatz", wood:"Holzfäller", stone:"Lehmgrube",
    iron:"Eisenmine", farm:"Bauernhof", storage:"Speicher", snob:"Adelshof",
    scavenge:"Raubzug"
  };
  function bscreen(b){ return b==="place"||b==="scavenge" ? "place" : "main"; }

  // ── live state (read-only) ───────────────────────────────────────────────
  function vidParam(){ return (GD.village&&GD.village.id)||""; }
  function liveRes(){
    var v=GD.village||{};
    // prefer freshly-fetched res (from the scavenge JSON) when available — it's
    // current as of the last 🔄; game_data only updates on its own AJAX tick.
    var f=W.__twnl_res;
    return { wood:f?f.wood:Math.floor(v.wood||0),
             stone:f?f.stone:Math.floor(v.stone||0),
             iron:f?f.iron:Math.floor(v.iron||0),
             cap:(f&&f.cap)?f.cap:(v.storage_max||0),
             pop:Math.floor(v.pop||0), popMax:Math.floor(v.pop_max||0) };
  }
  function liveLevels(){
    var b=(GD.village&&GD.village.buildings)||{}, o={};
    Object.keys(b).forEach(function(k){o[k]=parseInt(b[k],10)||0;});
    return o;
  }
  function scavTiers(){ return (typeof W.__twnl_scav==="number")?W.__twnl_scav:0; }
  function troopsHome(){ return (GD.village&&GD.village.unit_counts)||W.__twnl_troops||null; }

  // ── find current position in the timeline ────────────────────────────────
  // The current step = first TL row not yet satisfied by live levels/tiers.
  function currentIndex(lv){
    for (var i=0;i<TL.length;i++){
      var row=TL[i];
      if (row[T_TYPE]===0){ if (scavTiers()<row[T_LV]) return i; }
      else if ((lv[row[T_B]]||0)<row[T_LV]) return i;
    }
    return TL.length;
  }
  // next pending BUILD row (skip scav — own track)
  function nextBuildIdx(lv,from){
    for (var i=from;i<TL.length;i++) if (TL[i][T_TYPE]===1 && (lv[TL[i][T_B]]||0)<TL[i][T_LV]) return i;
    return -1;
  }

  // ── scavenge split (max loot/hour, exact TW math) ─────────────────────────
  function scavDuration(c,lf){ if(c<=0)return 1; var inner=c*(100*lf)*c*lf; return (Math.pow(inner,DUR_EXP)+DUR_INITIAL)*DUR_FACTOR; }
  function scavRate(c,lf){ return c<=0?0:(c*lf)/scavDuration(c,lf); }
  function optimalSplit(total,tiers){
    var b={}; tiers.forEach(function(t){b[t]=0;}); if(!tiers.length||total<=0)return b;
    var n=200, ch=total/n;
    for(var k=0;k<n;k++){ var bt=null,bg=-1;
      tiers.forEach(function(t){ var g=scavRate(b[t]+ch,SCAV_LOOT[t])-scavRate(b[t],SCAV_LOOT[t]); if(g>bg){bg=g;bt=t;} });
      if(bt===null)break; b[bt]+=ch; }
    return b;
  }

  // ── live FETCH (read-only) — ONE source of truth: the scavenge screen's
  // inline `var village = {...}` JSON. Verified live on de256 (see the bot's
  // _fetch_scavenge_state). It carries BOTH the per-tier lock state AND troops
  // home, so one fetch fixes scavenge-tier detection AND troop reading.
  //   options[id].is_locked === false  → that tier is unlocked
  //   unit_counts_home                  → troops currently home
  function fetchScavAndTroops(){
    return fetch("/game.php?village="+vidParam()+"&screen=place&mode=scavenge",
                 {credentials:"include"})
      .then(function(r){return r.text();})
      .then(function(h){
        // pull the inline village JSON: var village = {...};  The object has
        // NESTED braces (options/squad), so a non-greedy {...} stops too early.
        // Match up to the terminating "};" instead (verified against de256).
        var m=h.match(/var\s+village\s*=\s*(\{[\s\S]*?\});/);
        if(!m) return;
        var vdata; try{ vdata=JSON.parse(m[1]); }catch(e){ return; }

        // csrf token — needed to POST scavenge send_squads (same token the
        // game's own send button uses). Try the common embeds.
        var cm=h.match(/csrf_token\s*[:=]\s*['"]([a-f0-9]+)['"]/i)
            || h.match(/"csrf"\s*:\s*"([a-f0-9]+)"/i);
        if(cm) W.__twnl_csrf=cm[1];

        // troops home
        var home=vdata.unit_counts_home||vdata.unitCountsHome||null;
        if(home){ var t={}; Object.keys(home).forEach(function(u){t[u]=parseInt(home[u],10)||0;}); W.__twnl_troops=t; }

        // fresh resources + storage cap straight from this JSON (game_data can
        // lag between its AJAX ticks; this is current as of the fetch).
        if(vdata.res){ W.__twnl_res={ wood:Math.floor(+vdata.res.wood||0),
          stone:Math.floor(+vdata.res.stone||0), iron:Math.floor(+vdata.res.iron||0),
          cap:+vdata.storage_max||0 }; }

        // scavenge tiers: count options whose is_locked is false. (ids 1..4)
        var opts=vdata.options||{};
        var unlocked=0;
        Object.keys(opts).forEach(function(k){
          var o=opts[k]; if(o && (o.is_locked===false || o.is_locked==="false")) unlocked++;
        });
        // tiers are sequential, so the unlocked COUNT is the highest tier.
        W.__twnl_scav=unlocked;

        // bonus: note which tiers have a squad OUT (so we don't tell you to
        // re-send a busy tier). store as a set of busy tier ids.
        var busy={};
        Object.keys(opts).forEach(function(k){
          var o=opts[k]; if(o && o.scavenging_squad) busy[k]=true;
        });
        W.__twnl_scav_busy=busy;
      }).catch(function(){});
  }

  // Read the live BUILD QUEUE depth from the main screen (read-only). Verified
  // de256 markup: each active+queued build has a `buildorder_<slug>` class once;
  // the count = slots used. TW gives 2 slots, so free = 2 - used. (game_data
  // alone doesn't carry the queue — the bot read it off this screen too.)
  function fetchQueue(){
    return fetch("/game.php?village="+vidParam()+"&screen=main",{credentials:"include"})
      .then(function(r){return r.text();})
      .then(function(h){
        // Count `buildorder_<slug>` classes — one per active+queued build. Works
        // across desktop + app skins (the class is in both). Scope to the queue
        // table when present, else scan the whole page (the class only appears
        // in the queue, so a global scan is safe).
        var qm=h.match(/<table[^>]*id="build_queue"[^>]*>([\s\S]*?)<\/table>/i)
            || h.match(/<tbody[^>]*id="buildqueue"[^>]*>([\s\S]*?)<\/tbody>/i);
        var scope=qm?qm[1]:h;
        var used=0, queued=[], mm, re=/buildorder_([a-z_]+)/gi;
        while((mm=re.exec(scope))){ queued.push(mm[1].toLowerCase()); }
        used=queued.length;
        W.__twnl_qused=used; W.__twnl_qbuilds=queued;
      }).catch(function(){});
  }
  function queueUsed(){ return (typeof W.__twnl_qused==="number")?W.__twnl_qused:null; }
  var BUILD_SLOTS=2;  // non-premium TW

  // Find POINT-BLANK barbs (owner 0) within the farm-vs-scavenge crossover —
  // the only barbs the math says are worth farming over scavenging. Reads the
  // public village.txt (same read-only source as tw_conquer.js). Caches the
  // nearby barb list on W.__twnl_barbs = [{x,y,dist}], nearest first.
  function fetchBarbs(){
    var v=GD.village||{}; var mx=+v.x, my=+v.y;
    if(!mx||!my) return Promise.resolve();
    return fetch(location.protocol+"//"+location.host+"/map/village.txt",{credentials:"include"})
      .then(function(r){return r.text();})
      .then(function(txt){
        var near=[]; var lines=txt.split("\n");
        for(var i=0;i<lines.length;i++){
          var p=lines[i].split(",");
          if(p.length<5) continue;
          if(p[4]!=="0") continue;                 // owner 0 = barbarian
          var bx=+p[2], by=+p[3];
          var d=Math.sqrt((bx-mx)*(bx-mx)+(by-my)*(by-my));
          if(d<=FARM_CROSSOVER_FIELDS+0.5){ near.push({x:bx,y:by,dist:d,id:p[0]}); }
        }
        near.sort(function(a,b){return a.dist-b.dist;});
        W.__twnl_barbs=near;
      }).catch(function(){});
  }

  // ── PANEL ────────────────────────────────────────────────────────────────
  function render(){
    var r=liveRes(), lv=liveLevels(), th=troopsHome();
    var idx=currentIndex(lv);
    var done=idx>=TL.length;

    var old=document.getElementById("twnl"); if(old) old.remove();
    var p=document.createElement("div"); p.id="twnl";
    p.style.cssText=["position:fixed","z-index:2147483647",
      "bottom:calc(10px + env(safe-area-inset-bottom,0px))","left:8px","width:252px",
      "background:#f4e4bc","border:2px solid #804000","border-radius:8px",
      "font:12px/1.35 Verdana,Arial,sans-serif","color:#000",
      "box-shadow:0 3px 12px rgba(0,0,0,.45)","padding:8px","max-height:82vh","overflow:auto"].join(";");

    var head=document.createElement("div");
    head.style.cssText="font-weight:bold;display:flex;justify-content:space-between;align-items:center;margin-bottom:4px";
    head.innerHTML="<span>👑 Noble Guide</span>";
    var ctl=document.createElement("span"); ctl.style.cssText="display:flex;gap:8px;align-items:center";
    ctl.innerHTML="<span style='opacity:.6;font-weight:normal'>"+Math.round(100*idx/TL.length)+"%</span>";
    // prominent header refresh — re-pull EVERYTHING (res/levels via game_data +
    // scavenge/troops/queue via fetch) then re-render.
    var rfh=document.createElement("span"); rfh.textContent="🔄";
    rfh.title="refresh all live data";
    rfh.style.cssText="cursor:pointer;font-size:14px";
    rfh.onclick=function(){ rfh.textContent="⏳"; softRefresh().then(function(){ /* render() inside softRefresh repaints */ }); };
    ctl.appendChild(rfh);
    var x=document.createElement("span"); x.textContent="✕"; x.style.cssText="cursor:pointer;padding:0 3px";
    x.onclick=function(){p.remove();}; ctl.appendChild(x);
    head.appendChild(ctl); p.appendChild(head);

    // resources + the timeline's expectation at this step (the CHECK)
    var rl=document.createElement("div"); rl.style.cssText="font-size:10px;opacity:.75;margin-bottom:4px";
    rl.innerHTML="🪵"+r.wood+" 🧱"+r.stone+" ⚙️"+r.iron+" · pop "+r.pop+"/"+r.popMax;
    p.appendChild(rl);

    if (!done){
      var cur=TL[idx];
      // CHECK: compare live res to this step's expected on-hand resources
      var chk=document.createElement("div");
      chk.style.cssText="font-size:10px;margin-bottom:5px;padding:4px;border-radius:4px;background:#fff;border:1px solid #ddd";
      var dW=r.wood-cur[T_EW], dS=r.stone-cur[T_ES], dI=r.iron-cur[T_EI];
      function tag(d){ return d>=-100?"✓":(d< -1000?"⚠⚠":"⚠"); }
      var behind=[]; if(dW< -500)behind.push("wood"); if(dS< -500)behind.push("clay"); if(dI< -500)behind.push("iron");
      chk.innerHTML="<b>plan check</b> (vs +"+cur[T_AT]+"h):<br>"+
        "wood "+tag(dW)+" clay "+tag(dS)+" iron "+tag(dI)+
        (behind.length?"<br><span style='color:#b00'>behind on "+behind.join(", ")+" → scavenge more / wait</span>"
                       :"<br><span style='color:#2a8'>on track ✓</span>");
      p.appendChild(chk);
    }

    var hdr=document.createElement("div"); hdr.style.cssText="font-size:10px;font-weight:bold;opacity:.6;margin:2px 0 4px";
    hdr.textContent="DO ALL IN PARALLEL ↓"; p.appendChild(hdr);
    function card(bg,br){ var d=document.createElement("div");
      d.style.cssText="background:"+bg+";border:1px solid "+br+";border-radius:6px;padding:6px;margin-bottom:5px"; return d; }
    function afford(cw,cs,ci){ return r.wood>=cw&&r.stone>=cs&&r.iron>=ci; }
    function waitMin(cw,cs,ci){ var v=GD.village||{};
      var pw=(v.wood_prod||0)*3600, ps=(v.stone_prod||0)*3600, pi=(v.iron_prod||0)*3600;
      function nd(h,w,p){ return h>=w?0:(p<=0?Infinity:(w-h)/p*60); }
      return Math.ceil(Math.max(nd(r.wood,cw,pw),nd(r.stone,cs,ps),nd(r.iron,ci,pi))); }

    // ── 1. BUILD track ── TW has 2 build slots, so show the next TWO plan
    // builds (slot 1 + slot 2) and keep BOTH queued. The optimizer's timeline
    // already assumed 2 parallel slots, so filling both is what hits ~9.6d —
    // leaving slot 2 idle silently slows the whole rush.
    var used=queueUsed();                       // live queue depth (null if unread)
    var free=(used===null)?BUILD_SLOTS:Math.max(0,BUILD_SLOTS-used);
    var bc=card("#fff7e0","#c0a060");
    bc.innerHTML="<div style='font-size:10px;opacity:.6'>🏗️ BUILD — "+
      (used===null?"2 slots":(used+"/"+BUILD_SLOTS+" used, "+free+" free"))+
      (AUTO_BUILD?", tap to queue ⚠️":", tap to open")+"</div>";
    if (done){ bc.innerHTML+="✅ done — build Academy & mint coin."; }
    else if (free===0){ bc.innerHTML+="<span style='opacity:.7'>both slots busy — next: "+
      (function(){var bx=nextBuildIdx(lv,idx);return bx<0?"—":(BLABEL[TL[bx][T_B]]||TL[bx][T_B])+" "+TL[bx][T_LV];})()+"</span>"; }
    else {
      // collect the next `free` distinct pending builds (skip scav rows)
      var picks=[]; var fromI=idx;
      for (var sN=0; sN<free; sN++){
        var bidx=nextBuildIdx(lv,fromI);
        // skip past any earlier picks of the same building+level
        while (bidx>=0 && picks.some(function(pp){return pp.idx===bidx;})) bidx=nextBuildIdx(lv,bidx+1);
        if (bidx<0) break;
        picks.push({idx:bidx, row:TL[bidx]});
        fromI=bidx+1;
      }
      // running resource claim so slot 2's affordability accounts for slot 1
      var rem={wood:r.wood,stone:r.stone,iron:r.iron}, popRem=r.popMax-r.pop;
      picks.forEach(function(pk,si){
        var row=pk.row, b=row[T_B], lvl=row[T_LV];
        var cw=row[T_CW],cs=row[T_CS],ci=row[T_CI],cp=row[T_CP];
        var popBlock=(b!=="farm"&&cp&&(cp>popRem));
        var ok=(rem.wood>=cw&&rem.stone>=cs&&rem.iron>=ci);
        if(ok&&!popBlock){ rem.wood-=cw; rem.stone-=cs; rem.iron-=ci; popRem-=cp; }
        var rowDiv=document.createElement("div");
        rowDiv.style.cssText="padding:4px 0;border-top:"+(si?"1px dotted #cb9":"none")+";cursor:pointer";
        rowDiv.innerHTML="<b>slot "+(si+1)+": "+(BLABEL[b]||b)+" → "+lvl+"</b> "+
          (popBlock?"<span style='color:#b00'>⚠ pop-cap</span>"
            : ok?"<span style='color:#2a8'>✓ now</span>"
            : "<span style='opacity:.7'>⏳ ~"+waitMin(cw,cs,ci)+"min</span>")+
          "<div style='font-size:10px;opacity:.6'>cost "+cw+"/"+cs+"/"+ci+
            " · refund +"+LEVEL_REWARD.wood+"/"+LEVEL_REWARD.stone+"/"+LEVEL_REWARD.iron+"</div>";
        rowDiv.onclick=function(){ doBuild(b,lvl); };
        bc.appendChild(rowDiv);
      });
      // one-tap "queue both" when both are affordable now
      if (AUTO_BUILD && picks.length>=2){
        var both=document.createElement("div");
        both.style.cssText="margin-top:4px;text-align:center;padding:3px;background:#c0a060;border-radius:4px;cursor:pointer;font-weight:bold";
        both.textContent="⚡ queue both slots";
        both.onclick=function(){
          doBuild(picks[0].row[T_B],picks[0].row[T_LV]);
          // small stagger so the second scrape sees the first already queued
          setTimeout(function(){ doBuild(picks[1].row[T_B],picks[1].row[T_LV]); }, 900);
        };
        bc.appendChild(both);
      }
    }
    p.appendChild(bc);

    // ── 2. SCAVENGE-UNLOCK track ──
    var nextTier=null;
    for (var ti=idx; ti<TL.length; ti++){ if(TL[ti][T_TYPE]===0 && scavTiers()<TL[ti][T_LV]){ nextTier=TL[ti]; break; } }
    if (nextTier){
      var uc=card("#eef0ff","#9aa6e0"); var ok2=afford(nextTier[T_CW],nextTier[T_CS],nextTier[T_CI]);
      uc.innerHTML="<div style='font-size:10px;opacity:.6'>🔓 SCAVENGE UNLOCK (parallel)</div>"+
        "<b>Unlock tier "+nextTier[T_LV]+"</b> "+(ok2?"<span style='color:#2a8'>✓ now</span>":"<span style='opacity:.7'>save "+nextTier[T_CW]+"/"+nextTier[T_CS]+"/"+nextTier[T_CI]+"</span>");
      var ua=document.createElement("a"); ua.href="/game.php?village="+vidParam()+"&screen=place&mode=scavenge";
      ua.textContent=" → open"; ua.style.cssText="font-size:11px;color:#36c"; uc.appendChild(ua);
      p.appendChild(uc);
    }

    // ── 3. SCAVENGE-SEND track (free) ──
    var sc=card("#eaf3e0","#9bbf7a"); var tiers=[]; for(var t=1;t<=scavTiers();t++)tiers.push(t);
    if(!tiers.length){ sc.innerHTML="<div style='font-size:10px;opacity:.6'>⛏️ SCAVENGE</div>No tiers yet."; }
    else if(!th){ sc.innerHTML="<div style='font-size:10px;opacity:.6'>⛏️ SCAVENGE</div>Reading troops… tap 🔄."; }
    else {
      var carry=0; Object.keys(th).forEach(function(u){carry+=(th[u]||0)*(CARRY[u]||0);});
      var split=optimalSplit(carry,tiers), L=["<div style='font-size:10px;opacity:.6'>⛏️ SCAVENGE — send (free, max loot/h)</div>"], lph=0;
      tiers.slice().reverse().forEach(function(t){ var c=Math.round(split[t]); if(c<=0)return;
        lph+=scavRate(c,SCAV_LOOT[t])*3600; L.push("• T"+t+": ~"+c+" carry ("+Math.round(scavDuration(c,SCAV_LOOT[t])/60)+"min)"); });
      L.push("<span style='opacity:.6'>≈ "+Math.round(lph)+" res/h</span>"); sc.innerHTML=L.join("<br>");
      var anyOut=Object.keys(W.__twnl_scav_busy||{}).length>0;
      if(AUTO_BUILD){
        var send=document.createElement("div");
        send.style.cssText="margin-top:4px;text-align:center;padding:3px;background:#9bbf7a;border-radius:4px;cursor:pointer;font-weight:bold";
        send.textContent=anyOut?"⚡ send free tiers":"⚡ send optimal split";
        send.onclick=function(){ doSendScavenge(); };
        sc.appendChild(send);
      }
      var sa=document.createElement("a"); sa.href="/game.php?village="+vidParam()+"&screen=place&mode=scavenge";
      sa.textContent="→ open Raubzug"; sa.style.cssText="display:inline-block;margin-top:3px;font-size:11px;color:#36c"; sc.appendChild(sa);
    }
    p.appendChild(sc);

    // ── 4. TROOPS track ── (trains in-panel; doesn't gate the noble)
    if((lv.barracks||0)>=1){
      var spN=(th&&th.spear)||0, tc=card("#f6ece0","#caa882");
      var popFull=r.pop>=r.popMax;
      // how many spears we could afford right now (spear = 50/30/10, 1 pop)
      var canAfford=Math.min(Math.floor(r.wood/50),Math.floor(r.stone/30),Math.floor(r.iron/10),
                             r.popMax-r.pop, SPEAR_GOAL-spN);
      tc.innerHTML="<div style='font-size:10px;opacity:.6'>⚔️ TROOPS (surplus only, goal ~"+SPEAR_GOAL+")</div>"+
        "have "+spN+" spears — "+(spN>=SPEAR_GOAL?"<span style='color:#2a8'>enough ✓</span>"
          : popFull?"<span style='color:#b00'>pop full</span>"
          : "<span style='opacity:.75'>"+(canAfford>0?"can train ~"+canAfford+" now":"save for build first")+"</span>");
      if(spN<SPEAR_GOAL && !popFull && canAfford>0){
        // small batch buttons so you trickle from surplus, not dump everything
        [Math.min(5,canAfford), Math.min(20,canAfford), canAfford].forEach(function(n,i){
          if(n<=0) return; if(i>0 && n<=Math.min(5,canAfford)) return;  // dedupe tiny
          var btn=document.createElement("span"); btn.textContent="+"+n;
          btn.style.cssText="display:inline-block;margin:3px 3px 0 0;padding:2px 7px;border:1px solid #a87;border-radius:4px;background:#fff;cursor:pointer;font-size:11px";
          btn.onclick=function(){ doTrainSpears(n); };
          tc.appendChild(btn);
        });
      }
      p.appendChild(tc);
    }

    // ── 5. FARM track (point-blank barbs only — the math: farming beats
    // scavenging ONLY within ~2 fields; everything else earns more scavenging).
    var barbs=W.__twnl_barbs;
    if(barbs && barbs.length && (lv.barracks||0)>=1 && (th&&(th.spear||th.axe||th.sword))){
      var fc=card("#f3e8e8","#c89");
      var L2=["<div style='font-size:10px;opacity:.6'>🐺 FARM — point-blank barbs (beat scavenge)</div>"];
      barbs.slice(0,4).forEach(function(bb){
        L2.push("• "+bb.x+"|"+bb.y+" ("+bb.dist.toFixed(1)+" fields)");
      });
      L2.push("<span style='font-size:10px;opacity:.6'>only these are worth farming; scavenge the rest</span>");
      fc.innerHTML=L2.join("<br>");
      var fa=document.createElement("a");
      fa.href="/game.php?village="+vidParam()+"&screen=place&target="+(barbs[0].id||"");
      fa.textContent="→ rally point (nearest)"; fa.style.cssText="display:inline-block;margin-top:3px;font-size:11px;color:#36c";
      fc.appendChild(fa);
      p.appendChild(fc);
    } else if (barbs && barbs.length===0 && (lv.barracks||0)>=1){
      var fc0=card("#f3e8e8","#c89");
      fc0.innerHTML="<div style='font-size:10px;opacity:.6'>🐺 FARM</div>"+
        "<span style='font-size:11px;opacity:.75'>no barbs within "+FARM_CROSSOVER_FIELDS+
        " fields — scavenging is more efficient than any farm from here.</span>";
      p.appendChild(fc0);
    }

    // refresh + tier sync
    var rf=document.createElement("span"); rf.textContent="🔄 refresh troops/scavenge";
    rf.style.cssText="display:inline-block;margin:2px 0;font-size:10px;color:#36c;cursor:pointer";
    rf.onclick=function(){ Promise.all([fetchScavAndTroops(),fetchQueue()]).then(render); }; p.appendChild(rf);

    var tg=document.createElement("div"); tg.style.cssText="font-size:10px;opacity:.7;margin-bottom:3px"; tg.innerHTML="tiers: ";
    [0,1,2,3].forEach(function(n){ var s=document.createElement("span"); s.textContent=n;
      s.style.cssText="cursor:pointer;padding:1px 5px;margin:0 1px;border:1px solid #999;border-radius:3px;"+(scavTiers()===n?"background:#804000;color:#fff":"background:#fff");
      s.onclick=function(){W.__twnl_scav=n;render();}; tg.appendChild(s); });
    p.appendChild(tg);

    var note=document.createElement("div"); note.style.cssText="font-size:9px;opacity:.5";
    note.textContent="Pre-planned (~9.6d to noble) + live check. "+(AUTO_BUILD?"⚠️ AUTO-BUILD ON.":"You tap the game's button.");
    p.appendChild(note);
    document.body.appendChild(p);
  }

  // toast: brief in-panel status message (no navigation, like Launchpad)
  function toast(msg, good){
    var el=document.getElementById("twnl_toast");
    if(!el){ el=document.createElement("div"); el.id="twnl_toast";
      el.style.cssText="margin:4px 0;padding:4px 6px;border-radius:4px;font-size:11px"; }
    el.style.background=good?"#d7e9c8":"#f6d3d3";
    el.style.color=good?"#2a6":"#a00"; el.textContent=msg;
    var p=document.getElementById("twnl"); if(p && !el.parentNode) p.insertBefore(el, p.children[2]||null);
  }

  // refresh just the live resource/level state from game_data WITHOUT reloading
  // the page. game_data updates on its own AJAX, but to be safe we also re-pull
  // the village JSON so res/levels reflect the action we just took.
  function softRefresh(){
    GD = W.game_data || GD;
    return Promise.all([fetchScavAndTroops(), fetchQueue(), fetchBarbs()]).then(function(){ render(); });
  }

  // BUILD — sends the upgrade in the background (no navigation, panel stays).
  function doBuild(b,lvl){
    var vid=vidParam();
    if(!AUTO_BUILD){ try{sessionStorage.setItem("twnl_flash",b);}catch(e){}
      W.location.href="/game.php?village="+vid+"&screen="+bscreen(b); return; }
    var mu="/game.php?village="+vid+"&screen=main";
    toast("building "+(BLABEL[b]||b)+" "+lvl+"…", true);
    fetch(mu,{credentials:"include"}).then(function(r){return r.text();}).then(function(h){
      // Robust upgrade-link finder (ported from the bot's _find_upgrade_links):
      // param ORDER varies between desktop and the app skin, so don't assume
      // action=...id=... order. Instead scan ALL action=upgrade* hrefs, parse
      // each href's id= param, and pick the one whose id matches this building.
      // Skip the +25% instant-build variants (type=premium/instant/kurzbau/buy).
      var BAD=/\b(premium|instant|kurzbau|kurzbauanleitung|buy)\b/i;
      var link=null, hm, hre=/href="([^"]*action=upgrade[^"]*)"/gi;
      while((hm=hre.exec(h))){
        var href=hm[1].replace(/&amp;/g,"&");
        var idm=href.match(/[?&]id=([a-z_]+)/i);
        var tym=href.match(/[?&]type=([a-z_]+)/i);
        if(!idm || idm[1].toLowerCase()!==b) continue;
        if(tym && BAD.test(tym[1])) continue;
        link=href; break;
      }
      if(!link){ toast("can't build "+(BLABEL[b]||b)+" now — no upgrade link (cost/prereq/queue full?)", false); return; }
      if(link.charAt(0)!=="/") link="/"+link.replace(/^.*game\.php/,"game.php");
      return fetch(link,{credentials:"include"}).then(function(){
        toast("✓ queued "+(BLABEL[b]||b)+" "+lvl, true);
        setTimeout(softRefresh, 500);   // re-read state, keep panel open
      });
    }).catch(function(e){ toast("build failed: "+e, false); });
  }

  // TRAIN spears in the background (no navigation). Scrapes the barracks recruit
  // form (action + hidden csrf inputs), sets spear=n, POSTs it. Same request the
  // game's own recruit button makes.
  function doTrainSpears(n){
    var vid=vidParam();
    var bu="/game.php?village="+vid+"&screen=barracks";
    if(!AUTO_BUILD){ W.location.href=bu; return; }
    toast("training "+n+" spears…", true);
    fetch(bu,{credentials:"include"}).then(function(r){return r.text();}).then(function(h){
      // find the recruit form (action contains train/recruit)
      var fm=h.match(/<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/gi), body=null, action=null;
      if(fm){ for(var i=0;i<fm.length;i++){
        var am=fm[i].match(/action="([^"]+)"/i); var act=am?am[1].replace(/&amp;/g,"&"):"";
        if(/train|recruit/i.test(act) && /name="spear"/i.test(fm[i])){ action=act; body=fm[i]; break; }
      }}
      if(!action){ toast("no recruit form (barracks built? botschutz?)", false); return; }
      // collect hidden inputs (csrf etc.) + set spear=n
      var data=new URLSearchParams(); var im, re=/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi;
      while((im=re.exec(body))){ data.set(im[1], im[2]); }
      data.set("spear", String(n));
      // zero the other units the form may carry so we only train spears
      ["sword","axe","archer","spy","light","heavy","marcher","ram","catapult"].forEach(function(u){
        if(new RegExp('name="'+u+'"').test(body)) data.set(u,"0"); });
      if(action.charAt(0)!=="/") action="/"+action.replace(/^.*game\.php/,"game.php");
      return fetch(action,{method:"POST",credentials:"include",
        headers:{"Content-Type":"application/x-www-form-urlencoded"},body:data.toString()})
        .then(function(){ toast("✓ queued "+n+" spears", true); setTimeout(softRefresh,500); });
    }).catch(function(e){ toast("train failed: "+e, false); });
  }
  // Pack actual home units into each tier's CARRY budget (heaviest-carry units
  // to the highest tiers first), turning the optimalSplit() carry numbers into
  // concrete unit_counts per tier. Returns [{option_id, unit_counts, carry}].
  function packSquads(th, tiers){
    var split=optimalSplit(
      (function(){var c=0;Object.keys(th).forEach(function(u){c+=(th[u]||0)*(CARRY[u]||0);});return c;})(),
      tiers);
    // pool of available units (carry-bearing only), heaviest carry first
    var pool={}; Object.keys(th).forEach(function(u){ if(CARRY[u]>0) pool[u]=th[u]||0; });
    var unitsByCarry=Object.keys(pool).sort(function(a,b){return CARRY[b]-CARRY[a];});
    // tiers sorted by carry budget desc (highest tier usually biggest)
    var order=tiers.slice().sort(function(a,b){return split[b]-split[a];});
    var out=[];
    order.forEach(function(t){
      var budget=split[t], counts={}, filled=0;
      unitsByCarry.forEach(function(u){
        if(pool[u]<=0) return;
        var room=Math.max(0,budget-filled);
        var n=Math.min(pool[u], Math.floor(room/CARRY[u]));
        if(n>0){ counts[u]=n; pool[u]-=n; filled+=n*CARRY[u]; }
      });
      if(filled>0) out.push({option_id:t, unit_counts:counts, carry:filled});
    });
    return out;
  }

  // AUTO-SEND the optimal scavenge split: builds the squad_requests payload and
  // POSTs send_squads (same request the game's send button makes). One tap
  // dispatches all home troops across the unlocked tiers at max loot/hour.
  function doSendScavenge(){
    var th=troopsHome(); var tiers=[]; for(var t=1;t<=scavTiers();t++)tiers.push(t);
    if(!th||!tiers.length){ toast("no troops/tiers to send", false); return; }
    var busy=W.__twnl_scav_busy||{};
    var sendTiers=tiers.filter(function(t){ return !busy[t]; });   // skip tiers already out
    if(!sendTiers.length){ toast("all tiers already scavenging", false); return; }
    var csrf=W.__twnl_csrf;
    if(!csrf){ toast("no csrf — tap 🔄 then retry", false); return; }
    var squads=packSquads(th, sendTiers).filter(function(s){return s.carry>0;});
    if(!squads.length){ toast("no troops home to send", false); return; }
    var vid=vidParam();
    var reqs=squads.map(function(s){ return {
      village_id:+vid, option_id:s.option_id, use_premium:false,
      candidate_squad:{ unit_counts:s.unit_counts, carry_max:Math.round(s.carry) }
    };});
    // jQuery $.param bracket encoding of {squad_requests:[...], h:csrf}
    var data=new URLSearchParams();
    reqs.forEach(function(rq,i){
      var pre="squad_requests["+i+"]";
      data.set(pre+"[village_id]", rq.village_id);
      data.set(pre+"[option_id]", rq.option_id);
      data.set(pre+"[use_premium]", "false");
      data.set(pre+"[candidate_squad][carry_max]", rq.candidate_squad.carry_max);
      Object.keys(rq.candidate_squad.unit_counts).forEach(function(u){
        data.set(pre+"[candidate_squad][unit_counts]["+u+"]", rq.candidate_squad.unit_counts[u]);
      });
    });
    data.set("h", csrf);
    toast("sending "+squads.length+" squad(s)…", true);
    fetch("/game.php?village="+vid+"&screen=scavenge_api&ajaxaction=send_squads",
      {method:"POST",credentials:"include",
       headers:{"X-Requested-With":"XMLHttpRequest","TribalWars-Ajax":"1",
                "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8",
                "Accept":"application/json, text/javascript, */*; q=0.01"},
       body:data.toString()})
      .then(function(r){return r.json();}).then(function(j){
        if(j && j.response!==false){ toast("✓ scavenge sent ("+squads.length+" tier"+(squads.length>1?"s":"")+")", true); setTimeout(softRefresh,600); }
        else { toast("scavenge rejected (troops/tier busy?)", false); }
      }).catch(function(e){ toast("scavenge send failed: "+e, false); });
  }

  function flash(){ var b; try{b=sessionStorage.getItem("twnl_flash");sessionStorage.removeItem("twnl_flash");}catch(e){}
    if(!b)return; var row=document.getElementById("main_buildrow_"+b); if(!row)return;
    var on=false,n=0,iv=setInterval(function(){row.style.background=(on=!on)?"#ffe08a":"";if(++n>6){clearInterval(iv);row.style.background="";}},350);
    row.scrollIntoView({block:"center"});
  }

  flash(); render();
  Promise.all([fetchScavAndTroops(), fetchQueue(), fetchBarbs()]).then(render);  // tiers+troops+queue+barbs
  console.log("[noble-guide] loaded, "+TL.length+" timeline steps");
})();
