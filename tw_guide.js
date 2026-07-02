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
  [0,"scavenge",1,0.0,25,30,25,0,5,281,1,475,470,475],
  [1,"main",2,0.02,113,102,88,6,11,281,1,512,518,487],
  [1,"main",3,0.06,143,130,111,7,18,281,1,520,539,477],
  [1,"barracks",1,0.08,200,170,90,7,25,281,1,470,519,487],
  [1,"wood",1,0.1,50,60,40,5,30,281,1,570,609,547],
  [1,"stone",1,0.12,65,50,40,10,40,281,1,656,709,607],
  [1,"iron",1,0.13,75,65,70,10,50,281,1,731,795,637],
  [1,"wood",2,0.15,62,76,50,6,56,281,1,820,870,688],
  [1,"wood",3,0.19,78,98,62,7,63,281,1,895,924,728],
  [1,"stone",2,0.21,83,63,50,11,74,281,1,963,1011,779],
  [1,"stone",3,0.25,105,80,62,13,87,281,1,1010,1084,819],
  [1,"storage",2,0.27,76,64,50,0,87,281,1,1086,1171,870],
  [1,"wood",4,0.34,98,124,77,8,95,281,1,1142,1202,896],
  [1,"wood",5,0.45,122,159,96,9,104,281,1,1179,1200,905],
  [1,"wood",6,0.59,153,202,120,10,114,281,1,1188,1157,892],
  [1,"iron",2,0.61,94,83,87,12,126,281,1,1246,1225,906],
  [1,"iron",3,0.66,118,106,108,14,140,281,1,1283,1273,901],
  [1,"stone",4,0.73,133,101,76,15,155,281,1,1308,1327,930],
  [1,"storage",3,0.78,96,81,62,0,155,281,1,1366,1399,970],
  [1,"stone",5,0.88,169,128,95,17,172,281,1,1358,1429,983],
  [1,"stone",6,1.02,215,162,117,19,191,281,1,1307,1429,975],
  [1,"wood",7,1.21,191,258,149,12,203,281,1,1285,1340,938],
  [1,"wood",8,1.44,238,329,185,14,217,281,1,1225,1185,868],
  [1,"stone",7,1.62,273,205,145,22,239,281,1,1127,1149,836],
  [1,"farm",2,1.64,58,53,39,0,239,330,1,1221,1248,898],
  [1,"stone",8,1.88,346,259,180,25,264,330,1,1057,1166,833],
  [1,"wood",9,2.17,298,419,231,16,280,330,1,950,937,721],
  [1,"wood",10,2.52,373,534,287,18,298,330,1,784,603,558],
  [1,"farm",3,2.58,76,70,50,0,298,386,1,867,690,611],
  [1,"stone",9,2.87,440,328,224,29,327,386,1,632,552,506],
  [1,"stone",10,3.23,559,415,277,33,360,386,1,290,344,353],
  [1,"farm",4,3.32,99,92,64,0,360,453,1,358,419,395],
  [1,"iron",4,3.4,147,135,133,16,376,453,1,377,450,368],
  [1,"iron",5,3.52,184,172,165,19,395,453,1,366,451,312],
  [1,"farm",5,3.67,129,121,83,0,395,531,1,413,507,342],
  [1,"iron",6,3.83,231,219,205,22,417,531,1,364,469,251],
  [1,"wood",11,5.42,466,681,358,21,438,531,1,344,234,155],
  [1,"stone",11,7.72,709,525,344,37,475,531,1,286,289,145],
  [1,"farm",6,7.9,167,160,107,0,475,622,1,309,319,157],
  [1,"iron",7,9.07,289,279,254,26,501,622,1,426,446,123],
  [1,"iron",8,10.99,362,356,316,30,531,622,1,632,658,133],
  [1,"farm",7,11.28,217,212,138,0,531,729,1,627,658,134],
  [1,"wood",12,14.08,582,868,446,24,555,729,1,807,552,176],
  [1,"stone",12,16.44,901,664,426,42,597,729,1,653,552,175],
  [1,"wood",13,19.87,728,1107,555,28,625,729,1,941,462,193],
  [1,"farm",8,20.18,282,279,178,0,625,855,1,900,411,157],
  [1,"iron",9,22.23,453,454,391,35,660,855,1,1200,625,149],
  [1,"storage",4,23.61,121,102,77,0,660,855,1,1635,1023,394],
  [1,"stone",13,25.12,1144,840,529,48,708,855,1,1087,717,207],
  [1,"iron",10,27.3,567,579,485,41,749,855,1,1310,928,170],
  [1,"farm",9,28.01,367,369,230,0,749,1002,1,1301,917,173],
  [1,"storage",5,30.31,154,130,96,0,749,1002,1,1973,1613,607],
  [1,"wood",14,31.57,909,1412,691,33,782,1002,1,1586,723,253],
  [1,"stone",14,34.54,1453,1062,655,55,837,1002,1,1298,684,252],
  [1,"iron",11,36.95,710,738,602,48,885,1002,1,1562,919,201],
  [1,"farm",10,37.87,477,487,297,0,885,1175,1,1548,896,204],
  [1,"storage",6,40.48,194,165,120,0,885,1175,1,2399,1776,754],
  [1,"wood",15,41.96,1137,1800,860,38,923,1175,1,1917,630,316],
  [1,"stone",15,45.23,1846,1343,813,63,986,1175,1,1521,554,315],
  [1,"storage",7,48.99,246,210,149,0,986,1175,1,2924,1993,1087],
  [1,"wood",16,50.94,1421,2295,1071,43,1029,1175,1,2429,625,541],
  [1,"farm",11,51.58,620,642,383,0,1029,1377,1,2255,388,398],
  [1,"iron",12,53.83,889,941,746,56,1085,1377,1,2556,492,242],
  [1,"storage",8,56.38,311,266,185,0,1085,1377,1,3569,1388,800],
  [1,"stone",16,58.39,2344,1700,1008,71,1156,1377,1,2307,641,403],
  [0,"scavenge",2,63.23,250,300,250,0,1168,1377,2,3691,2214,1256],
  [1,"farm",12,64.91,806,848,494,0,1171,1614,2,3721,2263,1316],
  [0,"scavenge",3,67.55,1000,1200,1000,0,1242,1614,3,620,382,504],
  [2,"recruit",100,76.83,0,0,0,0,1365,1614,3,1582,3858,4557],
  [2,"recruit",200,76.83,0,0,0,0,1365,1614,3,1582,3858,4557],
  [1,"storage",9,76.83,393,338,231,0,1365,1614,3,1582,3858,4557],
  [1,"farm",13,78.12,1048,1119,637,0,1373,1893,3,1416,3782,4805],
  [1,"storage",10,79.77,498,430,287,0,1393,1893,3,1736,4569,5740],
  [1,"storage",11,82.5,630,546,358,0,1435,1893,3,1668,5426,7003],
  [2,"recruit",300,85.32,0,0,0,0,1509,1893,3,1126,4214,7226],
  [1,"wood",17,85.32,1776,2926,1333,50,1509,1893,3,1126,4214,7226],
  [1,"iron",13,86.11,1113,1200,925,66,1575,1893,3,1099,4039,7110],
  [1,"storage",12,88.47,796,693,446,0,1604,1893,3,1700,5141,8593],
  [1,"farm",14,89.73,1363,1477,822,0,1610,2219,3,1205,4555,8519],
  [1,"storage",13,92.98,1007,880,555,0,1658,2219,3,1334,5521,10174],
  [2,"recruit",400,97.47,0,0,0,0,1732,2219,3,1480,6957,12712],
  [1,"storage",14,97.47,1274,1118,691,0,1732,2219,3,1480,6957,12712],
  [2,"recruit",500,102.77,0,0,0,0,1823,2219,3,1564,8646,15842],
  [1,"storage",15,102.77,1612,1420,860,0,1823,2219,3,1564,8646,15842],
  [2,"recruit",600,107.15,0,0,0,0,1889,2602,3,1624,9510,18130],
  [1,"farm",15,107.15,1772,1950,1060,0,1889,2602,3,1624,9510,18130],
  [1,"storage",16,110.28,2039,1803,1071,0,1925,2602,3,1236,9837,19332],
  [2,"recruit",700,127.41,0,0,0,0,2272,2602,3,1705,16216,27184],
  [2,"recruit",800,127.41,0,0,0,0,2272,2602,3,1705,16216,27184],
  [2,"recruit",900,127.41,0,0,0,0,2272,2602,3,1705,16216,27184],
  [2,"recruit",1000,127.41,0,0,0,0,2272,2602,3,1705,16216,27184],
  [1,"storage",17,127.41,2580,2290,1333,0,2272,2602,3,1705,16216,27184],
  [1,"farm",16,129.06,2303,2574,1368,0,2272,3050,3,1950,16064,27911],
  [1,"storage",18,132.19,3264,2908,1659,0,2272,3050,3,2775,17004,29523],
  [1,"stone",17,134.02,2977,2150,1250,81,2353,3050,3,2876,17791,30854],
  [1,"iron",14,134.98,1393,1529,1147,77,2430,3050,3,2154,16933,30091],
  [1,"wood",18,136.8,2220,3731,1659,58,2488,3050,3,2063,15331,30154],
  [1,"stone",18,139.3,3781,2720,1550,93,2581,3050,3,2247,16359,31809],
  [1,"iron",15,140.47,1744,1950,1422,90,2671,3050,3,2639,16544,32138],
  [1,"farm",17,142.97,2994,3398,1764,0,2671,3576,3,2360,15861,32469],
  [1,"iron",16,144.41,2183,2486,1764,105,2776,3576,3,2474,15673,32626],
  [1,"iron",17,146.38,2734,3170,2187,123,2899,3576,3,2127,14889,32451],
  [1,"iron",18,148.77,3422,4042,2712,144,3043,3576,3,2597,14739,33374],
  [1,"farm",18,152.2,3893,4486,2276,0,3043,4192,3,3253,14802,35597],
  [1,"smith",1,152.26,220,180,240,20,3063,4192,3,3219,14809,35494],
  [1,"market",1,152.29,100,100,100,20,3083,4192,3,3290,14880,35515],
  [1,"smith",2,152.35,277,229,302,23,3106,4192,3,3200,14837,35349],
  [1,"smith",3,152.6,349,293,381,27,3133,4192,3,3157,14851,35225],
  [1,"market",2,152.63,126,127,126,23,3156,4192,3,3202,14895,35219],
  [1,"main",4,152.71,180,166,140,8,3164,4192,3,3219,14926,35226],
  [1,"smith",4,153.14,440,373,480,32,3196,4192,3,4450,16224,36368],
  [1,"main",5,153.24,227,211,176,9,3205,4192,3,4436,16225,36354],
  [1,"smith",5,153.85,555,476,605,37,3242,4192,3,4412,16280,36230],
  [1,"market",3,153.96,159,163,159,27,3269,4192,3,4471,16335,36239],
  [1,"main",6,154.08,286,270,222,11,3280,4192,3,4413,16293,36195],
  [1,"smith",6,154.88,699,606,762,44,3324,4192,3,4665,16638,36334],
  [1,"main",7,155.03,360,344,280,13,3337,4192,3,4554,16544,36253],
  [1,"smith",7,156.02,880,773,960,51,3388,4192,3,5134,17231,36703],
  [1,"market",4,156.18,200,207,200,32,3420,4192,3,5188,17278,36708],
  [1,"main",8,156.38,454,438,353,15,3435,4192,3,6254,18360,37825],
  [1,"smith",8,157.57,1109,986,1210,60,3495,4192,3,6347,18575,37766],
  [1,"main",9,157.79,572,559,445,18,3513,4192,3,6066,18307,37562],
  [1,"smith",9,159.22,1398,1257,1525,70,3583,4192,3,6404,18787,37724],
  [1,"farm",19,161.32,5060,5921,2936,0,3583,4914,3,4370,15891,37763],
  [1,"market",5,161.55,252,264,252,37,3620,4914,3,5103,16612,38446],
  [1,"main",10,161.82,720,712,560,21,3641,4914,3,4700,16217,38153],
  [1,"smith",10,163.51,1761,1603,1921,82,3723,4914,3,5398,17073,38641],
  [1,"main",11,163.82,908,908,706,24,3747,4914,3,4838,16514,38233],
  [1,"smith",11,165.81,2219,2043,2421,96,3843,4914,3,5011,16862,38154],
  [1,"market",6,166.09,318,337,318,44,3887,4914,3,6270,18102,39363],
  [1,"main",12,166.46,1144,1158,890,28,3915,4914,3,5506,17324,38803],
  [1,"smith",12,168.78,2796,2605,3050,112,4027,4914,3,5310,17319,38303],
  [1,"main",13,169.2,1441,1476,1121,33,4060,4914,3,5535,17509,38798],
  [1,"smith",13,171.9,3523,3322,3843,132,4192,4914,3,4852,17027,37745],
  [1,"farm",20,174.76,6579,7816,3787,0,4192,5760,3,2462,13401,38098],
  [1,"market",7,175.09,400,430,400,51,4243,5760,3,2421,13329,38006],
  [1,"main",14,175.59,1816,1882,1412,38,4281,5760,3,2318,13160,38257],
  [1,"smith",14,180.65,4439,4236,4842,154,4435,5760,3,3751,14797,39237],
  [1,"main",15,181.22,2288,2400,1779,45,4480,5760,3,2667,13601,38613],
  [1,"smith",15,187.05,5593,5400,6101,180,4660,5760,3,4676,15803,39740],
  [1,"market",8,187.43,504,548,504,60,4720,5760,3,5257,16339,40271],
  [1,"main",16,188.1,2883,3060,2242,53,4773,5760,3,2941,13847,38546],
  [1,"smith",16,195.28,7047,6885,7687,211,4984,5760,3,6286,17353,39764],
  [1,"farm",21,199.48,8552,10317,4886,0,4984,6752,3,3074,12376,39353],
  [1,"main",17,200.68,3632,3902,2825,62,5046,6752,3,1032,10065,38069],
  [1,"smith",17,211.17,8879,8779,9686,247,5293,6752,3,6871,16003,38172],
  [1,"market",9,211.6,635,698,635,70,5363,6752,3,6657,15727,37909],
  [1,"main",18,212.48,4577,4975,3560,72,5435,6752,3,3089,11760,35307],
  [0,"scavenge",4,217.07,10000,12000,10000,0,5435,6752,4,152,6824,31217],
  [1,"smith",18,231.03,11187,11193,12204,289,5724,6752,4,9457,16123,38068],
  [1,"main",19,232.04,5767,6343,4485,84,5808,6752,4,4713,10802,34556],
  [1,"farm",22,238.69,11118,13618,6302,0,5808,7916,4,4144,7733,38753],
  [1,"smith",19,251.47,14096,14271,15377,338,6146,7916,4,10431,13846,36219],
  [1,"market",10,251.96,800,890,800,82,6228,7916,4,10325,13650,36063],
  [1,"main",20,253.13,7266,8087,5651,99,6327,7916,4,4500,7004,31803],
  [1,"smith",20,268.6,17761,18196,19375,395,6722,7916,4,11370,13438,32831],
  [1,"snob",1,278.98,15000,25000,10000,80,6802,7916,4,12369,4437,35167],
  ];
  var T_TYPE=0,T_B=1,T_LV=2,T_AT=3,T_CW=4,T_CS=5,T_CI=6,T_CP=7,T_PU=8,T_PC=9,T_TIER=10,T_EW=11,T_ES=12,T_EI=13;

  var NOBLE_H=298.4;
  var SCAV_LOOT={1:0.10,2:0.25,3:0.50,4:0.75};
  var DUR_EXP=0.45, DUR_INITIAL=1800.0, DUR_FACTOR=0.7722074896557402;
  var CARRY={spear:25,sword:15,axe:10,archer:10,light:80,marcher:50,heavy:50,spy:0,ram:0,catapult:0,knight:100};
  var BLABEL={main:"Hauptgebäude",place:"Versammlungsplatz",barracks:"Kaserne",smith:"Schmiede",
    market:"Marktplatz",wood:"Holzfäller",stone:"Lehmgrube",iron:"Eisenmine",farm:"Bauernhof",
    storage:"Speicher",snob:"Adelshof",hide:"Versteck",wall:"Wall"};
  // Building prerequisites (standard TW / de256). The guide checks these against
  // your LIVE levels before offering a build, so it never shows a step the game
  // would reject with "Bauen nicht möglich" (e.g. Wall needs Kaserne 1). If a
  // step's prereqs aren't met it shows "⏳ waiting for X" instead of a dead BUILD
  // button. Effective level counts QUEUED builds too (so it clears the moment you
  // queue the prereq, not when it finishes).
  var PREREQ={ barracks:{main:3}, wall:{barracks:1}, smith:{main:3,barracks:1},
    market:{main:3}, stable:{main:10,barracks:5,smith:5}, snob:{main:20,smith:20,market:10},
    hide:{main:1} };
  function missingPrereq(lv,b){
    var need=PREREQ[b]; if(!need) return null;
    var keys=Object.keys(need);
    for(var i=0;i<keys.length;i++){ var k=keys[i];
      if(effLevel(lv,k) < need[k]) return {b:k, lvl:need[k], have:effLevel(lv,k)}; }
    return null;
  }

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
  // TOTAL spears for goal-checking = OWN troops (home + everywhere out) + QUEUE.
  //
  // The trap we kept hitting: most "spear" numbers DROP when troops leave the
  // village. The barracks "Insgesamt" (4/84) and the scavenge JSON home count
  // both only see troops PRESENT — send some farming/scavenging and the count
  // falls, so the guide wrongly tells you to re-recruit. The ONLY number that
  // stays put regardless of where troops are is the overview "eigene/own" column
  // (overview_villages&mode=units → __twnl_spear_own): it counts every spear you
  // OWN, home or out (scavenging, farming, attacking). That's the real total.
  // Add the training QUEUE (not yet in "own") so spears on the way also count.
  // Fallback if the overview read failed (own null): home + out(scav) + queue.
  function totalSpears(){
    var real;
    if(typeof W.__twnl_spear_own==="number" && W.__twnl_spear_own!==null){
      real=W.__twnl_spear_own + (W.__twnl_spear_q||0);   // own (home+out) + queue
    } else {
      var home=(troopsHome()||{}).spear||0;           // scavenge JSON home count
      var out=(W.__twnl_scav_out||{}).spear||0;       // out scavenging (only)
      var q=W.__twnl_spear_q||0;                       // training queue
      real=home+out+q;                                 // fallback sum
    }
    var tgt=W.__twnl_spear_target||0;
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
      if(typ===0){ var uT=(typeof W.__twnl_scav_unlocking==="number")?W.__twnl_scav_unlocking:scavTiers();
                   if(Math.max(scavTiers(),uT)<row[T_LV]) return i; }
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
  // format a DURATION in seconds as the game shows it (H:MM:SS or M:SS / Ns)
  function fmtDur(s){ s=Math.round(s); var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
    if(h>0)return h+"h"+(m<10?"0":"")+m+"m"; if(m>0)return m+"m"+(sec<10?"0":"")+sec+"s"; return sec+"s"; }

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
        // ALSO track a tier that is mid-unlock (locked but its unlock timer is
        // running). The step should ADVANCE the moment you START the unlock, not
        // sit on "unlock tier N" for the whole ~1h timer — same idea as builds
        // advancing when QUEUED. unlockN = highest contiguous tier that's either
        // unlocked OR currently unlocking.
        var unlockN=n;
        for(var tj=n+1;tj<=4;tj++){ var oj=opts[tj]||opts[String(tj)];
          if(oj && !unlocked(oj) && parseFloat(oj.unlock_time||0)>0){ unlockN=tj; } else break; }
        W.__twnl_scav_unlocking=unlockN;
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
        // MERGE with optimistic bumps (doBuild recorded builds we just queued).
        // On the APP the HTML parse above finds NOTHING (different markup), so
        // without this merge the optimistic count is wiped and the step snaps
        // back — the "app doesn't advance" bug. Keep the MAX of parsed vs
        // optimistic per building. Optimistic entries are cleared in render()
        // once your real level reaches the plan's target for that step.
        var optq=W.__twnl_optq||{};
        Object.keys(optq).forEach(function(sl){ if((optq[sl]||0)>(qb[sl]||0)){ qb[sl]=optq[sl]; used=Math.max(used, Object.keys(qb).reduce(function(a,k){return a+qb[k];},0)); } });
        W.__twnl_qused=Math.max(used, W.__twnl_qused||0, Object.keys(qb).reduce(function(a,k){return a+qb[k];},0));
        W.__twnl_qbuild=qb;   // {slug: countInQueue} (parsed ⊔ optimistic)
        // ── REAL build DURATIONS straight from the game (the numbers you see on
        // the Hauptgebäude screen, e.g. "0:00:06"). We DON'T trust a build-time
        // formula (this world's buildtime_formula=2 + a 6s floor doesn't match any
        // standard formula) — we read the game's own shown duration per building
        // row, so the guide's ETA/timing is exactly what the game will do.
        // Each buildable row is <tr id="main_buildrow_<slug>"> and contains the
        // upgrade duration as HH:MM:SS (or H:MM:SS) somewhere in the row.
        var dur={}, rowRe=/id="(?:main_)?buildrow_([a-z_]+)"([\s\S]*?)<\/tr>/gi, rm;
        while((rm=rowRe.exec(h))){
          var slug=rm[1].toLowerCase(), rowHtml=rm[2];
          // the build-time cell: the FIRST H:MM:SS in the row that isn't a clock
          // "finish at" time. TW puts the duration in a cell before the build
          // button; grab the first \d+:\d\d:\d\d match.
          var tm=rowHtml.match(/(\d+):([0-5]\d):([0-5]\d)/);
          if(tm){ dur[slug]=(+tm[1])*3600+(+tm[2])*60+(+tm[3]); }
        }
        W.__twnl_builddur=dur;   // {slug: seconds} — REAL game durations
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
  // Read the OWN spear total (home + everywhere out) from the overview units
  // screen, and the in-training count from the barracks queue.
  //
  // Why the overview: the barracks "Insgesamt" and the scavenge-JSON home count
  // both only see troops PRESENT in the village, so they DROP when you send
  // troops farming/scavenging — making the guide re-ask for spears you already
  // have. The overview "mode=units" page lists, per unit, the rows:
  //   "Im Dorf" (home) · "Auswärts" (away) · "Unterwegs" (in transit) ·
  //   "Gesamt"/"Befehle" (own total).  We sum Im Dorf + Auswärts (= every spear
  //   you OWN, wherever it is) so the number is STABLE no matter where troops
  //   are. (We avoid "Unterwegs"/incoming support so foreign troops don't count.)
  function fetchOwnTroops(){
    return fetch("/game.php?village="+vid()+"&screen=overview_villages&mode=units",{credentials:"include"})
      .then(function(r){return r.text();}).then(function(h){
        W.__twnl_spear_own=null;
        // The units overview marks each count cell with the unit slug, e.g.
        // class="unit-item unit-item-spear" (single-village view) or a per-unit
        // <td> under a spear column header. Strategy: find the SPEAR column,
        // then sum the "own/home + away" rows for that column.
        //
        // Robust approach that works on both single- and multi-village layouts:
        // grab every spear-tagged count cell, and take the cell belonging to the
        // OWN-troops row. TW tags the own-troops row id="units_home"/"own" and the
        // away row id="units_away"; their spear cells carry unit-item-spear.
        var own=null, away=0, gotOwn=false, gotAway=false;
        // Map spear count cells to their containing row id by scanning rows:
        var rowRe=/<tr[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/gi, rm;
        while((rm=rowRe.exec(h))){
          var rid=rm[1].toLowerCase(), rb=rm[2];
          var cm=rb.match(/unit-item-spear[^>]*>\s*([\d.]+)/i);
          if(!cm) continue;
          var val=parseInt(cm[1].replace(/\D/g,""),10)||0;
          if(/own|home|in_village|dorf/.test(rid)){ own=(own||0)+val; gotOwn=true; }
          else if(/away|aus/.test(rid)){ away+=val; gotAway=true; }
        }
        if(gotOwn){ W.__twnl_spear_own=own + (gotAway?away:0); }
        else {
          // Fallback: label-based rows ("Im Dorf"/"Auswärts") in a units table.
          // Find the spear column index from the header, then read those rows.
          var sp=null, ap=0;
          var domGet=function(label){
            var re=new RegExp("<tr[^>]*>\\s*<t[dh][^>]*>\\s*"+label+"[\\s\\S]*?<\\/tr>","i");
            var m=re.exec(h); if(!m) return null;
            var nums=(m[0].match(/>\s*(\d+)\s*</g)||[]).map(function(x){return parseInt(x.replace(/\D/g,""),10)||0;});
            return nums;
          };
          var homeRow=domGet("Im Dorf")||domGet("Eigene"), awayRow=domGet("Ausw");
          // spear is the FIRST unit column in TW; take index 0 of the number list
          if(homeRow&&homeRow.length){ sp=homeRow[0]; }
          if(awayRow&&awayRow.length){ ap=awayRow[0]; }
          if(sp!==null){ W.__twnl_spear_own=sp+ap; }
        }
      }).catch(function(){ W.__twnl_spear_own=null; });
  }
  // In-training spears from the barracks queue (added to "own" in totalSpears so
  // troops still training also count toward the goal). Queue rows render as
  // "<N> Speerträger" (count BEFORE the name) — that's how we tell them apart
  // from the recruit row, which is name-first.
  function fetchBarracksQ(){
    if((liveLevels().barracks||0)<1){ W.__twnl_spear_q=0; return Promise.resolve(); }
    return fetch("/game.php?village="+vid()+"&screen=barracks",{credentials:"include"})
      .then(function(r){return r.text();}).then(function(h){
        var q=0, re=/(\d+)\s*Speertr(?:ä|&auml;)ger/gi, mq;
        while((mq=re.exec(h))) q+=parseInt(mq[1],10)||0;
        W.__twnl_spear_q=q;
      }).catch(function(){ W.__twnl_spear_q=0; });
  }
  function refreshAll(){ GD=W.game_data||GD; W.__twnl_farm_sent={}; return Promise.all([fetchScav(),fetchQueue(),fetchBarbs(),fetchFarmTpl(),fetchBarracksQ(),fetchOwnTroops()]).then(render); }

  // ── ACTIONS (markup-independent AJAX; same request the game makes) ───────
  function toast(msg,good){
    var p=document.getElementById("twng"); if(!p) return;
    var el=document.getElementById("twng_toast");
    if(!el){ el=document.createElement("div"); el.id="twng_toast"; el.style.cssText="margin:6px 0;padding:5px 7px;border-radius:5px;font-size:11px";
      p.insertBefore(el, p.children[1]||null); }
    el.style.background=good?"#d7e9c8":"#f6d3d3"; el.style.color=good?"#2a6":"#a00"; el.textContent=msg;
  }
  // Optimistically record that we just queued `b` — bumps the queued-count so
  // effLevel() counts it and the step ADVANCES immediately, WITHOUT parsing the
  // build-queue HTML (which differs on the app skin — the reason the app didn't
  // advance after building). fetchQueue's real parse will confirm/replace this
  // on the next refresh (desktop); on the app this optimistic bump is what makes
  // the step move on. Keyed per (building) as a count; cleared once the real
  // level catches up in render.
  function bumpQueued(b){
    W.__twnl_qbuild=W.__twnl_qbuild||{}; W.__twnl_qbuild[b]=(W.__twnl_qbuild[b]||0)+1;
    W.__twnl_qused=(W.__twnl_qused||0)+1;
    W.__twnl_optq=W.__twnl_optq||{}; W.__twnl_optq[b]=(W.__twnl_optq[b]||0)+1;
    // remember the live level at bump time so we can clear the optimistic count
    // once the real build finishes (live level rises past it).
    W.__twnl_optbase=W.__twnl_optbase||{};
    if(W.__twnl_optbase[b]===undefined) W.__twnl_optbase[b]=(liveLevels()[b]||0);
  }
  // Drop optimistic bumps that the real game has now caught up on (build done):
  // if live level >= base + optimistic count, the builds landed → clear.
  function reconcileOptimistic(){
    var opt=W.__twnl_optq||{}, base=W.__twnl_optbase||{}, lv=liveLevels();
    Object.keys(opt).forEach(function(b){
      if((lv[b]||0) >= (base[b]||0)+(opt[b]||0)){ delete opt[b]; delete base[b]; }
    });
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
          bumpQueued(b); toast("✓ queued "+(BLABEL[b]||b)+" "+lvl,true); render(); setTimeout(refreshAll,700); });
    }
    fetch(mu,{credentials:"include"}).then(function(r){return r.text();}).then(function(h){
      var cm=h.match(/csrf_token\s*[:=]\s*['"]([a-f0-9]+)['"]/i)||h.match(/"csrf"\s*:\s*"([a-f0-9]+)"/i)||h.match(/&h=([a-f0-9]+)/i); if(cm)W.__twnl_csrf=cm[1];
      var BAD=/\b(premium|instant|kurzbau|buy)\b/i, link=null, hm, hre=/href="([^"]*action=upgrade[^"]*)"/gi;
      while((hm=hre.exec(h))){ var href=hm[1].replace(/&amp;/g,"&"); var idm=href.match(/[?&]id=([a-z_]+)/i); var tym=href.match(/[?&]type=([a-z_]+)/i);
        if(!idm||idm[1].toLowerCase()!==b)continue; if(tym&&BAD.test(tym[1]))continue; link=href; break; }
      if(link){ if(link.charAt(0)!=="/")link="/"+link.replace(/^.*game\.php/,"game.php");
        return fetch(link,{credentials:"include"}).then(function(){ bumpQueued(b); toast("✓ queued "+(BLABEL[b]||b)+" "+lvl,true); render(); setTimeout(refreshAll,700); }); }
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
    reconcileOptimistic();   // clear optimistic build bumps the game has finished
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
      // Premium build queue on de256 = 1 building constructs + up to 4 queued = 5
      // total. So DON'T block until the whole 5-deep queue is full — stacking
      // builds means construction never waits on your next click.
      var qFull=qUsed>=5;   // full 5-deep premium queue occupied
      // PREREQ GUARD: never offer a build the game would reject (e.g. Wall needs
      // Kaserne 1). If your LIVE levels don't meet the prereq, show "waiting for
      // X" and disable the button — the plan is prereq-valid, but this protects
      // against your live state diverging from it (partial builds, manual play).
      var pm=missingPrereq(lv,b);
      // REAL build time from the game (scraped off the main screen), not a formula.
      var realDur=(W.__twnl_builddur||{})[b];
      var durStr=(typeof realDur==="number")?" · ⏱ "+fmtDur(realDur):"";
      step.innerHTML="<div style='font-size:10px;opacity:.6'>"+stepN+" · NEXT</div>"+
        "<div style='font-size:16px;font-weight:bold;margin:2px 0'>🏗️ "+(BLABEL[b]||b)+" → "+lvl+"</div>"+
        "<div style='font-size:11px;opacity:.7'>cost "+cw+"/"+cs+"/"+ci+(cp?" · "+cp+" pop":"")+durStr+"</div>"+
        (pm?"<div style='color:#b00;font-size:12px;margin-top:3px'>⛔ needs "+(BLABEL[pm.b]||pm.b)+" "+pm.lvl+" first (you have "+pm.have+") — build that</div>"
          :qFull?"<div style='font-size:12px;margin-top:3px;opacity:.8'>⏳ both build slots busy — finishing queued builds first</div>"
          :popBlock?"<div style='color:#b00;font-size:12px;margin-top:3px'>⚠ pop-capped — a Bauernhof step should come first</div>"
          :ok?"<div style='color:#2a8;font-size:12px;margin-top:3px;font-weight:bold'>✓ affordable — build it now</div>"
              :"<div style='font-size:12px;margin-top:3px;opacity:.8'>⏳ need more "+(r.wood<cw?"wood ":"")+(r.stone<cs?"clay ":"")+(r.iron<ci?"iron":"")+"— keep scavenging</div>");
      var canBuild=ok&&!popBlock&&!qFull&&!pm;
      var go=document.createElement("div"); go.style.cssText="margin-top:7px;text-align:center;padding:7px;border-radius:5px;cursor:pointer;font-weight:bold;"+(canBuild?"background:#5a9;color:#fff":"background:#ddd;color:#777");
      go.textContent=AUTO_BUILD?(canBuild?"⚡ BUILD NOW":(pm?"needs "+(BLABEL[pm.b]||pm.b)+" "+pm.lvl:(qFull?"queue full":"build (not ready)"))):"→ open & build";
      go.onclick=function(){ if(canBuild) doBuild(b,lvl); };
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
        "<div style='font-size:11px;opacity:.7'>have "+haveSp+
          ((typeof W.__twnl_spear_own==="number"&&W.__twnl_spear_own!==null&&(W.__twnl_spear_q||0)>0)
            ?" ("+W.__twnl_spear_own+" owned + "+(W.__twnl_spear_q||0)+" in queue)":"")+
          ", plan wants "+lvl+" · feeds scavenge carry</div>"+
        (popFull?"<div style='color:#b00;font-size:12px;margin-top:3px'>⚠ pop full — build a Bauernhof first</div>"
          :canNow>0?"<div style='color:#2a8;font-size:12px;margin-top:3px;font-weight:bold'>✓ recruit "+canNow+" now"+(canNow<nNeed?" ("+(nNeed-canNow)+" more once affordable)":"")+"</div>"
              :"<div style='font-size:12px;margin-top:3px;opacity:.8'>⏳ save "+(nNeed*spearCost.w)+"/"+(nNeed*spearCost.s)+"/"+(nNeed*spearCost.i)+" — keep scavenging</div>");
      var go3=document.createElement("div"); go3.style.cssText="margin-top:7px;text-align:center;padding:7px;border-radius:5px;cursor:pointer;font-weight:bold;"+(canNow>0?"background:#b97;color:#fff":"background:#ddd;color:#777");
      go3.textContent=AUTO_BUILD?(canNow>0?"⚡ RECRUIT "+canNow:"recruit (not ready)"):"→ open barracks";
      go3.onclick=function(){ if(canNow>0) doRecruit(haveSp+canNow); };
      step.appendChild(go3);
      // MANUAL-TRUST override: the auto-count can be off (troops out / queue not
      // read). If you ALREADY have enough spears, tap this to mark the step done
      // and move on. The guide trusts you over its own count.
      var skipR=document.createElement("div"); skipR.style.cssText="margin-top:5px;text-align:center;font-size:10px;color:#36c;cursor:pointer";
      skipR.textContent="✓ I already have "+lvl+"+ spears — skip this step";
      skipR.onclick=function(){ W.__twnl_spear_target=Math.max(W.__twnl_spear_target||0, lvl); render(); };
      step.appendChild(skipR);
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
    // NOTE: the "~Xh to noble" is a rough PLAN estimate (from the optimizer's
    // timeline). The per-step ⏱ time shown on the build card above is the REAL
    // game duration (scraped live) — trust that for the current step. The total
    // is dominated by the big late builds (Academy ~102h etc.), so it's a
    // ballpark, marked with "~".
    foot.innerHTML="🪵"+r.wood+" 🧱"+r.stone+" ⚙️"+r.iron+" · pop "+r.pop+"/"+r.popMax+
      "<br>~"+Math.round(etaH)+"h to noble <span style='opacity:.6'>(plan est.)</span>"+drift;
    p.appendChild(foot);

    // skip override (in case auto-detect lags)
    var skip=document.createElement("div"); skip.style.cssText="margin-top:5px;font-size:10px;opacity:.5;display:flex;justify-content:space-between";
    var sk=document.createElement("span"); sk.textContent="✓ mark done / skip →"; sk.style.cssText="cursor:pointer";
    sk.onclick=function(){ W.__twng_skip=(W.__twng_skip||0); /* nudge past current step visually */
      W.__twng_force=idx+1; render(); };
    skip.appendChild(sk); p.appendChild(skip);

    document.body.appendChild(p);
  }

  // Render now; if document.body or game_data isn't ready yet (can happen in the
  // app webview at script-load), retry a few times so the panel always appears.
  function safeRender(){ try{ if(document.body) render(); }catch(e){ console.error("[noble-guide] render error:",e); } }
  safeRender();
  var tries=0, iv=setInterval(function(){
    tries++;
    if(document.getElementById("twng")||tries>10){ clearInterval(iv); }
    else safeRender();
  }, 500);
  Promise.all([fetchScav(),fetchQueue(),fetchBarbs(),fetchFarmTpl(),fetchBarracksQ(),fetchOwnTroops()]).then(safeRender).catch(function(e){console.error("[noble-guide] fetch error:",e);});
  console.log("[noble-guide] "+TL.length+" steps loaded; panel:", !!document.getElementById("twng"));
})();
