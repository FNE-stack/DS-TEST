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
  [1,"main",1,0.15,90,80,70,5,5,240,0,551,531,501],
  [1,"hide",1,0.45,50,60,50,2,7,240,0,654,624,554],
  [1,"hide",2,0.81,62,75,62,2,9,240,0,745,702,595],
  [1,"hide",3,1.24,78,94,78,3,12,240,0,820,761,620],
  [1,"hide",4,1.76,98,117,98,3,15,240,0,876,798,626],
  [1,"place",1,1.79,10,40,30,0,19,240,0,904,802,604],
  [0,"scavenge",1,1.79,25,30,25,0,19,240,1,879,772,579],
  [0,"scavenge",2,1.79,250,300,250,0,19,240,2,629,472,329],
  [1,"main",2,1.98,113,102,88,6,25,240,2,668,522,343],
  [1,"main",3,2.18,143,130,111,7,32,240,2,677,544,334],
  [1,"hide",5,2.38,122,146,122,4,39,240,2,628,525,345],
  [1,"barracks",1,2.46,200,170,90,7,47,240,2,527,458,333],
  [1,"barracks",2,2.7,252,218,113,8,52,240,2,629,510,415],
  [1,"wall",1,3.0,50,100,20,5,58,240,2,718,535,492],
  [1,"wall",2,3.35,63,127,25,6,65,240,2,792,525,563],
  [1,"wall",3,3.77,79,163,32,7,73,240,2,845,471,626],
  [1,"storage",1,3.93,60,50,40,0,73,240,2,937,573,688],
  [1,"wood",1,4.08,50,60,40,5,78,240,2,1038,664,749],
  [1,"storage",2,4.26,76,64,50,0,78,240,2,1120,751,800],
  [1,"wall",4,4.28,100,207,40,8,88,240,2,1207,851,860],
  [1,"stone",1,4.4,65,50,40,10,98,240,2,1287,937,891],
  [1,"iron",1,4.45,75,65,70,10,98,240,2,1344,1009,930],
  [1,"storage",3,4.62,96,81,62,0,98,240,2,1381,1065,961],
  [1,"storage",4,4.72,121,102,77,0,104,240,2,1473,1143,1015],
  [1,"wood",2,4.79,62,76,50,6,111,240,2,1549,1199,1057],
  [1,"wood",3,4.92,78,98,62,7,122,240,2,1623,1292,1113],
  [0,"scavenge",3,4.92,1000,1200,1000,0,122,240,3,623,92,113],
  [1,"stone",2,4.96,83,63,50,11,135,240,3,671,164,153],
  [1,"stone",3,5.12,105,80,62,13,143,240,3,733,199,184],
  [1,"wood",4,5.19,98,124,77,8,152,240,3,766,195,191],
  [1,"wood",5,5.4,122,159,96,9,162,240,3,779,157,181],
  [1,"iron",2,5.6,94,83,87,12,174,240,3,852,237,204],
  [1,"wood",6,5.64,153,202,120,10,188,240,3,888,284,198],
  [1,"iron",3,5.83,118,106,108,14,203,240,3,925,345,233],
  [1,"stone",4,5.88,133,101,76,15,220,240,3,910,370,241],
  [1,"farm",1,6.06,45,40,30,0,220,281,3,1034,494,323],
  [1,"stone",5,6.12,169,128,95,17,239,281,3,975,486,310],
  [1,"stone",6,6.4,215,162,117,19,261,281,3,880,456,283],
  [1,"stone",7,6.53,273,205,145,22,261,281,3,985,566,353],
  [1,"farm",2,6.62,58,53,39,0,261,330,3,1069,657,409],
  [1,"farm",3,6.78,76,70,50,0,277,386,3,1089,691,387],
  [1,"iron",4,6.9,147,135,133,16,296,386,3,1066,683,329],
  [1,"iron",5,7.12,184,172,165,19,318,386,3,1008,641,241],
  [1,"iron",6,7.31,231,219,205,22,344,386,3,888,533,103],
  [1,"farm",4,7.62,99,92,64,0,344,453,3,971,629,172],
  [1,"iron",7,7.76,289,279,254,26,356,453,3,944,536,136],
  [1,"wood",7,8.03,191,258,149,12,356,453,3,1122,719,269],
  [1,"wood",8,8.52,238,329,185,14,370,453,3,1091,597,241],
  [1,"stone",8,9.0,346,259,180,25,395,453,3,833,424,135],
  [1,"farm",5,9.08,129,121,83,0,395,531,3,827,425,138],
  [1,"farm",6,9.45,167,160,107,0,395,622,3,1028,626,281],
  [1,"wood",9,10.03,298,419,231,16,411,622,3,960,437,219],
  [1,"wood",10,11.43,373,534,287,18,429,622,3,961,247,197],
  [1,"stone",9,12.61,440,328,224,29,458,622,3,891,231,212],
  [1,"stone",10,14.47,559,415,277,33,491,622,3,830,263,254],
  [1,"wood",11,17.54,466,681,358,21,512,622,3,1089,307,359],
  [1,"stone",11,19.54,709,525,344,37,549,622,3,966,306,351],
  [1,"farm",7,20.08,217,212,138,0,549,729,3,1017,362,377],
  [1,"iron",8,20.67,362,356,316,30,579,729,3,932,283,229],
  [1,"wood",12,24.35,582,868,446,24,603,729,3,1303,368,392],
  [1,"stone",12,26.71,901,664,426,42,645,729,3,1149,368,391],
  [1,"farm",8,27.36,282,279,178,0,645,855,3,1181,404,403],
  [1,"storage",5,30.42,154,130,96,0,645,855,3,1951,1198,829],
  [1,"wood",13,31.62,728,1107,555,28,673,855,3,1676,544,540],
  [1,"iron",9,32.32,453,454,391,35,708,855,3,1579,417,345],
  [1,"stone",13,35.19,1144,840,529,48,756,855,3,1430,455,376],
  [1,"farm",9,35.97,367,369,230,0,756,1002,3,1441,464,370],
  [1,"iron",10,37.52,567,579,485,41,797,1002,3,1482,493,234],
  [1,"storage",6,40.71,194,165,120,0,797,1002,3,2374,1414,810],
  [1,"wood",14,42.15,909,1412,691,33,830,1002,3,2039,576,488],
  [1,"stone",14,45.25,1453,1062,655,55,885,1002,3,1796,575,513],
  [1,"farm",10,46.17,477,487,297,0,885,1175,3,1786,554,489],
  [1,"iron",11,47.78,710,738,602,48,933,1175,3,1776,516,288],
  [1,"storage",7,51.33,246,210,149,0,933,1175,3,2894,1670,1013],
  [1,"wood",15,53.45,1137,1800,860,38,971,1175,3,2631,744,714],
  [1,"stone",15,56.94,1846,1343,813,63,1034,1175,3,2324,745,762],
  [1,"farm",11,58.06,620,642,383,0,1034,1377,3,2299,698,723],
  [2,"recruit",100,69.97,0,0,0,0,1208,1377,3,732,835,2863],
  [1,"wood",16,69.97,1421,2295,1071,43,1208,1377,3,732,835,2863],
  [1,"farm",12,70.28,806,848,494,0,1208,1614,3,227,239,2643],
  [1,"farm",13,71.72,1048,1119,637,0,1264,1893,3,545,413,2703],
  [1,"iron",12,72.3,889,941,746,56,1264,1893,3,1324,1156,3292],
  [1,"storage",8,73.37,311,266,185,0,1269,1893,3,1391,1354,3573],
  [1,"storage",9,73.81,393,338,231,0,1277,1893,3,1360,1455,3720],
  [2,"recruit",200,77.93,0,0,0,0,1336,1893,3,1101,2264,5393],
  [1,"storage",10,77.93,498,430,287,0,1336,1893,3,1101,2264,5393],
  [1,"storage",11,78.62,630,546,358,0,1344,1893,3,1367,2646,5786],
  [1,"storage",12,84.05,796,693,446,0,1422,1893,3,770,3491,7925],
  [1,"storage",13,84.87,1007,880,555,0,1429,1893,3,1367,4176,8581],
  [2,"recruit",300,92.21,0,0,0,0,1546,1893,3,1379,6214,12272],
  [2,"recruit",400,92.21,0,0,0,0,1546,1893,3,1379,6214,12272],
  [1,"storage",14,92.21,1274,1118,691,0,1546,1893,3,1379,6214,12272],
  [2,"recruit",500,97.92,0,0,0,0,1639,1893,3,1650,8172,15772],
  [1,"storage",15,97.92,1612,1420,860,0,1639,1893,3,1650,8172,15772],
  [1,"farm",14,99.84,1363,1477,822,0,1648,2219,3,1378,7843,15948],
  [2,"recruit",600,106.37,0,0,0,0,1733,2219,3,193,8466,18965],
  [1,"storage",16,106.37,2039,1803,1071,0,1733,2219,3,193,8466,18965],
  [1,"storage",17,109.09,2580,2290,1333,0,1804,2219,3,631,9374,20119],
  [1,"stone",16,110.51,2344,1700,1008,71,1854,2219,3,262,7764,19847],
  [1,"iron",13,112.12,1113,1200,925,66,1920,2219,3,1418,8833,20804],
  [1,"wood",17,112.77,1776,2926,1333,50,1920,2219,3,1865,9280,21092],
  [1,"farm",15,115.08,1772,1950,1060,0,1920,2602,3,1328,8116,21587],
  [1,"farm",16,117.09,2303,2574,1368,0,2001,3050,3,190,7650,21632],
  [1,"stone",17,119.52,2977,2150,1250,81,2078,3050,3,2398,9535,23441],
  [1,"iron",14,119.63,1393,1529,1147,77,2136,3050,3,391,6017,21917],
  [1,"wood",18,122.5,2220,3731,1659,58,2136,3050,3,3459,9085,24370],
  [1,"stone",18,125.72,3781,2720,1550,93,2319,3050,3,2077,8278,24576],
  [1,"iron",15,125.97,1744,1950,1422,90,2319,3050,3,2379,8579,24759],
  [1,"wood",19,129.68,2776,4757,2066,67,2386,3050,3,4398,8618,26590],
  [1,"stone",19,133.35,4802,3440,1922,106,2492,3050,3,1722,7286,27140],
  [1,"storage",18,135.63,3264,2908,1659,0,2492,3050,3,780,6778,27455],
  [1,"storage",19,138.99,4128,3693,2066,0,2569,3050,3,1880,5283,28295],
  [1,"wood",20,141.75,3469,6065,2572,77,2674,3050,3,3999,7099,29873],
  [1,"iron",16,141.84,2183,2486,1764,105,2674,3050,3,1233,3918,28245],
  [1,"farm",17,145.07,2994,3398,1764,0,2674,3576,3,1773,3477,29107],
  [1,"farm",18,147.75,3893,4486,2276,0,2674,4192,3,5998,7381,32247],
  [1,"stone",20,152.18,6098,4352,2383,121,2918,4192,3,3814,5976,32567],
  [1,"iron",17,152.62,2734,3170,2187,123,3062,4192,3,1695,3236,30933],
  [1,"iron",18,155.76,3422,4042,2712,144,3231,4192,3,1765,2438,30907],
  [1,"iron",19,159.11,4285,5153,3363,169,3428,4192,3,1191,658,30734],
  [1,"iron",20,163.68,5365,6571,4170,197,3428,4192,3,8730,8197,37676],
  [1,"smith",1,164.57,220,180,240,20,3471,4192,3,9321,8877,38172],
  [1,"smith",2,164.75,277,229,302,23,3491,4192,3,9519,9075,38320],
  [1,"market",1,164.98,100,100,100,20,3514,4192,3,9741,9296,38492],
  [1,"market",2,165.24,126,127,126,23,3541,4192,3,10188,9799,38857],
  [1,"smith",3,166.28,349,293,381,27,3573,4192,3,11545,11223,40124],
  [1,"main",4,166.51,180,166,140,8,3581,4192,3,11713,11405,40282],
  [1,"smith",4,166.79,440,373,480,32,3618,4192,3,11724,11494,40192],
  [1,"smith",5,168.28,555,476,605,37,3618,4192,3,9276,8186,39819],
  [1,"farm",19,171.34,5060,5921,2936,0,3618,4914,3,6989,4661,40274],
  [1,"main",5,171.61,227,211,176,9,3627,4914,3,7138,4827,40424],
  [1,"market",3,172.14,159,163,159,27,3654,4914,3,8008,5693,41244],
  [1,"main",6,172.45,286,270,222,11,3665,4914,3,8134,5834,41384],
  [1,"farm",20,173.74,6579,7816,3787,0,3709,5760,3,9626,7420,42763],
  [1,"smith",6,174.4,699,606,762,44,3760,5760,3,9881,7782,42888],
  [1,"main",7,174.75,360,344,280,13,3773,5760,3,10739,8656,43776],
  [1,"smith",7,176.07,880,773,960,51,3833,5760,3,11079,9118,43964],
  [1,"market",4,176.66,200,207,200,32,3865,5760,3,11950,9983,44786],
  [1,"main",8,177.06,454,438,353,15,3880,5760,3,12756,10805,45643],
  [1,"smith",8,177.41,1109,986,1210,60,3950,5760,3,11805,9995,44515],
  [1,"main",9,177.87,572,559,445,18,3968,5760,3,11947,10149,44734],
  [1,"smith",9,180.11,1398,1257,1525,70,4050,5760,3,13610,11970,46186],
  [0,"scavenge",4,180.46,10000,12000,10000,0,4087,5760,4,3654,3,36231],
  [1,"market",5,180.73,252,264,252,37,4087,5760,4,4465,813,36992],
  [1,"main",10,181.25,720,712,560,21,4108,5760,4,4333,689,36970],
  [1,"smith",10,181.31,1761,1603,1921,82,4108,5760,4,5303,1660,37890],
  [1,"main",11,181.9,908,908,706,24,4160,5760,4,3903,245,36896],
  [1,"main",12,182.5,1144,1158,890,28,4160,5760,4,4687,1029,37630],
  [1,"smith",11,186.82,2219,2043,2421,96,4368,5760,4,7274,3983,39711],
  [1,"market",6,187.47,318,337,318,44,4412,5760,4,8122,4813,40509],
  [1,"smith",12,188.82,2796,2605,3050,112,4544,5760,4,7387,4279,39404],
  [1,"main",13,189.6,1441,1476,1121,33,4577,5760,4,6885,3742,39172],
  [1,"smith",13,192.68,3523,3322,3843,132,4731,5760,4,7503,4562,39337],
  [1,"market",7,193.43,400,430,400,51,4782,5760,4,9389,6418,41173],
  [1,"main",14,194.32,1816,1882,1412,38,4820,5760,4,8604,5568,40742],
  [1,"smith",14,195.73,4439,4236,4842,154,5000,5760,4,5314,2470,36893],
  [1,"smith",15,201.15,5593,5400,6101,180,5000,5760,4,6297,1688,41492],
  [1,"farm",21,204.45,8552,10317,4886,0,5000,6752,4,11662,7053,46807],
  [1,"main",15,205.47,2288,2400,1779,45,5098,6752,4,8135,3237,44381],
  [1,"main",16,205.68,2883,3060,2242,53,5158,6752,4,8832,3891,45028],
  [1,"market",8,206.28,504,548,504,60,5228,6752,4,8856,3852,45002],
  [1,"market",9,206.62,635,698,635,70,5228,6752,4,9414,4410,45510],
  [1,"smith",16,215.37,7047,6885,7687,211,5686,6752,4,8766,4024,43365],
  [1,"main",17,216.7,3632,3902,2825,62,5748,6752,4,6873,1861,42229],
  [1,"smith",17,221.97,8879,8779,9686,247,5748,6752,4,15413,10401,50675],
  [1,"main",18,223.51,4577,4975,3560,72,5820,6752,4,13911,8501,50140],
  [1,"farm",22,230.88,11118,13618,6302,0,5820,7916,4,15065,7155,50675],
  [1,"smith",18,243.04,11187,11193,12204,289,6447,7916,4,10041,1950,36463],
  [1,"main",19,247.35,5767,6343,4485,84,6531,7916,4,11869,3202,39523],
  [1,"smith",19,253.58,14096,14271,15377,338,6531,7916,4,22305,13638,49909],
  [1,"market",10,254.56,800,890,800,82,6709,7916,4,22348,13465,49902],
  [1,"market",11,254.75,1009,1135,1009,96,6808,7916,4,15395,5690,44513],
  [1,"main",20,256.56,7266,8087,5651,99,6808,7916,4,19036,9332,48105],
  [1,"smith",20,274.9,17761,18196,19375,395,7203,7916,4,31146,21006,50675],
  [1,"snob",1,316.02,15000,25000,10000,80,7283,7916,4,50675,50675,50675],
  ];
  var T_TYPE=0,T_B=1,T_LV=2,T_AT=3,T_CW=4,T_CS=5,T_CI=6,T_CP=7,T_PU=8,T_PC=9,T_TIER=10,T_EW=11,T_ES=12,T_EI=13;

  var NOBLE_H=319.2;
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
      // PREREQ GUARD: never offer a build the game would reject (e.g. Wall needs
      // Kaserne 1). If your LIVE levels don't meet the prereq, show "waiting for
      // X" and disable the button — the plan is prereq-valid, but this protects
      // against your live state diverging from it (partial builds, manual play).
      var pm=missingPrereq(lv,b);
      step.innerHTML="<div style='font-size:10px;opacity:.6'>"+stepN+" · NEXT</div>"+
        "<div style='font-size:16px;font-weight:bold;margin:2px 0'>🏗️ "+(BLABEL[b]||b)+" → "+lvl+"</div>"+
        "<div style='font-size:11px;opacity:.7'>cost "+cw+"/"+cs+"/"+ci+(cp?" · "+cp+" pop":"")+"</div>"+
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
