/*
 * TW Noble Guide — RestedXP-style single-step guide  (Schnellleiste script)
 * ──────────────────────────────────────────────────────────────────────────
 * ONE linear, mathematically-optimal sequence (noble_optimizer.py) to your
 * first noble in ~9.6 days. The guide shows the SINGLE next action — build /
 * unlock-scavenge / recruit — and a button that does it. When done (auto-
 * detected from live state) the next step appears. Follow it without thinking.
 *
 * Scavenging is a CONTINUOUS background income (re-send every ~30min), not a
 * discrete step — so it lives in a small standing "keep scavenging" line with
 * the optimal-send button, separate from the linear sequence.
 *
 * Read-only except the build/recruit/scavenge POSTs (AUTO_BUILD). Each is the
 * same request the game's own button makes; works on desktop + app.
 *
 * Quickbar: javascript:$.getScript('https://fne-stack.github.io/DS-TEST/tw_noble_live.js?v='+Date.now());
 */
(function () {
  'use strict';
  var W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  var GD = W.game_data || {};
  var AUTO_BUILD = true;   // false = navigate-only (you tap the game's button)

  // ── LINEAR TIMELINE (noble_optimizer.py) ─────────────────────────────────
  // row = [type, name, level, at_h, cw,cs,ci,cpop, pop_used,pop_cap, tiers, ew,es,ei]
  //   type: 1=build · 0=scavenge-unlock · 2=recruit(spears to N)
  var TL = [
  [1,"place",1,0.0,10,40,30,0,0,240,0,490,460,470],
  [1,"main",1,0.0,90,80,70,5,5,240,0,400,380,400],
  [0,"scavenge",1,0.17,25,30,25,0,5,240,1,526,501,476],
  [0,"scavenge",2,0.17,250,300,250,0,5,240,2,276,201,226],
  [1,"main",2,0.17,113,101,88,6,11,240,2,163,100,138],
  [1,"hide",1,0.25,50,60,50,0,11,240,2,263,190,188],
  [1,"hide",2,0.27,62,75,62,0,11,240,2,351,265,226],
  [1,"wall",1,0.28,50,100,50,0,11,240,2,451,315,276],
  [1,"hide",3,0.35,78,94,78,0,11,240,2,524,372,299],
  [1,"wall",2,0.37,63,126,63,0,11,240,2,611,396,336],
  [1,"hide",4,0.43,98,117,98,0,11,240,2,663,429,338],
  [1,"storage",1,0.45,60,50,40,0,11,240,2,753,529,398],
  [1,"storage",2,0.47,76,63,51,0,11,240,2,827,616,447],
  [1,"main",3,0.78,143,127,111,7,18,240,2,836,641,438],
  [1,"main",4,0.83,180,160,140,8,26,240,2,806,631,398],
  [1,"barracks",1,1.12,200,170,90,7,33,240,2,758,613,410],
  [1,"barracks",2,1.23,252,214,113,8,41,240,2,656,549,397],
  [1,"wood",1,1.55,50,60,40,5,46,240,2,758,641,459],
  [1,"stone",1,1.73,65,50,40,5,51,240,2,844,742,520],
  [1,"iron",1,1.77,75,65,70,10,62,240,2,869,797,540],
  [1,"wood",2,1.95,62,75,50,6,72,240,2,762,753,551],
  [1,"wood",3,2.02,78,94,62,7,84,240,2,586,661,539],
  [1,"stone",2,2.2,83,64,51,6,91,240,2,609,722,584],
  [1,"stone",3,2.32,105,81,65,7,100,240,2,560,737,604],
  [1,"wood",4,2.45,98,117,78,8,109,240,2,568,744,620],
  [1,"wood",5,2.62,122,146,98,9,119,240,2,552,724,617],
  [1,"wood",6,2.82,153,183,122,10,130,240,2,535,696,618],
  [1,"stone",4,3.05,133,102,82,8,138,240,2,563,754,643],
  [1,"stone",5,3.33,169,130,104,9,149,240,2,493,759,661],
  [1,"iron",2,3.42,94,81,88,11,160,240,2,554,831,676],
  [1,"iron",3,3.72,118,102,110,13,174,240,2,555,863,665],
  [2,"recruit",20,3.72,0,0,0,0,175,240,2,505,833,655],
  [1,"stone",6,3.77,215,165,132,10,185,240,2,443,820,624],
  [1,"stone",7,4.08,273,210,168,12,197,240,2,376,813,603],
  [1,"iron",4,4.28,147,128,137,15,212,240,2,392,846,574],
  [1,"farm",1,4.7,45,40,30,0,212,240,2,565,1025,703],
  [1,"farm",2,4.72,53,47,35,0,213,240,2,613,1099,759],
  [1,"storage",3,4.98,96,80,64,0,216,281,2,576,1140,819],
  [1,"storage",4,5.05,121,101,81,0,217,330,2,559,1164,831],
  [1,"iron",5,5.38,184,160,172,17,236,330,2,494,1167,802],
  [1,"iron",6,5.53,231,200,215,19,255,330,2,423,1128,695],
  [1,"iron",7,5.9,289,250,270,21,276,330,2,362,1109,596],
  [1,"wood",7,6.15,191,229,153,12,288,330,2,337,1049,557],
  [1,"farm",3,6.65,62,55,41,0,288,330,2,513,1237,704],
  [1,"farm",4,6.77,72,64,48,0,288,330,2,598,1332,765],
  [1,"wood",8,7.05,238,286,191,14,305,386,2,438,1183,721],
  [1,"wood",9,7.25,298,358,238,16,321,453,2,304,990,598],
  [1,"wood",10,7.8,373,447,298,18,339,453,2,183,794,501],
  [1,"stone",8,8.15,346,266,213,14,353,453,2,79,766,476],
  [1,"wood",11,8.9,466,559,373,21,374,453,2,51,625,421],
  [1,"stone",9,10.18,440,338,271,16,390,453,2,99,735,533],
  [1,"farm",5,10.18,84,75,56,0,390,453,2,15,660,477],
  [1,"stone",10,11.17,559,430,344,18,408,531,2,15,741,530],
  [1,"wood",12,13.3,582,698,466,24,434,531,2,23,614,552],
  [2,"recruit",40,15.98,0,0,0,0,442,531,2,503,1178,1110],
  [1,"farm",6,17.58,99,88,66,0,452,531,2,413,1233,1319],
  [1,"farm",7,17.58,115,103,77,0,452,531,2,298,1130,1242],
  [2,"recruit",60,18.85,0,0,0,0,462,729,2,502,1482,1640],
  [1,"storage",5,19.7,154,128,102,0,467,729,2,476,1548,1795],
  [1,"storage",6,20.17,194,162,130,0,467,729,2,356,1440,1699],
  [2,"recruit",80,21.32,0,0,0,0,482,729,2,502,1839,2249],
  [1,"storage",7,22.9,246,205,164,0,493,729,2,464,1998,2600],
  [1,"storage",8,23.43,311,259,207,0,493,729,2,427,1991,2622],
  [2,"recruit",102,24.42,0,0,0,0,504,729,2,522,2266,2975],
  [1,"wood",13,24.5,728,873,582,28,532,729,2,3,1598,2595],
  [1,"iron",8,25.43,362,313,338,24,556,729,2,1,1607,2538],
  [1,"stone",11,26.63,709,546,437,21,585,729,2,27,1899,2951],
  [2,"recruit",123,28.25,0,0,0,0,598,729,2,512,2542,3748],
  [1,"storage",9,29.3,393,328,262,0,606,729,2,418,2623,4002],
  [1,"storage",10,29.83,498,415,332,0,606,729,2,291,2553,3989],
  [2,"recruit",144,30.92,0,0,0,0,619,729,2,536,3006,4598],
  [1,"farm",8,31.02,135,120,90,0,620,729,2,370,2870,4507],
  [1,"farm",9,31.25,158,140,105,0,620,729,2,405,2912,4522],
  [2,"recruit",150,31.57,0,0,0,0,625,729,2,502,3094,4788],
  [0,"scavenge",3,32.0,1000,1200,1000,0,625,855,3,34,2405,4228],
  [1,"wood",14,33.08,909,1091,728,33,658,1002,3,412,2549,4630],
  [1,"iron",9,33.32,453,392,423,28,686,1002,3,2,2189,4228],
  [1,"iron",10,34.38,567,491,529,31,717,1002,3,1031,3243,5140],
  [1,"storage",11,35.3,630,525,420,0,717,1002,3,1970,4243,6162],
  [1,"stone",12,35.67,901,693,554,24,741,1002,3,1297,3750,5745],
  [1,"storage",12,37.0,796,664,531,0,741,1002,3,2812,5292,7345],
  [1,"wood",15,37.2,1137,1364,909,38,779,1002,3,1868,4105,6559],
  [1,"stone",13,39.05,1144,880,704,28,807,1002,3,3769,6167,8671],
  [1,"wood",16,39.85,1421,1705,1137,43,850,1002,3,3295,5364,8353],
  [1,"storage",13,40.9,1007,840,672,0,850,1002,3,3949,6090,9154],
  [1,"storage",14,43.03,1274,1062,850,0,850,1002,3,5856,8070,11082],
  [1,"storage",15,43.35,1612,1343,1075,0,850,1002,3,5111,7561,10769],
  [1,"iron",11,45.98,710,615,662,35,885,1002,3,8437,10705,13640],
  [1,"farm",10,46.88,185,164,123,0,885,1002,3,9287,11482,14347],
  [1,"farm",11,47.52,216,192,144,0,885,1002,3,10654,12806,15628],
  [1,"wood",17,48.3,1776,2132,1421,50,935,1175,3,9879,11593,15038],
  [1,"stone",14,49.22,1453,1118,894,33,968,1377,3,10091,12044,15619],
  [1,"storage",16,51.43,2039,1700,1360,0,968,1377,3,11343,13402,17160],
  [1,"storage",17,52.12,2580,2150,1720,0,968,1377,3,9735,12173,16258],
  [1,"iron",12,55.67,889,770,829,40,1008,1377,3,14568,16688,20387],
  [1,"iron",13,57.2,1113,964,1038,46,1054,1377,3,15997,18077,21532],
  [1,"wood",18,57.52,2220,2665,1776,58,1112,1377,3,14033,15630,19900],
  [1,"stone",15,59.42,1846,1420,1136,38,1150,1377,3,15478,17266,21664],
  [1,"wood",19,62.07,2776,3331,2220,67,1217,1377,3,16870,17777,23156],
  [1,"farm",12,62.08,253,225,169,0,1217,1377,3,16772,17707,23090],
  [1,"iron",14,64.13,1393,1207,1300,52,1269,1614,3,18831,19660,24768],
  [1,"storage",18,66.78,3264,2720,2176,0,1269,1614,3,19878,20875,26304],
  [1,"storage",19,67.55,4128,3440,2752,0,1269,1614,3,16825,18401,24441],
  [1,"wood",20,72.88,3469,4163,2776,77,1346,1614,3,22182,21966,29157],
  [1,"stone",16,74.87,2344,1803,1442,43,1389,1614,3,23391,23307,30739],
  [1,"farm",13,78.05,296,263,197,0,1389,1614,3,28443,27736,35073],
  [1,"farm",14,79.47,346,308,231,0,1389,1614,3,30142,29238,36495],
  [1,"iron",15,80.5,1744,1511,1628,59,1448,1893,3,30345,29425,36439],
  [1,"stone",17,82.42,2977,2290,1832,50,1498,2219,3,31034,30339,37617],
  [1,"iron",16,83.68,2183,1892,2038,67,1565,2219,3,30923,30213,37200],
  [1,"iron",17,86.23,2734,2369,2551,76,1641,2219,3,32815,31856,38509],
  [1,"stone",18,87.5,3781,2908,2327,58,1699,2219,3,31730,31400,38472],
  [1,"stone",19,90.8,4802,3693,2955,67,1766,2219,3,32577,32719,40321],
  [1,"iron",18,92.07,3422,2966,3194,86,1852,2219,3,31227,31580,38904],
  [1,"iron",19,96.28,4285,3714,3999,98,1950,2219,3,34327,34665,41426],
  [1,"farm",15,97.55,405,360,270,0,1950,2219,3,35993,36281,42933],
  [1,"stone",20,101.08,6098,4691,3753,77,2027,2602,3,36293,37723,45036],
  [1,"iron",20,102.87,5365,4649,5007,111,2138,2602,3,33898,35910,42701],
  [1,"iron",21,107.67,6717,5821,6269,126,2264,2602,3,35500,38048,44341],
  [1,"farm",16,110.77,474,422,316,0,2264,2602,3,40569,43169,49286],
  [1,"market",1,115.0,100,100,100,10,2274,3050,3,47862,50463,50575],
  [1,"market",2,115.63,126,126,126,12,2286,3050,3,48847,50549,50549],
  [1,"main",5,116.38,227,202,176,9,2295,3050,3,50418,50473,50499],
  [1,"smith",1,116.82,220,180,240,20,2315,3050,3,50455,50495,50435],
  [1,"smith",2,117.13,277,227,302,23,2338,3050,3,50398,50448,50373],
  [1,"smith",3,118.13,349,286,381,27,2365,3050,3,50326,50389,50294],
  [1,"smith",4,118.72,440,360,480,32,2397,3050,3,50235,50315,50195],
  [1,"smith",5,120.02,555,454,605,37,2434,3050,3,50120,50221,50070],
  [1,"smith",6,120.98,699,572,762,44,2478,3050,3,49976,50103,49913],
  [1,"market",3,122.73,159,159,159,14,2492,3050,3,50516,50516,50516],
  [1,"main",6,123.58,286,254,222,11,2503,3050,3,50389,50421,50453],
  [1,"smith",7,124.08,880,720,960,51,2554,3050,3,49795,49955,49715],
  [1,"main",7,124.23,360,320,280,13,2567,3050,3,49665,49865,49627],
  [1,"smith",8,124.8,1109,908,1210,60,2627,3050,3,49566,49767,49465],
  [1,"farm",17,127.8,555,493,370,0,2627,3050,3,50120,50182,50305],
  [1,"farm",18,129.05,649,577,433,0,2627,3050,3,50026,50098,50242],
  [1,"market",4,132.18,200,200,200,16,2643,3576,3,50475,50475,50475],
  [1,"main",8,133.12,454,403,353,15,2658,3576,3,50221,50272,50322],
  [1,"main",9,133.77,572,508,445,18,2676,3576,3,50103,50167,50230],
  [1,"main",10,134.32,720,640,560,21,2697,4192,3,49955,50035,50115],
  [1,"smith",9,134.5,1398,1144,1525,70,2767,4192,3,49277,49531,49150],
  [1,"smith",10,135.2,1761,1441,1921,82,2849,4192,3,48662,49234,48385],
  [1,"market",5,139.13,252,252,252,19,2868,4192,3,50423,50423,50423],
  [1,"smith",11,140.1,2219,1815,2421,96,2964,4192,3,48456,48860,48254],
  [1,"main",11,140.48,908,807,706,24,2988,4192,3,48526,49031,48509],
  [1,"smith",12,141.45,2796,2287,3050,112,3100,4192,3,47643,48388,47405],
  [1,"market",6,146.45,318,318,318,22,3122,4192,3,50357,50357,50357],
  [1,"main",12,147.55,1144,1017,890,28,3150,4192,3,49531,49658,49785],
  [1,"smith",13,148.65,3523,2882,3843,132,3282,4192,3,47152,47793,46832],
  [1,"main",13,148.7,1441,1281,1121,33,3315,4192,3,45888,46689,45842],
  [1,"smith",14,149.95,4439,3632,4842,154,3469,4192,3,44136,45744,43745],
  [1,"market",7,156.93,400,400,400,26,3495,4192,3,50275,50275,50275],
  [1,"main",14,158.13,1816,1614,1412,38,3533,4192,3,48859,49061,49263],
  [1,"main",15,159.42,2288,2034,1779,45,3578,4192,3,48387,48641,48896],
  [1,"farm",19,159.57,760,675,506,0,3578,4192,3,48482,48821,49207],
  [1,"farm",20,161.13,889,790,592,0,3578,4192,3,49786,49885,50083],
  [1,"smith",15,164.05,5593,4576,6101,180,3758,4914,3,45082,46099,44574],
  [1,"smith",16,166.27,7047,5765,7687,211,3969,5760,3,41860,44159,40852],
  [1,"market",8,174.35,504,504,504,30,3999,5760,3,50171,50171,50171],
  [1,"main",16,175.65,2883,2562,2242,53,4052,5760,3,47792,48113,48433],
  [1,"smith",17,177.52,8879,7264,9686,247,4299,5760,3,41796,43411,40989],
  [1,"main",17,178.63,3632,3229,2825,62,4361,5760,3,40156,42174,40202],
  [1,"smith",18,180.77,11187,9153,12204,289,4650,5760,3,32750,36802,31912],
  [1,"market",9,191.63,635,635,635,35,4685,5760,3,50040,50040,50040],
  [1,"main",18,193.05,4577,4068,3560,72,4757,5760,3,46098,46607,47115],
  [1,"smith",19,195.48,14096,11533,15377,338,5095,5760,3,36567,39142,35298],
  [1,"farm",21,196.9,1040,924,693,0,5095,5760,3,38303,40994,37453],
  [1,"main",19,202.22,5767,5126,4485,84,5179,6752,3,41753,45086,42593],
  [1,"smith",20,204.98,17761,14532,19375,395,5574,6752,3,28734,35295,28147],
  [1,"market",10,213.93,800,800,800,41,5615,6752,3,43452,49875,43585],
  [1,"main",20,215.47,7266,6458,5651,99,5714,6752,3,38399,44217,40229],
  [1,"snob",1,226.07,15000,25000,10000,80,5794,6752,3,35675,25675,40675],
  [1,"farm",22,226.07,1217,1081,811,0,5794,6752,3,34458,24594,39864],
  [1,"farm",23,229.85,1423,1265,949,0,5794,6752,3,39565,29859,45721]
  ];
  var T_TYPE=0,T_B=1,T_LV=2,T_AT=3,T_CW=4,T_CS=5,T_CI=6,T_CP=7,T_PU=8,T_PC=9,T_TIER=10,T_EW=11,T_ES=12,T_EI=13;

  var NOBLE_H=229.9;
  var SCAV_LOOT={1:0.10,2:0.25,3:0.50,4:0.75};
  var DUR_EXP=0.45, DUR_INITIAL=1800.0, DUR_FACTOR=0.7722074896557402;
  var CARRY={spear:25,sword:15,axe:10,archer:10,light:80,marcher:50,heavy:50,spy:0,ram:0,catapult:0,knight:100};
  var BLABEL={main:"Hauptgebäude",place:"Versammlungsplatz",barracks:"Kaserne",smith:"Schmiede",
    market:"Marktplatz",wood:"Holzfäller",stone:"Lehmgrube",iron:"Eisenmine",farm:"Bauernhof",
    storage:"Speicher",snob:"Adelshof",hide:"Versteck",wall:"Wall"};

  // ── live state ────────────────────────────────────────────────────────────
  function vid(){ return (GD.village&&GD.village.id)||""; }
  function liveRes(){
    var v=GD.village||{}, f=W.__twnl_res;
    return { wood:f?f.wood:Math.floor(v.wood||0), stone:f?f.stone:Math.floor(v.stone||0),
             iron:f?f.iron:Math.floor(v.iron||0), pop:Math.floor(v.pop||0), popMax:Math.floor(v.pop_max||0) };
  }
  function liveLevels(){ var b=(GD.village&&GD.village.buildings)||{}, o={}; Object.keys(b).forEach(function(k){o[k]=parseInt(b[k],10)||0;}); return o; }
  function scavTiers(){ return (typeof W.__twnl_scav==="number")?W.__twnl_scav:0; }
  function troopsHome(){ return (GD.village&&GD.village.unit_counts)||W.__twnl_troops||null; }
  // TOTAL spears = home + out scavenging + IN-TRAINING. In-training comes from
  // two sources, whichever is higher: (a) the barracks-queue parse (fetchBarracksQ,
  // markup-dependent), and (b) an OPTIMISTIC local counter we bump the instant
  // YOU recruit (so the guide never double-asks even if the queue read fails).
  // The optimistic count is cleared once those spears show up home/out/queue.
  function totalSpears(){
    var q=W.__twnl_spear_q||0;                       // in barracks queue (training)
    // Prefer the authoritative "Insgesamt" total (all spears everywhere, home+
    // out) from the barracks page if we have it; else fall back to home+out from
    // the scavenge JSON. Then add the training queue.
    var owned=(typeof W.__twnl_spear_owned==="number")
      ? W.__twnl_spear_owned
      : ((troopsHome()||{}).spear||0)+((W.__twnl_scav_out||{}).spear||0);
    var real=owned+q;
    var tgt=W.__twnl_spear_target||0;               // optimistic: last recruit target
    // Hold at the recruited target until the real count catches up — so we never
    // re-ask while mid-train spears are invisible to the markup parser.
    return Math.max(real, tgt);
  }

  // The current step = first TL row not yet satisfied. A build counts as done
  // when finished OR sitting in the QUEUE (effective level = live + queued), so
  // the guide advances the moment you queue it, not when it completes. Manual
  // "skip" (W.__twng_force) floors the search past steps auto-detect can't see.
  function effLevel(lv,b){ return (lv[b]||0) + ((W.__twnl_qbuild||{})[b]||0); }
  function currentIndex(lv){
    var floor=W.__twng_force||0;
    for(var i=floor;i<TL.length;i++){
      var row=TL[i], typ=row[T_TYPE];
      if(typ===0){ if(scavTiers()<row[T_LV]) return i; }
      else if(typ===2){ if(totalSpears()<row[T_LV]) return i; }
      else { if(effLevel(lv,row[T_B])<row[T_LV]) return i; }
    }
    return TL.length;
  }

  // ── scavenge math ───────────────────────────────────────────────────────
  function scavDuration(c,lf){ if(c<=0)return 1; var inner=c*(100*lf)*c*lf; return (Math.pow(inner,DUR_EXP)+DUR_INITIAL)*DUR_FACTOR; }
  function scavRate(c,lf){ return c<=0?0:(c*lf)/scavDuration(c,lf); }
  function carryForDuration(sec,lf){ var x=sec/DUR_FACTOR-DUR_INITIAL; if(x<=0)return 0; return Math.sqrt(Math.pow(x,1/DUR_EXP)/(100*lf*lf)); }
  function carryForLoot(loot,lf){ return lf>0?loot/lf:0; }
  function optimalSplit(total,tiers){
    var b={}; tiers.forEach(function(t){b[t]=0;}); if(!tiers.length||total<=0)return b;
    var n=200, ch=total/n;
    for(var k=0;k<n;k++){ var bt=null,bg=-1;
      tiers.forEach(function(t){ var g=scavRate(b[t]+ch,SCAV_LOOT[t])-scavRate(b[t],SCAV_LOOT[t]); if(g>bg){bg=g;bt=t;} });
      if(bt===null)break; b[bt]+=ch; }
    return b;
  }
  function troopsForCarry(th,target){
    if(target<=0) return {};
    var pool={}; Object.keys(th).forEach(function(u){ if(CARRY[u]>0)pool[u]=th[u]||0; });
    var order=Object.keys(pool).sort(function(a,b){return CARRY[a]-CARRY[b];});
    var picked={}, got=0;
    order.forEach(function(u){ if(got>=target)return; var n=Math.min(pool[u],Math.ceil((target-got)/CARRY[u])); if(n>0){picked[u]=n;got+=n*CARRY[u];} });
    return picked;
  }
  function countdown(ts){ var s=Math.max(0,Math.round(ts-Date.now()/1000)),m=Math.floor(s/60),h=Math.floor(m/60); return h>0?h+"h"+(m%60)+"m":(m>0?m+"m"+(s%60)+"s":s+"s"); }

  // ── live fetch (read-only) ──────────────────────────────────────────────
  // Extract the inline `var village = {...}` object by BRACE-MATCHING (not a
  // non-greedy regex to the first "};", which truncates when a nested value
  // contains "};" — that bug hid tier 3/4 and made the guide think they were
  // still locked). Walk from the opening "{" counting braces (string-aware).
  function extractVillageJSON(h){
    var i=h.indexOf("var village"); if(i<0) return null;
    var s=h.indexOf("{", i); if(s<0) return null;
    var depth=0, instr=false, esc=false;
    for(var j=s;j<h.length;j++){
      var c=h[j];
      if(instr){ if(esc){esc=false;} else if(c==="\\"){esc=true;} else if(c==='"'){instr=false;} continue; }
      if(c==='"'){ instr=true; continue; }
      if(c==="{") depth++;
      else if(c==="}"){ depth--; if(depth===0) return h.slice(s, j+1); }
    }
    return null;
  }
  function fetchScav(){
    return fetch("/game.php?village="+vid()+"&screen=place&mode=scavenge",{credentials:"include"})
      .then(function(r){return r.text();}).then(function(h){
        var raw=extractVillageJSON(h); if(!raw) return;
        var d; try{ d=JSON.parse(raw); }catch(e){ return; }
        var cm=h.match(/csrf_token\s*[:=]\s*['"]([a-f0-9]+)['"]/i)||h.match(/"csrf"\s*:\s*"([a-f0-9]+)"/i); if(cm) W.__twnl_csrf=cm[1];
        var home=d.unit_counts_home||{}; var t={}; Object.keys(home).forEach(function(u){t[u]=parseInt(home[u],10)||0;}); if(Object.keys(t).length)W.__twnl_troops=t;
        if(d.res) W.__twnl_res={wood:Math.floor(+d.res.wood||0),stone:Math.floor(+d.res.stone||0),iron:Math.floor(+d.res.iron||0)};
        // A tier is UNLOCKED when is_locked is falsy (false / "false" / 0 / null).
        // Count the highest CONTIGUOUS unlocked tier (1,2,3,4) — tiers unlock in
        // order, and a mid-unlock tier (unlock_time set, still locked) does NOT
        // count yet. This is robust to is_locked being bool/string/number.
        var opts=d.options||{}, busy={}, ret={}, out={};
        function unlocked(o){ var L=o.is_locked; return !(L===true||L==="true"||L===1||L==="1"); }
        var n=0;
        for(var ti=1;ti<=4;ti++){ var o=opts[ti]||opts[String(ti)]; if(o&&unlocked(o)) n=ti; else break; }
        Object.keys(opts).forEach(function(k){ var o=opts[k]; if(!o)return;
          var sq=o.scavenging_squad; if(sq){ busy[k]=true; var rt=parseFloat(sq.return_time||0); if(rt>0)ret[k]=rt;
            var uc=sq.unit_counts||{}; Object.keys(uc).forEach(function(u){out[u]=(out[u]||0)+(parseInt(uc[u],10)||0);}); }
        });
        W.__twnl_scav=n; W.__twnl_scav_busy=busy; W.__twnl_scav_ret=ret; W.__twnl_scav_out=out;
      }).catch(function(){});
  }
  function fetchQueue(){
    return fetch("/game.php?village="+vid()+"&screen=main",{credentials:"include"})
      .then(function(r){return r.text();}).then(function(h){
        var cm=h.match(/csrf_token\s*[:=]\s*['"]([a-f0-9]+)['"]/i)||h.match(/"csrf"\s*:\s*"([a-f0-9]+)"/i)||h.match(/&h=([a-f0-9]+)/i); if(cm)W.__twnl_csrf=cm[1];
        var qm=h.match(/<table[^>]*id="build_queue"[^>]*>([\s\S]*?)<\/table>/i)||h.match(/<tbody[^>]*id="buildqueue"[^>]*>([\s\S]*?)<\/tbody>/i);
        // capture WHICH buildings are queued (count per slug) so the guide can
        // treat a queued-but-unfinished build as done — effective level =
        // live level + how many of that building sit in the queue. Without this
        // the step wouldn't advance until the build COMPLETES, leaving the guide
        // telling you to build something already queued.
        var scope=qm?qm[1]:h, used=0, qb={}, mm, re=/buildorder_([a-z_]+)/gi;
        while((mm=re.exec(scope))){ var slug=mm[1].toLowerCase(); qb[slug]=(qb[slug]||0)+1; used++; }
        W.__twnl_qused=used; W.__twnl_qbuild=qb;   // {slug: countInQueue}
      }).catch(function(){});
  }
  // Point-blank barbs (owner 0, within ~2 fields) — SUPPLEMENTARY income: farm
  // these with a SMALL spear pack ALONGSIDE the main scavenge run (the bulk army
  // scavenges; a handful hits the adjacent barb for ~80 free res, troops back in
  // minutes). Not farm-vs-scavenge — farm is the leftover-handful bonus.
  var FARM_FIELDS=2.0;
  function fetchBarbs(){
    var v=GD.village||{}, mx=+v.x, my=+v.y; if(!mx||!my) return Promise.resolve();
    return fetch(location.protocol+"//"+location.host+"/map/village.txt",{credentials:"include"})
      .then(function(r){return r.text();}).then(function(txt){
        var near=[], lines=txt.split("\n");
        for(var i=0;i<lines.length;i++){ var pp=lines[i].split(","); if(pp.length<5||pp[4]!=="0")continue;
          var d=Math.sqrt((+pp[2]-mx)*(+pp[2]-mx)+(+pp[3]-my)*(+pp[3]-my));
          if(d<=FARM_FIELDS+0.5) near.push({x:+pp[2],y:+pp[3],dist:d,id:pp[0]}); }
        near.sort(function(a,b){return a.dist-b.dist;}); W.__twnl_barbs=near;
      }).catch(function(){});
  }
  function fetchFarmTpl(){
    return fetch("/game.php?village="+vid()+"&screen=am_farm",{credentials:"include"})
      .then(function(r){return r.text();}).then(function(h){
        var su=h.match(/Accountmanager\.send_units_link\s*=\s*['"]([^'"]+)['"]/); if(su)W.__twnl_farm_sendurl=su[1].replace(/&amp;/g,"&");
        var tblM=h.match(/<table[^>]*class="[^"]*loot_assistant_templates[^"]*"[^>]*>([\s\S]*?)<\/table>/i), body=tblM?tblM[1]:h;
        var tpl={}, label=null, rowRe=/<tr([^>]*)>([\s\S]*?)<\/tr>/gi, rm;
        while((rm=rowRe.exec(body))){ var rb=rm[2], ic=rb.match(/farm_icon_([ab])/i);
          if(ic){ label=ic[1].toLowerCase(); continue; }
          if(label&&/name="(?:spear|sword|axe|spy|light|heavy|ram|catapult)\[\d+\]"/i.test(rb)){
            var idm=rb.match(/name="template\[(\d+)\]\[id\]"\s+value="(\d+)"/i), tid=idm?idm[2]:null;
            var units={}, um, ure=/name="(spear|sword|axe|archer|spy|light|heavy|marcher|ram|catapult)\[\d+\]"[^>]*value="(\d+)"/gi;
            while((um=ure.exec(rb)))units[um[1]]=parseInt(um[2],10)||0;
            if(tid)tpl[label]={id:tid,units:units}; label=null; } }
        if(Object.keys(tpl).length)W.__twnl_farm_tpl=tpl;
      }).catch(function(){});
  }
  // Count spears CURRENTLY TRAINING in the barracks queue, so totalSpears()
  // includes them and the recruit step doesn't double-ask. The train queue rows
  // carry a unit sprite + a count; we sum the spear rows. (Markup varies; we try
  // the common patterns and fall back to 0.)
  function fetchBarracksQ(){
    if((liveLevels().barracks||0)<1){ W.__twnl_spear_q=0; return Promise.resolve(); }
    return fetch("/game.php?village="+vid()+"&screen=barracks",{credentials:"include"})
      .then(function(r){return r.text();}).then(function(h){
        var q=0;
        // The training queue rows render as "<N> Speerträger" (verified from the
        // live de256 barracks screenshot). Sum every "<number> Speerträger" in
        // the training/Ausbildung area. We match the number + unit name directly.
        var re=/(\d+)\s*Speertr(?:ä|&auml;)ger/gi, m;
        while((m=re.exec(h))) q+=parseInt(m[1],10)||0;
        W.__twnl_spear_q=q;
        // ALSO grab the authoritative "Im Dorf/Insgesamt: 64/68" total — that's
        // ALL your spears everywhere (home + out), which sidesteps the home-vs-
        // out accounting. The spear recruit row shows ".../68" as the total. We
        // capture the second number of the "N/M" pair on the spear cost row.
        var tot=h.match(/Speertr(?:ä|&auml;)ger[\s\S]{0,400}?(\d+)\s*\/\s*(\d+)/i);
        if(tot){ W.__twnl_spear_owned=parseInt(tot[2],10)||0; }   // the /68 total
      }).catch(function(){ W.__twnl_spear_q=0; });
  }
  function refreshAll(){ GD=W.game_data||GD; W.__twnl_farm_sent={}; return Promise.all([fetchScav(),fetchQueue(),fetchBarbs(),fetchFarmTpl(),fetchBarracksQ()]).then(render); }

  // ── ACTIONS (markup-independent AJAX; same request the game makes) ───────
  function toast(msg,good){
    var p=document.getElementById("twng"); if(!p) return;
    var el=document.getElementById("twng_toast");
    if(!el){ el=document.createElement("div"); el.id="twng_toast"; el.style.cssText="margin:6px 0;padding:5px 7px;border-radius:5px;font-size:11px";
      p.insertBefore(el, p.children[1]||null); }
    el.style.background=good?"#d7e9c8":"#f6d3d3"; el.style.color=good?"#2a6":"#a00"; el.textContent=msg;
  }
  function doBuild(b,lvl){
    if(!AUTO_BUILD){ W.location.href="/game.php?village="+vid()+"&screen="+(b==="place"?"place":"main"); return; }
    toast("building "+(BLABEL[b]||b)+" "+lvl+"…",true);
    var mu="/game.php?village="+vid()+"&screen=main";
    function direct(){
      var u="/game.php?village="+vid()+"&screen=main&ajaxaction=upgrade_building&type=main";
      var body=new URLSearchParams(); body.set("id",b); body.set("force","1"); body.set("destroy","0"); body.set("source",vid()); if(W.__twnl_csrf)body.set("h",W.__twnl_csrf);
      return fetch(u,{method:"POST",credentials:"include",headers:{"X-Requested-With":"XMLHttpRequest","TribalWars-Ajax":"1","Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","Accept":"application/json, text/javascript, */*; q=0.01"},body:body.toString()})
        .then(function(r){return r.text();}).then(function(txt){ var j=null; try{j=JSON.parse(txt);}catch(e){}
          if(j&&(j.error||j.errors)){ toast("build: "+String(j.error||j.errors).slice(0,90),false); return; }
          toast("✓ queued "+(BLABEL[b]||b)+" "+lvl,true); setTimeout(refreshAll,700); });
    }
    fetch(mu,{credentials:"include"}).then(function(r){return r.text();}).then(function(h){
      var cm=h.match(/csrf_token\s*[:=]\s*['"]([a-f0-9]+)['"]/i)||h.match(/"csrf"\s*:\s*"([a-f0-9]+)"/i)||h.match(/&h=([a-f0-9]+)/i); if(cm)W.__twnl_csrf=cm[1];
      var BAD=/\b(premium|instant|kurzbau|buy)\b/i, link=null, hm, hre=/href="([^"]*action=upgrade[^"]*)"/gi;
      while((hm=hre.exec(h))){ var href=hm[1].replace(/&amp;/g,"&"); var idm=href.match(/[?&]id=([a-z_]+)/i); var tym=href.match(/[?&]type=([a-z_]+)/i);
        if(!idm||idm[1].toLowerCase()!==b)continue; if(tym&&BAD.test(tym[1]))continue; link=href; break; }
      if(link){ if(link.charAt(0)!=="/")link="/"+link.replace(/^.*game\.php/,"game.php");
        return fetch(link,{credentials:"include"}).then(function(){ toast("✓ queued "+(BLABEL[b]||b)+" "+lvl,true); setTimeout(refreshAll,700); }); }
      return direct();
    }).catch(function(e){ toast("build failed: "+e,false); });
  }
  function doRecruit(toN){
    var have=totalSpears(), n=Math.max(0,toN-have);
    if(n<=0){ toast("already have "+have+" spears",true); setTimeout(refreshAll,300); return; }
    if(!AUTO_BUILD){ W.location.href="/game.php?village="+vid()+"&screen=barracks"; return; }
    toast("recruiting "+n+" spears (to "+toN+")…",true);
    fetch("/game.php?village="+vid()+"&screen=barracks",{credentials:"include"}).then(function(r){return r.text();}).then(function(h){
      var fm=h.match(/<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/gi), body=null, action=null;
      if(fm)for(var i=0;i<fm.length;i++){ var am=fm[i].match(/action="([^"]+)"/i); var act=am?am[1].replace(/&amp;/g,"&"):"";
        if(/train|recruit/i.test(act)&&/name="spear"/i.test(fm[i])){ action=act; body=fm[i]; break; } }
      if(!action){ toast("no recruit form (botschutz?)",false); return; }
      var data=new URLSearchParams(), im, re=/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi; while((im=re.exec(body)))data.set(im[1],im[2]);
      data.set("spear",String(n));
      ["sword","axe","archer","spy","light","heavy","marcher","ram","catapult"].forEach(function(u){ if(new RegExp('name="'+u+'"').test(body))data.set(u,"0"); });
      if(action.charAt(0)!=="/")action="/"+action.replace(/^.*game\.php/,"game.php");
      return fetch(action,{method:"POST",credentials:"include",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:data.toString()})
        .then(function(){
          // optimistic: record the TARGET spear total we just recruited toward,
          // so the guide treats the step as satisfied immediately (the queued
          // spears are invisible until the markup parse or they land). Decays in
          // fetchScav once real (home+out+queue) catches up to this target.
          W.__twnl_spear_target=toN;
          toast("✓ queued "+n+" spears",true); setTimeout(refreshAll,700);
        });
    }).catch(function(e){ toast("recruit failed: "+e,false); });
  }
  function packSquads(th,tiers){
    var tot=0; Object.keys(th).forEach(function(u){tot+=(th[u]||0)*(CARRY[u]||0);});
    var split=optimalSplit(tot,tiers), pool={}; Object.keys(th).forEach(function(u){ if(CARRY[u]>0)pool[u]=th[u]||0; });
    var byCarry=Object.keys(pool).sort(function(a,b){return CARRY[b]-CARRY[a];});
    var order=tiers.slice().sort(function(a,b){return split[b]-split[a];}), out=[];
    order.forEach(function(t){ var budget=split[t],counts={},filled=0;
      byCarry.forEach(function(u){ if(pool[u]<=0)return; var n=Math.min(pool[u],Math.floor(Math.max(0,budget-filled)/CARRY[u])); if(n>0){counts[u]=n;pool[u]-=n;filled+=n*CARRY[u];} });
      if(filled>0)out.push({option_id:t,unit_counts:counts,carry:filled}); });
    return out;
  }
  function doScavenge(opts){
    opts=opts||{}; var th=opts.troops||troopsHome(), tiers=[]; for(var t=1;t<=scavTiers();t++)tiers.push(t);
    if(!th||!tiers.length){ toast("no troops/tiers",false); return; }
    var busy=W.__twnl_scav_busy||{}, send=tiers.filter(function(t){return !busy[t];});
    if(!send.length){ toast("all tiers already out",false); return; }
    if(!W.__twnl_csrf){ toast("no csrf — tap 🔄",false); return; }
    var squads=packSquads(th,send).filter(function(s){return s.carry>0;}); if(!squads.length){ toast("no troops home",false); return; }
    var data=new URLSearchParams();
    squads.forEach(function(s,i){ var pre="squad_requests["+i+"]";
      data.set(pre+"[village_id]",+vid()); data.set(pre+"[option_id]",s.option_id); data.set(pre+"[use_premium]","false");
      data.set(pre+"[candidate_squad][carry_max]",Math.round(s.carry));
      Object.keys(s.unit_counts).forEach(function(u){ data.set(pre+"[candidate_squad][unit_counts]["+u+"]",s.unit_counts[u]); }); });
    data.set("h",W.__twnl_csrf);
    toast("sending "+squads.length+" squad(s)…",true);
    fetch("/game.php?village="+vid()+"&screen=scavenge_api&ajaxaction=send_squads",
      {method:"POST",credentials:"include",headers:{"X-Requested-With":"XMLHttpRequest","TribalWars-Ajax":"1","Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","Accept":"application/json, text/javascript, */*; q=0.01"},body:data.toString()})
      .then(function(r){return r.json();}).then(function(j){
        if(j&&j.response!==false){ toast("✓ scavenge sent",true); setTimeout(refreshAll,700); } else toast("scavenge rejected (busy?)",false);
      }).catch(function(e){ toast("scavenge failed: "+e,false); });
  }

  // Farm each fresh point-blank barb once with template A (or B), staggered.
  // Supplementary income — run the leftover handful here while the army scavenges.
  function doFarm(label){
    var tpl=(W.__twnl_farm_tpl||{})[label], url=W.__twnl_farm_sendurl;
    if(!tpl||!url){ toast("set Farm Assistant template "+label.toUpperCase()+" in am_farm, then 🔄",false); return; }
    var sent=W.__twnl_farm_sent||{}, barbs=(W.__twnl_barbs||[]).filter(function(b){return !sent[b.id];});
    if(!barbs.length){ toast("no fresh barbs (🔄 to reset)",false); return; }
    toast("farming "+barbs.length+" barb(s) with "+label.toUpperCase()+"…",true);
    var u=url.replace(/village=\d+/,"village="+vid()); if(u.charAt(0)!=="/")u="/"+u.replace(/^.*game\.php/,"game.php");
    var ok=0,i=0;
    (function nx(){ if(i>=barbs.length){ toast("✓ farmed "+ok+"/"+barbs.length,ok>0); setTimeout(refreshAll,600); return; }
      var bb=barbs[i++], d=new URLSearchParams(); d.set("target",bb.id); d.set("template_id",tpl.id); d.set("source",vid());
      fetch(u,{method:"POST",credentials:"include",headers:{"X-Requested-With":"XMLHttpRequest","TribalWars-Ajax":"1","Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","Accept":"application/json, text/javascript, */*; q=0.01"},body:d.toString()})
        .then(function(r){return r.json().catch(function(){return null;});}).then(function(j){ if(!(j&&(j.error||j.errors))){ok++;(W.__twnl_farm_sent=W.__twnl_farm_sent||{})[bb.id]=true;} setTimeout(nx,350); })
        .catch(function(){ setTimeout(nx,350); }); })();
  }

  // ── THE GUIDE — one current step ─────────────────────────────────────────
  function render(){
    var r=liveRes(), lv=liveLevels(), idx=currentIndex(lv), done=idx>=TL.length;
    var old=document.getElementById("twng"); if(old)old.remove();
    var p=document.createElement("div"); p.id="twng";
    p.style.cssText=["position:fixed","z-index:2147483647","bottom:calc(10px + env(safe-area-inset-bottom,0px))","left:8px","width:250px",
      "background:#f4e4bc","border:2px solid #804000","border-radius:8px","font:12px/1.4 Verdana,Arial,sans-serif","color:#000",
      "box-shadow:0 3px 12px rgba(0,0,0,.45)","padding:9px"].join(";");

    // header: progress + refresh + close
    var head=document.createElement("div"); head.style.cssText="display:flex;justify-content:space-between;align-items:center;font-weight:bold;margin-bottom:5px";
    head.innerHTML="<span>👑 Noble Guide</span>";
    var ctl=document.createElement("span"); ctl.style.cssText="display:flex;gap:9px;align-items:center;font-weight:normal";
    ctl.innerHTML="<span style='opacity:.6'>"+Math.round(100*idx/TL.length)+"%</span>";
    var rfh=document.createElement("span"); rfh.textContent="🔄"; rfh.style.cssText="cursor:pointer;font-size:15px"; rfh.onclick=function(){ rfh.textContent="⏳"; refreshAll(); };
    var cls=document.createElement("span"); cls.textContent="✕"; cls.style.cssText="cursor:pointer"; cls.onclick=function(){p.remove();};
    ctl.appendChild(rfh); ctl.appendChild(cls); head.appendChild(ctl); p.appendChild(head);

    if(done){
      var d=document.createElement("div"); d.style.cssText="padding:8px;background:#d7e9c8;border-radius:6px;text-align:center";
      d.innerHTML="✅ <b>Plan complete!</b><br>Build the Academy, mint a gold coin at the Marktplatz, recruit your noble.";
      p.appendChild(d); document.body.appendChild(p); return;
    }

    var cur=TL[idx], typ=cur[T_TYPE], b=cur[T_B], lvl=cur[T_LV];

    // THE STEP — one big card
    var step=document.createElement("div"); step.style.cssText="background:#fff7e0;border:2px solid #c0a060;border-radius:7px;padding:10px;margin-bottom:6px";
    var stepN="Step "+(idx+1)+"/"+TL.length;
    if(typ===1){
      var cw=cur[T_CW],cs=cur[T_CS],ci=cur[T_CI],cp=cur[T_CP];
      var ok=(r.wood>=cw&&r.stone>=cs&&r.iron>=ci);
      var popBlock=(b!=="farm"&&cp&&(r.pop+cp>r.popMax));
      var qUsed=(typeof W.__twnl_qused==="number")?W.__twnl_qused:0;
      var qFull=qUsed>=2;   // both build slots occupied
      step.innerHTML="<div style='font-size:10px;opacity:.6'>"+stepN+" · NEXT</div>"+
        "<div style='font-size:16px;font-weight:bold;margin:2px 0'>🏗️ "+(BLABEL[b]||b)+" → "+lvl+"</div>"+
        "<div style='font-size:11px;opacity:.7'>cost "+cw+"/"+cs+"/"+ci+(cp?" · "+cp+" pop":"")+"</div>"+
        (qFull?"<div style='font-size:12px;margin-top:3px;opacity:.8'>⏳ both build slots busy — finishing queued builds first</div>"
          :popBlock?"<div style='color:#b00;font-size:12px;margin-top:3px'>⚠ pop-capped — a Bauernhof step should come first</div>"
          :ok?"<div style='color:#2a8;font-size:12px;margin-top:3px;font-weight:bold'>✓ affordable — build it now</div>"
              :"<div style='font-size:12px;margin-top:3px;opacity:.8'>⏳ need more "+(r.wood<cw?"wood ":"")+(r.stone<cs?"clay ":"")+(r.iron<ci?"iron":"")+"— keep scavenging</div>");
      var canBuild=ok&&!popBlock&&!qFull;
      var go=document.createElement("div"); go.style.cssText="margin-top:7px;text-align:center;padding:7px;border-radius:5px;cursor:pointer;font-weight:bold;"+(canBuild?"background:#5a9;color:#fff":"background:#ddd;color:#777");
      go.textContent=AUTO_BUILD?(canBuild?"⚡ BUILD NOW":(qFull?"queue full":"build (not ready)")):"→ open & build";
      go.onclick=function(){ doBuild(b,lvl); };
      step.appendChild(go);
    } else if(typ===0){
      step.innerHTML="<div style='font-size:10px;opacity:.6'>"+stepN+" · NEXT</div>"+
        "<div style='font-size:16px;font-weight:bold;margin:2px 0'>🔓 Unlock Raubzug tier "+lvl+"</div>"+
        "<div style='font-size:11px;opacity:.7'>cost "+cur[T_CW]+"/"+cur[T_CS]+"/"+cur[T_CI]+"</div>"+
        "<div style='font-size:12px;margin-top:3px;opacity:.8'>opens the next scavenge option (more loot/run)</div>";
      var go2=document.createElement("a"); go2.href="/game.php?village="+vid()+"&screen=place&mode=scavenge";
      go2.style.cssText="display:block;margin-top:7px;text-align:center;padding:7px;border-radius:5px;background:#789;color:#fff;font-weight:bold;text-decoration:none";
      go2.textContent="→ open Raubzug & unlock";
      step.appendChild(go2);
    } else { // recruit — target is the plan's perfect count for this stage;
             // recruit toward it but CLAMP to what's affordable + fits pop now
             // (never ask for more spears than buildable right this moment).
      var haveSp=totalSpears(), nNeed=Math.max(0,lvl-haveSp);
      var spearCost={w:50,s:30,i:10};
      var affordN=Math.min(Math.floor(r.wood/spearCost.w),Math.floor(r.stone/spearCost.s),Math.floor(r.iron/spearCost.i));
      var popRoom=Math.max(0,r.popMax-r.pop);
      var canNow=Math.min(nNeed, affordN, popRoom);
      var popFull=popRoom<=0;
      step.innerHTML="<div style='font-size:10px;opacity:.6'>"+stepN+" · NEXT</div>"+
        "<div style='font-size:16px;font-weight:bold;margin:2px 0'>⚔️ Recruit spears → "+lvl+"</div>"+
        "<div style='font-size:11px;opacity:.7'>have "+haveSp+", plan wants "+lvl+" · feeds scavenge carry</div>"+
        (popFull?"<div style='color:#b00;font-size:12px;margin-top:3px'>⚠ pop full — build a Bauernhof first</div>"
          :canNow>0?"<div style='color:#2a8;font-size:12px;margin-top:3px;font-weight:bold'>✓ recruit "+canNow+" now"+(canNow<nNeed?" ("+(nNeed-canNow)+" more once affordable)":"")+"</div>"
              :"<div style='font-size:12px;margin-top:3px;opacity:.8'>⏳ save "+(nNeed*spearCost.w)+"/"+(nNeed*spearCost.s)+"/"+(nNeed*spearCost.i)+" — keep scavenging</div>");
      var go3=document.createElement("div"); go3.style.cssText="margin-top:7px;text-align:center;padding:7px;border-radius:5px;cursor:pointer;font-weight:bold;"+(canNow>0?"background:#b97;color:#fff":"background:#ddd;color:#777");
      go3.textContent=AUTO_BUILD?(canNow>0?"⚡ RECRUIT "+canNow:"recruit (not ready)"):"→ open barracks";
      go3.onclick=function(){ if(canNow>0) doRecruit(haveSp+canNow); };
      step.appendChild(go3);
      // DEBUG: show exactly what the count is built from, so troop-count bugs
      // are visible, not black-box. owned = "Insgesamt" total; q = barracks queue.
      var dbg=document.createElement("div"); dbg.style.cssText="margin-top:4px;font-size:9px;opacity:.55";
      dbg.textContent="count: owned "+(W.__twnl_spear_owned!=null?W.__twnl_spear_owned:"?")+
        " + queue "+(W.__twnl_spear_q||0)+" + JSONhome "+((troopsHome()||{}).spear||0)+
        " /out "+((W.__twnl_scav_out||{}).spear||0)+" → total "+haveSp;
      step.appendChild(dbg);
    }
    p.appendChild(step);

    // next-up preview (faint, 3 steps)
    var prev=[]; for(var j=idx+1;j<Math.min(idx+4,TL.length);j++){ var s=TL[j];
      prev.push(s[T_TYPE]===0?"unlock t"+s[T_LV]:s[T_TYPE]===2?"recruit to "+s[T_LV]:(BLABEL[s[T_B]]||s[T_B])+" "+s[T_LV]); }
    if(prev.length){ var pv=document.createElement("div"); pv.style.cssText="font-size:10px;opacity:.55;margin-bottom:6px"; pv.innerHTML="next: "+prev.join(" → "); p.appendChild(pv); }

    // ── STANDING: keep scavenging (background income, not a step) ──
    var tiers=[]; for(var t=1;t<=scavTiers();t++)tiers.push(t);
    var th=troopsHome();
    var sc=document.createElement("div"); sc.style.cssText="background:#eaf3e0;border:1px solid #9bbf7a;border-radius:6px;padding:6px;margin-bottom:5px;font-size:11px";
    if(!tiers.length){ sc.innerHTML="<b>⛏️ Scavenge</b><br><span style='opacity:.7'>unlock tier 1 first (a step above)</span>"; }
    else {
      var ret=W.__twnl_scav_ret||{}, outT=Object.keys(ret), busy=W.__twnl_scav_busy||{};
      var idleTiers=tiers.filter(function(t){return !busy[t];});
      var carry=0; if(th)Object.keys(th).forEach(function(u){carry+=(th[u]||0)*(CARRY[u]||0);});
      var html="<b>⛏️ Keep scavenging</b> <span style='opacity:.6'>(continuous income)</span>";
      if(outT.length){ html+="<br>"; outT.sort(function(a,b){return ret[a]-ret[b];}).forEach(function(tk){ html+="T"+tk+" back "+countdown(ret[tk])+" · "; }); html=html.replace(/ · $/,""); }
      if(idleTiers.length && carry>0){
        var sp=optimalSplit(carry,idleTiers), lph=0; idleTiers.forEach(function(t){lph+=scavRate(sp[t]||0,SCAV_LOOT[t])*3600;});
        html+="<br><span style='opacity:.7'>"+idleTiers.length+" tier(s) idle · ≈"+Math.round(lph)+" res/h ready</span>";
      } else if(!outT.length){ html+="<br><span style='opacity:.7'>troops home — send them</span>"; }
      sc.innerHTML=html;
      if(AUTO_BUILD && idleTiers.length && carry>0){
        // Decide the RECOMMENDED action. Build-blocked rush → if the current
        // step needs resources, the build-sized "unblock" run is the default
        // (build sooner). Only if the step is already affordable does max-loot/h
        // become the default (throughput for future steps).
        var unblockNeed=0, sub=null, subC=0, bestLf=Math.max.apply(null,idleTiers.map(function(t){return SCAV_LOOT[t];}));
        if(typ===1){ var needPer=Math.max(0,cur[T_CW]-r.wood,cur[T_CS]-r.stone,cur[T_CI]-r.iron); unblockNeed=needPer;
          if(needPer>0){ sub=troopsForCarry(th,carryForLoot(needPer*3,bestLf)); Object.keys(sub).forEach(function(u){subC+=sub[u]*CARRY[u];}); } }

        if(unblockNeed>0 && subC>0){
          // PRIMARY: build-sized run
          var bU=document.createElement("div"); bU.style.cssText="margin-top:5px;text-align:center;padding:6px;background:#5a9;border-radius:5px;cursor:pointer;font-weight:bold;color:#fff";
          bU.innerHTML="⚡ scavenge to unblock this step <span style='opacity:.85'>(recommended)</span><div style='font-size:10px;font-weight:normal'>"+(scavDuration(subC,bestLf)/3600).toFixed(1)+"h → +~"+Math.round(subC*bestLf)+", rest stay home</div>";
          bU.onclick=function(){ doScavenge({troops:sub}); }; sc.appendChild(bU);
          // SECONDARY: max-loot, small
          var bMaxS=document.createElement("div"); bMaxS.style.cssText="margin-top:4px;text-align:center;font-size:10px;color:#36c;cursor:pointer";
          bMaxS.textContent="or send all (max loot/h — if you'll re-send soon)"; bMaxS.onclick=function(){ doScavenge({}); }; sc.appendChild(bMaxS);
        } else {
          // step already affordable → max-loot IS the right default
          var bMax=document.createElement("div"); bMax.style.cssText="margin-top:5px;text-align:center;padding:6px;background:#5a9;border-radius:5px;cursor:pointer;font-weight:bold;color:#fff";
          bMax.innerHTML="⚡ send all scavenging <span style='opacity:.85'>(recommended)</span><div style='font-size:10px;font-weight:normal'>next step's affordable — bank loot for later</div>";
          bMax.onclick=function(){ doScavenge({}); }; sc.appendChild(bMax);
        }
        // overnight (always available, small)
        var ov=document.createElement("div"); ov.style.cssText="margin-top:5px;font-size:10px;opacity:.8"; ov.innerHTML="🌙 going AFK? overnight run: ";
        [6,8,10].forEach(function(hrs){ var bb=document.createElement("span"); bb.textContent=hrs+"h"; bb.style.cssText="cursor:pointer;padding:1px 5px;margin:0 2px;border:1px solid #789;border-radius:3px";
          bb.onclick=function(){ doScavenge({troops:troopsForCarry(th,carryForDuration(hrs*3600,bestLf))}); }; ov.appendChild(bb); });
        sc.appendChild(ov);
      }
    }
    p.appendChild(sc);

    // ── STANDING: farm point-blank barbs (supplementary bonus income) ──
    // Only show once you have a barracks + spears + a nearby barb. This is the
    // leftover-handful bonus run ALONGSIDE scavenge (~80 res/barb, fast return).
    var barbs=W.__twnl_barbs||[];
    if((lv.barracks||0)>=1 && th && (th.spear||0)>0){
      if(barbs.length){
        var fc=document.createElement("div"); fc.style.cssText="background:#f3e8e8;border:1px solid #c89;border-radius:6px;padding:6px;margin-bottom:5px;font-size:11px";
        var sent=W.__twnl_farm_sent||{}, fresh=barbs.filter(function(b){return !sent[b.id];});
        fc.innerHTML="<b>🐺 Bonus farm</b> <span style='opacity:.6'>("+barbs.length+" point-blank barb"+(barbs.length>1?"s":"")+", ~80 res each)</span>";
        var tpls=W.__twnl_farm_tpl||{};
        if(AUTO_BUILD && Object.keys(tpls).length){
          ["a","b"].forEach(function(lab){ if(!tpls[lab])return;
            var fb=document.createElement("span"); fb.style.cssText="display:inline-block;margin:4px 4px 0 0;padding:3px 8px;background:#c89;color:#fff;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px";
            fb.textContent=fresh.length?"⚡ "+lab.toUpperCase()+" → "+fresh.length+" barb"+(fresh.length>1?"s":""):"⚡ "+lab.toUpperCase()+" (all hit)";
            if(!fresh.length)fb.style.opacity="0.5";
            fb.onclick=function(){ doFarm(lab); }; fc.appendChild(fb); });
        } else if(AUTO_BUILD){ fc.innerHTML+="<br><span style='font-size:10px;color:#a60'>set a Farm Assistant template (A/B), then 🔄</span>"; }
        p.appendChild(fc);
      }
      // if no barbs nearby, we stay silent (scavenge is strictly better — no clutter)
    }

    // footer: res + ETA + plan-check
    var foot=document.createElement("div"); foot.style.cssText="font-size:10px;opacity:.7";
    var etaH=(NOBLE_H-cur[T_AT]); var dW=r.wood-cur[T_EW],dS=r.stone-cur[T_ES],dI=r.iron-cur[T_EI];
    var drift=(dW< -800||dS< -800||dI< -800)?"<span style='color:#b00'> · behind plan, scavenge more</span>":"<span style='color:#2a8'> · on track</span>";
    foot.innerHTML="🪵"+r.wood+" 🧱"+r.stone+" ⚙️"+r.iron+" · pop "+r.pop+"/"+r.popMax+
      "<br>~"+Math.round(etaH)+"h to noble"+drift;
    p.appendChild(foot);

    // skip override (in case auto-detect lags)
    var skip=document.createElement("div"); skip.style.cssText="margin-top:5px;font-size:10px;opacity:.5;display:flex;justify-content:space-between";
    var sk=document.createElement("span"); sk.textContent="✓ mark done / skip →"; sk.style.cssText="cursor:pointer";
    sk.onclick=function(){ W.__twng_skip=(W.__twng_skip||0); /* nudge past current step visually */
      W.__twng_force=idx+1; render(); };
    skip.appendChild(sk); p.appendChild(skip);

    document.body.appendChild(p);
  }

  render();
  Promise.all([fetchScav(),fetchQueue(),fetchBarbs(),fetchFarmTpl(),fetchBarracksQ()]).then(render);
  console.log("[noble-guide] "+TL.length+" steps");
})();
