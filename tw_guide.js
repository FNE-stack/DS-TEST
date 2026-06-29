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
  [1,"iron",1,1.77,75,65,70,10,63,240,2,821,769,532],
  [1,"wood",2,1.95,62,75,50,6,72,240,2,765,755,553],
  [1,"wood",3,2.02,78,94,62,7,84,240,2,589,663,541],
  [1,"stone",2,2.2,83,64,51,6,91,240,2,611,724,586],
  [1,"stone",3,2.32,105,81,65,7,100,240,2,587,764,631],
  [1,"wood",4,2.45,98,117,78,8,109,240,2,595,771,647],
  [1,"wood",5,2.62,122,146,98,9,120,240,2,529,721,634],
  [1,"wood",6,2.82,153,183,122,10,131,240,2,518,699,642],
  [1,"stone",4,3.05,133,102,82,8,139,240,2,546,757,667],
  [1,"stone",5,3.33,169,130,104,9,149,240,2,530,796,699],
  [1,"iron",2,3.42,94,81,88,11,160,240,2,591,868,713],
  [1,"iron",3,3.72,118,102,110,13,175,240,2,543,871,692],
  [1,"stone",6,3.77,215,165,132,10,185,240,2,481,858,662],
  [1,"stone",7,4.08,273,210,168,12,197,240,2,420,857,647],
  [1,"iron",4,4.28,147,128,137,15,212,240,2,436,890,618],
  [1,"farm",1,4.7,45,40,30,0,212,240,2,609,1068,747],
  [1,"farm",2,4.72,53,47,35,0,214,240,2,607,1113,792],
  [1,"storage",3,4.98,96,80,64,0,217,281,2,578,1162,861],
  [1,"storage",4,5.05,121,101,81,0,218,330,2,561,1186,873],
  [1,"iron",5,5.38,184,160,172,17,237,330,2,505,1197,853],
  [1,"iron",6,5.53,231,200,215,19,256,330,2,433,1158,745],
  [1,"iron",7,5.9,289,250,270,21,277,330,2,376,1144,650],
  [1,"wood",7,6.15,191,229,153,12,289,330,2,351,1083,611],
  [1,"farm",3,6.65,62,55,41,0,289,330,2,530,1274,761],
  [1,"farm",4,6.77,72,64,48,0,289,330,2,615,1368,821],
  [1,"wood",8,7.05,238,286,191,14,306,386,2,461,1226,784],
  [1,"wood",9,7.25,298,358,238,16,322,453,2,327,1032,660],
  [1,"wood",10,7.8,373,447,298,18,340,453,2,210,841,568],
  [1,"stone",8,8.15,346,266,213,14,354,453,2,108,815,545],
  [1,"wood",11,8.9,466,559,373,21,375,453,2,82,676,492],
  [1,"stone",9,10.18,440,338,271,16,391,453,2,136,792,610],
  [1,"farm",5,10.18,84,75,56,0,391,453,2,52,717,554],
  [1,"stone",10,11.18,559,430,344,18,410,531,2,11,776,605],
  [1,"wood",12,13.32,582,698,466,24,436,531,2,40,670,648],
  [1,"farm",6,17.07,99,88,66,0,452,531,2,418,1260,1368],
  [1,"farm",7,17.07,115,103,77,0,452,531,2,303,1157,1291],
  [1,"storage",5,18.65,154,128,102,0,463,729,2,499,1534,1746],
  [1,"storage",6,19.18,194,162,130,0,464,729,2,469,1534,1775],
  [1,"storage",7,22.38,246,205,164,0,495,729,2,480,2075,2740],
  [1,"storage",8,22.7,311,259,207,0,495,729,2,219,1853,2556],
  [1,"wood",13,23.45,728,873,582,28,526,729,2,4,1522,2494],
  [1,"iron",8,23.98,362,313,338,24,550,729,2,76,1621,2495],
  [1,"stone",11,25.05,709,546,437,21,572,729,2,38,1722,2631],
  [1,"storage",9,28.25,393,328,262,0,602,729,2,406,2584,3923],
  [1,"storage",10,28.78,498,415,332,0,602,729,2,271,2506,3902],
  [1,"farm",8,30.37,135,120,90,0,620,729,2,371,2905,4512],
  [1,"farm",9,30.37,158,140,105,0,620,729,2,213,2765,4407],
  [1,"storage",11,33.13,630,525,420,0,663,1002,2,298,3683,6051],
  [1,"storage",12,34.23,796,664,531,0,670,1002,2,152,3756,6343],
  [1,"wood",14,35.33,909,1091,728,33,711,1002,2,25,3554,6558],
  [1,"iron",9,36.28,453,392,423,28,741,1002,2,220,3804,6720],
  [1,"iron",10,37.35,567,491,529,31,787,1002,2,114,4023,7097],
  [1,"stone",12,38.08,901,693,554,24,818,1002,2,95,4301,7578],
  [0,"scavenge",3,39.18,1000,1200,1000,0,826,1002,3,43,4123,7680],
  [1,"wood",15,39.73,1137,1364,909,38,864,1002,3,152,3965,7914],
  [1,"farm",10,39.9,185,164,123,0,864,1002,3,3,3828,7811],
  [1,"storage",13,41.33,1007,840,672,0,903,1175,3,657,5348,10171],
  [1,"storage",14,42.4,1274,1062,850,0,929,1175,3,874,6237,11082],
  [1,"storage",15,43.78,1612,1343,1075,0,929,1175,3,2257,7763,10957],
  [1,"storage",16,45.35,2039,1700,1360,0,929,1175,3,4508,10210,13410],
  [1,"storage",17,47.32,2580,2150,1720,0,929,1175,3,7568,13521,16417],
  [1,"stone",13,49.58,1144,880,704,28,957,1175,3,12138,18149,21078],
  [1,"storage",18,51.43,3264,2720,2176,0,957,1175,3,13235,19622,22969],
  [1,"wood",16,52.4,1421,1705,1137,43,1000,1175,3,14704,20745,24545],
  [1,"farm",11,55.58,216,192,144,0,1000,1175,3,22931,28788,32373],
  [1,"storage",19,57.28,4128,3440,2752,0,1000,1377,3,23194,29561,30771],
  [1,"iron",11,57.53,710,615,662,35,1035,1377,3,23957,30392,31488],
  [1,"wood",17,59.07,1776,2132,1421,50,1085,1377,3,26524,32442,34097],
  [1,"stone",14,62.88,1453,1118,894,33,1118,1377,3,35074,40099,40323],
  [1,"iron",12,64.6,889,770,829,40,1158,1377,3,38663,40597,40488],
  [1,"iron",13,65.1,1113,964,1038,46,1204,1377,3,39119,41125,40868],
  [1,"farm",12,66.45,253,225,169,0,1204,1377,3,43221,45089,44733],
  [1,"farm",13,67.32,296,263,197,0,1204,1377,3,44617,46411,46023],
  [1,"wood",18,68.5,2220,2665,1776,58,1262,1614,3,45446,46650,47064],
  [1,"stone",15,69.77,1846,1420,1136,38,1300,1893,3,47926,49255,49539],
  [1,"wood",19,72.42,2776,3331,2220,67,1367,1893,3,47899,47344,48455],
  [1,"iron",14,73.07,1393,1207,1300,52,1419,1893,3,48125,47699,48625],
  [1,"wood",20,75.72,3469,4163,2776,77,1496,1893,3,47206,46512,47899],
  [1,"stone",16,77.9,2344,1803,1442,43,1539,1893,3,48331,48872,49233],
  [1,"iron",15,81.08,1744,1511,1628,59,1598,1893,3,48931,49164,49047],
  [1,"stone",17,82.3,2977,2290,1832,50,1648,1893,3,47698,48385,48843],
  [1,"farm",14,84.27,346,308,231,0,1648,1893,3,50329,50367,50444],
  [1,"farm",15,86.12,405,360,270,0,1648,1893,3,50270,50315,50405],
  [1,"iron",16,87.22,2183,1892,2038,67,1715,2219,3,48492,48783,48637],
  [1,"iron",17,89.65,2734,2369,2551,76,1791,2602,3,47941,48306,48124],
  [1,"stone",18,91.03,3781,2908,2327,58,1849,2602,3,46894,47767,48348],
  [1,"stone",19,94.22,4802,3693,2955,67,1916,2602,3,45873,46982,47720],
  [1,"iron",18,95.6,3422,2966,3194,86,2002,2602,3,45834,47132,47481],
  [1,"iron",19,99.7,4285,3714,3999,98,2100,2602,3,46390,46961,46676],
  [1,"stone",20,101.08,6098,4691,3753,77,2177,2602,3,44577,45984,46922],
  [1,"iron",20,106.28,5365,4649,5007,111,2288,2602,3,45310,46026,45668],
  [1,"farm",16,107.67,474,422,316,0,2288,2602,3,49469,50133,49831],
  [1,"iron",21,111.9,6717,5821,6269,126,2414,3050,3,43958,44854,44406],
  [1,"market",1,114.18,100,100,100,10,2424,3050,3,50218,50575,50445],
  [1,"market",2,114.82,126,126,126,12,2436,3050,3,50549,50549,50549],
  [1,"main",5,115.57,227,202,176,9,2445,3050,3,50448,50473,50499],
  [1,"smith",1,116.0,220,180,240,20,2465,3050,3,50455,50495,50435],
  [1,"smith",2,117.32,277,227,302,23,2488,3050,3,50398,50448,50373],
  [1,"smith",3,118.9,349,286,381,27,2515,3050,3,50326,50389,50294],
  [1,"smith",4,120.78,440,360,480,32,2547,3050,3,50235,50315,50195],
  [1,"smith",5,121.37,555,454,605,37,2584,3050,3,50120,50221,50070],
  [1,"smith",6,123.05,699,572,762,44,2628,3050,3,49976,50103,49913],
  [1,"farm",17,124.08,555,493,370,0,2628,3050,3,50120,50182,50305],
  [1,"farm",18,126.3,649,577,433,0,2628,3050,3,50026,50098,50242],
  [1,"market",3,128.92,159,159,159,14,2642,3576,3,50516,50516,50516],
  [1,"main",6,129.77,286,254,222,11,2653,3576,3,50389,50421,50453],
  [1,"main",7,130.27,360,320,280,13,2666,3576,3,50315,50355,50395],
  [1,"smith",7,130.83,880,720,960,51,2717,3576,3,49795,49955,49715],
  [1,"smith",8,132.1,1109,908,1210,60,2777,4192,3,49566,49767,49465],
  [1,"market",4,134.38,200,200,200,16,2793,4192,3,50475,50475,50475],
  [1,"main",8,135.32,454,403,353,15,2808,4192,3,50221,50272,50322],
  [1,"smith",9,135.97,1398,1144,1525,70,2878,4192,3,49277,49531,49150],
  [1,"main",9,136.35,572,508,445,18,2896,4192,3,50103,50167,50230],
  [1,"smith",10,137.08,1761,1441,1921,82,2978,4192,3,48914,49234,48754],
  [1,"market",5,140.83,252,252,252,19,2997,4192,3,50423,50423,50423],
  [1,"main",10,141.85,720,640,560,21,3018,4192,3,49955,50035,50115],
  [1,"main",11,142.63,908,807,706,24,3042,4192,3,49767,49868,49969],
  [1,"main",12,142.68,1144,1017,890,28,3070,4192,3,49531,49658,49785],
  [1,"smith",11,143.63,2219,1815,2421,96,3166,4192,3,48456,48860,48254],
  [1,"smith",12,143.83,2796,2287,3050,112,3278,4192,3,47166,48079,46677],
  [1,"market",6,149.68,318,318,318,22,3300,4192,3,50357,50357,50357],
  [1,"main",13,150.73,1441,1281,1121,33,3333,4192,3,49234,49394,49554],
  [1,"main",14,150.73,1816,1614,1412,38,3371,4192,3,47418,47780,48142],
  [1,"smith",13,151.98,3523,2882,3843,132,3503,4192,3,47152,47793,46832],
  [1,"smith",14,152.23,4439,3632,4842,154,3657,4192,3,42996,44444,42244],
  [1,"farm",19,159.87,760,675,506,0,3657,4192,3,49915,50000,50169],
  [1,"farm",20,161.25,889,790,592,0,3657,4192,3,49786,49885,50083],
  [1,"market",7,164.35,400,400,400,26,3683,4914,3,50275,50275,50275],
  [1,"main",15,165.48,2288,2034,1779,45,3728,4914,3,48387,48641,48896],
  [1,"main",16,166.63,2883,2562,2242,53,3781,5760,3,47792,48113,48433],
  [1,"smith",15,167.12,5593,4576,6101,180,3961,5760,3,43855,45193,43980],
  [1,"smith",16,168.58,7047,5765,7687,211,4172,5760,3,41486,44106,41046],
  [1,"market",8,177.42,504,504,504,30,4202,5760,3,50171,50171,50171],
  [1,"smith",17,178.65,8879,7264,9686,247,4449,5760,3,41796,43411,40989],
  [1,"main",17,180.35,3632,3229,2825,62,4511,5760,3,42965,44983,43061],
  [1,"smith",18,182.48,11187,9153,12204,289,4800,5760,3,38059,41522,37271],
  [1,"market",9,192.77,635,635,635,35,4835,5760,3,50040,50040,50040],
  [1,"main",18,194.18,4577,4068,3560,72,4907,5760,3,46098,46607,47115],
  [1,"farm",21,196.62,1040,924,693,0,4907,5760,3,49635,49751,49982],
  [1,"farm",22,198.62,1217,1081,811,0,4907,5760,3,49458,49594,49864],
  [1,"main",19,201.93,5767,5126,4485,84,4991,6752,3,44908,45549,46190],
  [1,"smith",19,204.7,14096,11533,15377,338,5329,6752,3,36579,39142,35298],
  [1,"smith",20,205.0,17761,14532,19375,395,5724,7916,3,19127,24919,16208],
  [1,"market",10,222.27,800,800,800,41,5765,7916,3,49875,49875,49875],
  [1,"main",20,223.8,7266,6458,5651,99,5864,7916,3,43409,44217,45024],
  [1,"main",21,226.08,9155,8138,7120,116,5980,7916,3,40614,42439,43555],
  [1,"snob",1,226.97,15000,25000,10000,80,6060,7916,3,28732,20557,36699]
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
  // Spear recruit time (seconds) at world speed 1: base ~1020s at barracks 1,
  // each barracks level cuts it ~10% (×0.9^(lvl-1)). Lets us PINPOINT troop
  // production ("12 spears = 18 min") instead of estimating.
  var SPEAR_BASE_TRAIN_S = 1020;
  // Prefer the REAL per-spear time read live from the barracks page (cached on
  // W.__twnl_spearsec); fall back to the formula only until we've read it once.
  // (The formula's decay factor is approximate; the live value is authoritative.)
  function spearTrainSec(barracksLvl){
    if(typeof W.__twnl_spearsec==="number" && W.__twnl_spearsec>0) return W.__twnl_spearsec;
    return SPEAR_BASE_TRAIN_S*Math.pow(0.9, Math.max(0,(barracksLvl||1)-1));
  }
  var SCAV_LOOT = {1:0.10,2:0.25,3:0.50,4:0.75};
  var DUR_EXP=0.45, DUR_INITIAL=1800.0, DUR_FACTOR=0.7722074896557402;
  var CARRY={spear:25,sword:15,axe:10,archer:10,light:80,marcher:50,heavy:50,spy:0,ram:0,catapult:0,knight:100};

  var BLABEL = {
    main:"Hauptgebäude", place:"Versammlungsplatz", barracks:"Kaserne",
    smith:"Schmiede", market:"Marktplatz", wood:"Holzfäller", stone:"Lehmgrube",
    iron:"Eisenmine", farm:"Bauernhof", storage:"Speicher", snob:"Adelshof",
    hide:"Versteck", wall:"Wall", scavenge:"Raubzug"
  };
  function bscreen(b){ return b==="place"||b==="scavenge" ? "place" : "main"; }

  // Total resource cost of the WHOLE plan to first noble, computed once from TL.
  // Gross = sum of all step costs; refund = 150/150/100 per BUILD (not scav);
  // net = what you must actually generate. Also the remaining cost from your
  // current step onward, so the panel can show "X left to noble".
  function planTotals(fromIdx){
    var g={w:0,s:0,i:0}, rem={w:0,s:0,i:0}, nbuild=0, nbuildRem=0;
    for(var k=0;k<TL.length;k++){
      var row=TL[k]; g.w+=row[T_CW]; g.s+=row[T_CS]; g.i+=row[T_CI];
      if(row[T_TYPE]===1) nbuild++;
      if(k>=fromIdx){ rem.w+=row[T_CW]; rem.s+=row[T_CS]; rem.i+=row[T_CI]; if(row[T_TYPE]===1) nbuildRem++; }
    }
    var REW={w:150,s:150,i:100};
    return {
      gross:g, refund:{w:nbuild*REW.w,s:nbuild*REW.s,i:nbuild*REW.i},
      net:{w:g.w-nbuild*REW.w,s:g.s-nbuild*REW.s,i:g.i-nbuild*REW.i},
      remGross:rem, remRefund:{w:nbuildRem*REW.w,s:nbuildRem*REW.s,i:nbuildRem*REW.i},
      remNet:{w:rem.w-nbuildRem*REW.w,s:rem.s-nbuildRem*REW.s,i:rem.i-nbuildRem*REW.i}
    };
  }

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

  // Read Farm Assistant TEMPLATES (A/B) + their template_ids + the AJAX
  // send_units_link from the am_farm page (read-only). Ported from FarmBot's
  // _parse_templates + _extract_send_units_link. Caches:
  //   W.__twnl_farm_tpl     = {a:{id,units}, b:{id,units}}
  //   W.__twnl_farm_sendurl = Accountmanager.send_units_link
  function fetchFarmTemplates(){
    return fetch("/game.php?village="+vidParam()+"&screen=am_farm",{credentials:"include"})
      .then(function(r){return r.text();})
      .then(function(h){
        // send_units_link (the AJAX farm endpoint)
        var su=h.match(/Accountmanager\.send_units_link\s*=\s*['"]([^'"]+)['"]/);
        if(su) W.__twnl_farm_sendurl=su[1].replace(/&amp;/g,"&");

        // templates: scope to loot_assistant_templates table, walk rows.
        var tblM=h.match(/<table[^>]*class="[^"]*loot_assistant_templates[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
        var body=tblM?tblM[1]:h;
        var tpl={}, label=null;
        var rowRe=/<tr([^>]*)>([\s\S]*?)<\/tr>/gi, rm;
        while((rm=rowRe.exec(body))){
          var rb=rm[2];
          var ic=rb.match(/farm_icon_([ab])/i);
          if(ic){ label=ic[1].toLowerCase(); continue; }
          // a unit-input row: name="spear[<tid>]" etc, with template[<tid>][id]
          if(label && /name="(?:spear|sword|axe|spy|light|heavy|ram|catapult)\[\d+\]"/i.test(rb)){
            var idm=rb.match(/name="template\[(\d+)\]\[id\]"\s+value="(\d+)"/i);
            var tid=idm?idm[2]:null;
            var units={}, um, ure=/name="(spear|sword|axe|archer|spy|light|heavy|marcher|ram|catapult)\[\d+\]"[^>]*value="(\d+)"/gi;
            while((um=ure.exec(rb))){ units[um[1]]=parseInt(um[2],10)||0; }
            if(tid){ tpl[label]={id:tid, units:units}; }
            label=null;
          }
        }
        if(Object.keys(tpl).length) W.__twnl_farm_tpl=tpl;
      }).catch(function(){});
  }

  // Read the REAL per-spear recruit time (seconds) from the barracks page, so
  // the troop-time display is exact, not formula-estimated. TW shows the unit
  // build time in the recruit row; we try several markup variants. Cached on
  // W.__twnl_spearsec. (If all parses miss, the formula fallback stays in use —
  // paste the barracks console dump and I'll lock the exact selector.)
  function fetchTrainTime(){
    return fetch("/game.php?village="+vidParam()+"&screen=barracks",{credentials:"include"})
      .then(function(r){return r.text();})
      .then(function(h){
        var sec=null;
        // variant A: inline unit JSON  "spear":{..."build_time":1020...}
        var a=h.match(/"spear"\s*:\s*\{[^}]*?build_time"?\s*:\s*"?(\d+)/i);
        if(a) sec=parseInt(a[1],10);
        // variant B: data-build_time / data-build-time on a spear element
        if(!sec){ var b=h.match(/spear[^>]*data-build[_-]?time="(\d+)"/i)
                     || h.match(/data-unit="spear"[^>]*data-build[_-]?time="(\d+)"/i);
                  if(b) sec=parseInt(b[1],10); }
        // variant C: H:MM:SS duration text in the spear recruit row
        if(!sec){ var c=h.match(/spear[\s\S]{0,300}?(\d+):(\d{2}):(\d{2})/i);
                  if(c) sec=(+c[1])*3600+(+c[2])*60+(+c[3]); }
        if(sec && sec>0 && sec<100000) W.__twnl_spearsec=sec;
      }).catch(function(){});
  }

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

    // TOTAL to first noble (net of 150/150/100 refunds) + what's LEFT from here.
    var tot=planTotals(idx);
    function k(n){ return n>=1000?(Math.round(n/100)/10)+"k":n; }
    var tl=document.createElement("div");
    tl.style.cssText="font-size:10px;opacity:.7;margin-bottom:5px;cursor:pointer";
    tl.title="net resources (after refunds) — tap for full breakdown";
    var sumLeft=tot.remNet.w+tot.remNet.s+tot.remNet.i;
    tl.innerHTML="🎯 to noble: <b>"+k(sumLeft)+"</b> net left "+
      "("+k(tot.remNet.w)+"/"+k(tot.remNet.s)+"/"+k(tot.remNet.i)+")";
    tl.onclick=function(){
      tl.innerHTML="🎯 to noble (net of +150/150/100 refunds):<br>"+
        "&nbsp;left: "+k(tot.remNet.w)+"/"+k(tot.remNet.s)+"/"+k(tot.remNet.i)+" = "+k(sumLeft)+"<br>"+
        "&nbsp;full plan net: "+k(tot.net.w)+"/"+k(tot.net.s)+"/"+k(tot.net.i)+" = "+k(tot.net.w+tot.net.s+tot.net.i)+"<br>"+
        "&nbsp;gross "+k(tot.gross.w+tot.gross.s+tot.gross.i)+" − refunds "+k(tot.refund.w+tot.refund.s+tot.refund.i);
    };
    p.appendChild(tl);

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
      var perS=spearTrainSec(lv.barracks||1);   // exact seconds per spear
      function mmss(sec){ sec=Math.round(sec); var m=Math.floor(sec/60); return m+"m"+(sec%60<10?"0":"")+(sec%60)+"s"; }
      tc.innerHTML="<div style='font-size:10px;opacity:.6'>⚔️ TROOPS (surplus only, goal ~"+SPEAR_GOAL+")</div>"+
        "have "+spN+" spears — "+(spN>=SPEAR_GOAL?"<span style='color:#2a8'>enough ✓</span>"
          : popFull?"<span style='color:#b00'>pop full</span>"
          : "<span style='opacity:.75'>"+(canAfford>0?"can train ~"+canAfford+" now":"save for build first")+"</span>")+
        "<div style='font-size:10px;opacity:.6'>1 spear = "+mmss(perS)+" (barracks "+(lv.barracks||0)+")</div>";
      if(spN<SPEAR_GOAL && !popFull && canAfford>0){
        // small batch buttons — each shows the EXACT train time for that batch
        [Math.min(5,canAfford), Math.min(20,canAfford), canAfford].forEach(function(n,i){
          if(n<=0) return; if(i>0 && n<=Math.min(5,canAfford)) return;  // dedupe tiny
          var btn=document.createElement("span"); btn.textContent="+"+n+" ("+mmss(n*perS)+")";
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
      // Send via Farm Assistant templates A/B (one clean POST each). A button
      // per configured template, firing at the NEAREST point-blank barb.
      var tpls=W.__twnl_farm_tpl||{};
      var haveTpl=Object.keys(tpls).length>0;
      if(AUTO_BUILD && haveTpl){
        ["a","b"].forEach(function(lab){
          if(!tpls[lab]) return;
          var u=tpls[lab].units||{};
          var desc=Object.keys(u).filter(function(k){return u[k]>0;}).map(function(k){return u[k]+k.slice(0,2);}).join("+")||"empty";
          var fb=document.createElement("span");
          fb.style.cssText="display:inline-block;margin:4px 4px 0 0;padding:3px 8px;background:#c89;border-radius:4px;cursor:pointer;font-weight:bold;color:#fff;font-size:11px";
          fb.textContent="⚡ "+lab.toUpperCase()+" ("+desc+")";
          fb.onclick=function(){ doFarm(barbs[0], lab); };
          fc.appendChild(fb);
        });
      } else if (AUTO_BUILD && !haveTpl){
        var warn=document.createElement("div");
        warn.style.cssText="margin-top:3px;font-size:10px;color:#a60";
        warn.textContent="set a Farm Assistant template (A/B) in am_farm, then 🔄";
        fc.appendChild(warn);
      }
      var fa=document.createElement("a");
      fa.href="/game.php?village="+vidParam()+"&screen=am_farm";
      fa.textContent="→ Farm Assistant"; fa.style.cssText="display:inline-block;margin-top:4px;font-size:11px;color:#36c";
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
    return Promise.all([fetchScavAndTroops(), fetchQueue(), fetchBarbs(), fetchTrainTime(), fetchFarmTemplates()]).then(function(){ render(); });
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

  // FARM a barb using your Farm Assistant TEMPLATE (A or B). One clean POST to
  // Accountmanager.send_units_link with {target, template_id, source} — exactly
  // the request FarmGod / the game's farm button makes. Needs the template_id
  // (read from am_farm by fetchFarmTemplates) and the barb's village id.
  function doFarm(barb, label){
    var tpl=(W.__twnl_farm_tpl||{})[label];
    var sendUrl=W.__twnl_farm_sendurl;
    if(!tpl || !sendUrl){ toast("no Farm Assistant template "+(label||"A").toUpperCase()+" — set one in am_farm, then 🔄", false); return; }
    if(!barb || !barb.id){ toast("barb has no village id", false); return; }
    var vid=vidParam();
    // FarmGod scopes the POST to the origin village by rewriting village=<id>.
    var url=sendUrl.replace(/village=\d+/, "village="+vid);
    if(url.charAt(0)!=="/") url="/"+url.replace(/^.*game\.php/,"game.php");
    var data=new URLSearchParams();
    data.set("target", String(barb.id));
    data.set("template_id", String(tpl.id));
    data.set("source", String(vid));
    toast("farming "+barb.x+"|"+barb.y+" with "+label.toUpperCase()+"…", true);
    fetch(url,{method:"POST",credentials:"include",
      headers:{"X-Requested-With":"XMLHttpRequest","TribalWars-Ajax":"1",
               "Content-Type":"application/x-www-form-urlencoded; charset=UTF-8",
               "Accept":"application/json, text/javascript, */*; q=0.01"},
      body:data.toString()})
      .then(function(r){return r.json().catch(function(){return null;});})
      .then(function(j){
        if(j && (j.error||j.errors)){ toast("farm: "+String(j.error||j.errors).slice(0,80), false); }
        else { toast("✓ farmed "+barb.x+"|"+barb.y+" ("+label.toUpperCase()+")", true); setTimeout(softRefresh,600); }
      }).catch(function(e){ toast("farm failed: "+e, false); });
  }

  function flash(){ var b; try{b=sessionStorage.getItem("twnl_flash");sessionStorage.removeItem("twnl_flash");}catch(e){}
    if(!b)return; var row=document.getElementById("main_buildrow_"+b); if(!row)return;
    var on=false,n=0,iv=setInterval(function(){row.style.background=(on=!on)?"#ffe08a":"";if(++n>6){clearInterval(iv);row.style.background="";}},350);
    row.scrollIntoView({block:"center"});
  }

  flash(); render();
  Promise.all([fetchScavAndTroops(), fetchQueue(), fetchBarbs(), fetchTrainTime(), fetchFarmTemplates()]).then(render);
  console.log("[noble-guide] loaded, "+TL.length+" timeline steps");
})();
