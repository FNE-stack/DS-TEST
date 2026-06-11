// ==UserScript==
// @name         READL PLANER
// @author       FNE
// @match        https://*.die-staemme.de/game.php?*
// @version      1.0
// @description  Automatischer Readl-Planer mit Zwischencleaner-Timing (gleichsekünden-Ankunft + WB-Export)
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Cleanup vorherige Instanz (Re-Tap der Quickbar / Re-Inject)
  document.querySelectorAll('#rp-box, #rp-toggle, #rp-style').forEach(el => el.remove());

  // Launchpad-Pattern (siehe miezhub): Panel ist Default-on. Closed-Flag in sessionStorage
  // merkt sich wenn der User explizit X gedrückt hat → bleibt zu bis Quickbar-Tap es löscht.
  // Funktioniert auch in der TW App weil keine Sidebar/Questlog nötig ist.
  const IS_QUICKBAR_TAP = !!(window.LAUNCHPAD_TOKEN || window.READLPLANER_TOKEN);
  if (IS_QUICKBAR_TAP) {
    try { sessionStorage.removeItem('rp_closed'); } catch (e) {}
  }
  try {
    if (sessionStorage.getItem('rp_closed') === '1') return;  // User hat geschlossen → Script exit
  } catch (e) {}

  /* ================= CONFIG ================= */

  const WORLD_SPEED = (typeof game_data !== 'undefined' && game_data.speed) ? game_data.speed : 1;

  // Standard-Welt Unit-Speeds (Minuten pro Feld bei Welt-Speed 1)
  const UNIT_MPF = {
    spear: 18, sword: 22, axe: 18, archer: 18,
    spy: 9, light: 10, marcher: 10, heavy: 11,
    ram: 30, catapult: 30, knight: 10, snob: 35
  };

  // Welche Units beim WB-Export ausgegeben werden (Reihenfolge fix)
  const WB_UNITS = ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob','militia'];

  // Mindest-Sekunden-Abstand zwischen ZC-Send und AG-Send (damit ZC garantiert
  // VOR AG im selben Ankunfts-Sekunden-Tick verarbeitet wird)
  const SEND_ORDER_BUFFER_SEC = 1;

  // Späher pro Attacke deckeln (zum Scouten reichen ein paar, der Rest bleibt zuhause)
  const MAX_SPY_PER_ATTACK = 50;

  // Mindest-Qualifikation für ZC-Quelldorf (axe-Schwelle damit's kein Mini-ZC wird).
  // AG-Qualifikation ist implizit: braucht snob≥1 (über buildAGsFromOneVillage).
  const ZC_MIN = { axe: 500 };

  // Plan-Cache: pro Welt eigener localStorage-Eintrag, 48h TTL.
  // Verhindert dass derselbe Readl versehentlich doppelt geplant wird.
  const WORLD_ID = (typeof game_data !== 'undefined' && game_data.world) ? game_data.world : 'unknown';
  const PLAN_CACHE_KEY = `rp_plan_cache_v1_${WORLD_ID}`;
  const PLAN_CACHE_TTL_MS = 48 * 3600 * 1000;
  const CHECKBOX_AG1_OFF_KEY = 'rp_ag1_off_v1';
  const ESCORT_KEY = 'rp_ag_escort_v1';
  const ESCORT_DEFAULT = 'axe=60 light=30';

  /* ================= STATE ================= */

  let villageIdMap = null;
  let plannedReadls = [];

  /* ================= HELPERS ================= */

  function parseArrivalGerman(str) {
    const m = str.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    let Y = +m[3]; if (Y < 100) Y += 2000;
    return new Date(Y, +m[2]-1, +m[1], +m[4], +m[5], +m[6], 0);
  }

  function parseTroopComp(text) {
    const comp = {};
    if (!text) return comp;
    const re = /([a-zA-Z]+)\s*=\s*(\d+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const u = m[1].toLowerCase();
      if (UNIT_MPF[u] !== undefined) comp[u] = +m[2];
    }
    return comp;
  }

  function compSlowestMpf(comp) {
    let max = 0;
    for (const u in comp) {
      if (comp[u] > 0 && UNIT_MPF[u] && UNIT_MPF[u] > max) max = UNIT_MPF[u];
    }
    return max || 18;
  }

  function compSlowestToken(comp) {
    let max = 0, token = 'spear';
    for (const u in comp) {
      if (comp[u] > 0 && UNIT_MPF[u] && UNIT_MPF[u] > max) {
        max = UNIT_MPF[u];
        token = u;
      }
    }
    return token;
  }

  function dist(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }

  // Travel time in seconds (Sekunden-Präzision — keine ms)
  function travelSec(d, mpf) {
    return d * mpf * 60 / WORLD_SPEED;
  }

  function toB64(n) {
    return n && n > 0 ? btoa(String(n)) : '';
  }

  function fmtTime(d) {
    return d.toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function fmtTimeShort(d) {
    return d.toLocaleString('de-DE', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function hasEnoughTroops(village, comp) {
    for (const u in comp) {
      if ((village.units[u] || 0) < comp[u]) return false;
    }
    return true;
  }

  function deductTroops(village, comp) {
    for (const u in comp) {
      village.units[u] = (village.units[u] || 0) - comp[u];
    }
  }

  /* ================= COMP BUILDERS ================= */
  // Statt fester Komposition: jeder Anflug nimmt das was im Dorf aktuell verfügbar ist.
  // AG = 1 Adel + ganzes off, ZC = ganzes off (mit oder ohne Belagerung).

  function buildZCCompWith(v) {
    return {
      axe:      v.units.axe      || 0,
      light:    v.units.light    || 0,
      marcher:  v.units.marcher  || 0,
      ram:      v.units.ram      || 0,
      catapult: v.units.catapult || 0,
      spy:      Math.min(v.units.spy || 0, MAX_SPY_PER_ATTACK)
    };
  }

  function buildZCCompWithout(v) {
    return {
      ...buildZCCompWith(v),
      ram: 0,
      catapult: 0
    };
  }

  function compSummary(comp) {
    const order = ['snob', 'axe', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'spy'];
    const parts = [];
    order.forEach(u => {
      if (comp[u] > 0) parts.push(`${comp[u]} ${u}`);
    });
    return parts.join(', ');
  }

  // Alle AGs aus EINEM Dorf zusammenbauen:
  //  - ag1WithOff aktiv → AG2-N kriegen fixe Begleitung, AG1 schluckt den Rest
  //  - sonst              → Truppen gleichmäßig auf alle AGs aufgeteilt
  function buildAGsFromOneVillage(village, count, ag1WithOff, escortComp) {
    const comps = [];

    if (ag1WithOff && count > 1) {
      const escortPerAG = { snob: 1, ...escortComp };
      const takenByEscort = {};
      for (const u in escortComp) takenByEscort[u] = (count - 1) * (escortComp[u] || 0);

      const ag1 = {
        snob:     1,
        axe:      Math.max(0, (village.units.axe      || 0) - (takenByEscort.axe      || 0)),
        light:    Math.max(0, (village.units.light    || 0) - (takenByEscort.light    || 0)),
        marcher:  Math.max(0, (village.units.marcher  || 0) - (takenByEscort.marcher  || 0)),
        ram:      Math.max(0, (village.units.ram      || 0) - (takenByEscort.ram      || 0)),
        catapult: Math.max(0, (village.units.catapult || 0) - (takenByEscort.catapult || 0)),
        spy:      Math.min(MAX_SPY_PER_ATTACK, Math.max(0, (village.units.spy || 0) - (takenByEscort.spy || 0)))
      };
      comps.push(ag1);
      for (let i = 2; i <= count; i++) comps.push({ ...escortPerAG });
    } else {
      for (let i = 1; i <= count; i++) {
        comps.push({
          snob:     1,
          axe:      Math.floor((village.units.axe      || 0) / count),
          light:    Math.floor((village.units.light    || 0) / count),
          marcher:  Math.floor((village.units.marcher  || 0) / count),
          ram:      Math.floor((village.units.ram      || 0) / count),
          catapult: Math.floor((village.units.catapult || 0) / count),
          spy:      Math.min(MAX_SPY_PER_ATTACK, Math.floor((village.units.spy || 0) / count))
        });
      }
    }

    return comps;
  }

  /* ================= PLAN CACHE (gegen Doppel-Planung) ================= */

  function getPlanCache() {
    try {
      const raw = localStorage.getItem(PLAN_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const now = Date.now();
      const cleaned = {};
      for (const k in parsed) {
        if (parsed[k] && parsed[k].plannedAt && now - parsed[k].plannedAt < PLAN_CACHE_TTL_MS) {
          cleaned[k] = parsed[k];
        }
      }
      return cleaned;
    } catch (e) { return {}; }
  }

  function setPlanCache(cache) {
    try { localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
  }

  function targetCacheKey(target) {
    const tsSec = Math.floor(target.T_last.getTime() / 1000);
    return `${target.x}|${target.y}_${tsSec}`;
  }

  /* ================= LOAD DATA ================= */

  // Positional parsing — geklaut von masssnipe, da läufts. Spalten-Reihenfolge ist
  // pro Welt fix, einfach per Index ablesen.
  //
  // masssnipe nutzt: spear=0, sword=1, sk(heavy)=5, ram=6, cat=7
  // → Lücken sind axe=2, spy=3, light=4. Nach cat kommt: snob=8 (oder snob=9 wenn Paladin-Welt).
  // Falls deine Welt anders ist (Bogen/BKav vorhanden, Paladin-Welt, etc.):
  // die Zahlen unten einfach anpassen.
  async function loadVillagesAndUnits() {
    const html = await fetch(
      '/game.php?screen=overview_villages&mode=units&type=home&group=0'
    ).then(r => r.text());

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const villages = [];

    doc.querySelectorAll('#units_table tbody tr').forEach(row => {
      const m = row.innerText.match(/\b\d{1,3}\|\d{1,3}\b/);
      if (!m) return;

      const [x, y] = m[0].split('|').map(Number);
      const tds = row.querySelectorAll('td.unit-item');
      const get = i => Number((tds[i]?.innerText || '0').replace(/\./g, ''));

      villages.push({
        x, y,
        units: {
          spear:    get(0),
          sword:    get(1),
          axe:      get(2),
          spy:      get(3),
          light:    get(4),
          heavy:    get(5),
          ram:      get(6),
          catapult: get(7),
          snob:     get(8)   // ← bei Paladin-Welt auf get(9) ändern
        }
      });
    });

    return villages;
  }

  async function loadVillageIds() {
    villageIdMap = {};
    const txt = await fetch('/map/village.txt').then(r => r.text());
    txt.split('\n').forEach(l => {
      const p = l.split(',');
      if (p.length >= 4) villageIdMap[`${p[2]}|${p[3]}`] = p[0];
    });
    return villageIdMap;
  }

  /* ================= SOS PARSER ================= */

  function parseSOS(text) {
    const incs = [];
    if (!text || !text.trim()) return incs;

    // Versuch 1: BB-Code Blöcke (jeder [b]Dorf:[/b] startet einen Ziel-Block)
    const blocks = text.split(/(?=\[b\]\s*Dorf:)/i);
    let usedBB = false;

    blocks.forEach(block => {
      if (!/\[b\]\s*Dorf:/i.test(block)) return;
      const c = block.match(/\[coord\]\s*(\d{1,3})\|(\d{1,3})\s*\[\/coord\]/i);
      if (!c) return;
      usedBB = true;
      const tx = +c[1], ty = +c[2];

      const lines = block.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const a = lines[i].match(/Ankunftszeit:\s*(\d{1,2}\.\d{1,2}\.\d{2,4}\s+\d{1,2}:\d{2}:\d{2})/i);
        if (!a) continue;
        const arrival = parseArrivalGerman(a[1]);
        if (!arrival) continue;

        // Slowest-Unit-Hint im Kontext der Zeile suchen
        const ctx = (lines[i-2]||'') + '\n' + (lines[i-1]||'') + '\n' + lines[i] + '\n' + (lines[i+1]||'');
        let slowest = null;
        if (/\[unit\]\s*snob/i.test(ctx) || /\badel\b/i.test(ctx) || /\bnoble\b/i.test(ctx) || /\badelszug\b/i.test(ctx)) {
          slowest = 'snob';
        }
        incs.push({ x: tx, y: ty, arrival, slowest });
      }
    });

    // Versuch 2: Plain-Text Fallback
    if (!usedBB) {
      let curX = null, curY = null;
      text.split('\n').forEach(line => {
        const d = line.match(/(?:Dorf|Ziel)[^()]*\((\d{1,3})\|(\d{1,3})\)/i);
        if (d) { curX = +d[1]; curY = +d[2]; }
        const a = line.match(/Ankunftszeit:\s*(\d{1,2}\.\d{1,2}\.\d{2,4}\s+\d{1,2}:\d{2}:\d{2})/i);
        if (a && curX !== null) {
          const arrival = parseArrivalGerman(a[1]);
          if (arrival) {
            const slowest = /\badel\b|\bsnob\b|\bnoble\b/i.test(line) ? 'snob' : null;
            incs.push({ x: curX, y: curY, arrival, slowest });
          }
        }
      });
    }

    return incs.sort((a, b) => a.arrival - b.arrival);
  }

  // Pro Ziel-Dorf einen Eintrag mit T_last = letzter Adel-Anflug (oder letzter Anflug overall)
  function groupByTarget(incs) {
    const byTarget = new Map();
    incs.forEach(inc => {
      const k = `${inc.x}|${inc.y}`;
      if (!byTarget.has(k)) byTarget.set(k, { x: inc.x, y: inc.y, incs: [] });
      byTarget.get(k).incs.push(inc);
    });

    const targets = [];
    byTarget.forEach(t => {
      t.incs.sort((a, b) => a.arrival - b.arrival);
      const adels = t.incs.filter(i => i.slowest === 'snob');
      t.T_last = adels.length > 0 ? adels[adels.length - 1].arrival : t.incs[t.incs.length - 1].arrival;
      t.totalIncs = t.incs.length;
      t.adelCount = adels.length;
      targets.push(t);
    });

    // Nach T_last sortieren — dringendste zuerst (closest in time → first pick on origins)
    targets.sort((a, b) => a.T_last - b.T_last);

    return targets;
  }

  /* ================= PLANNING ================= */

  // Liefert eine sortierte Liste aller validen Kandidaten — on-time zuerst (nach travel-time),
  // dann late-Kandidaten (nach frühestmöglicher Ankunft).
  //
  //   qualComp:    Mindest-Truppen die ein Dorf haben muss um Kandidat zu sein
  //   compBuilder: (village) => Komposition die tatsächlich gesendet wird
  //                (bestimmt slowest unit / mpf / travel time)
  //   minTravel:   optional — Kandidaten mit travel <= minTravel + buffer werden gefiltert
  //                (für ZCs damit ihre Send-Zeit vor allen AGs liegt)
  //
  // Auto-Exclude: Ziel-Dorf wird nie als Kandidat gewertet (ein Dorf kann sich nicht selber adeln).
  function rankCandidates(target, qualComp, compBuilder, allVillages, T_last, excludeSet, minTravel) {
    const T_last_sec = Math.floor(T_last.getTime() / 1000);
    const now_sec = Math.floor(Date.now() / 1000);

    const candidates = [];
    allVillages.forEach(v => {
      const key = `${v.x}|${v.y}`;
      if (excludeSet && excludeSet.has(key)) return;
      if (v.x === target.x && v.y === target.y) return;          // Selbst-Adeln verboten
      if (!hasEnoughTroops(v, qualComp)) return;

      const comp = compBuilder(v);
      let total = 0;
      for (const u in comp) total += comp[u] || 0;
      if (total === 0) return;

      const mpf = compSlowestMpf(comp);
      const d = dist(v, target);
      const travel = travelSec(d, mpf);

      // Send-Order Constraint (ZC länger als AGs)
      if (minTravel !== undefined && minTravel > 0 && travel <= minTravel + SEND_ORDER_BUFFER_SEC) return;

      // STRIKT: nur on-time Kandidaten. Späte Dörfer fallen raus.
      const send_sec = T_last_sec - travel;
      if (send_sec <= now_sec) return;

      candidates.push({
        village: v, key, dist: d, travel, send_sec,
        comp,
        slowestToken: compSlowestToken(comp)
      });
    });

    candidates.sort((a, b) => a.travel - b.travel);
    return candidates;
  }

  function planTarget(target, agCount, zcCount, allVillages, ag1WithOff, escortComp) {
    const T_last = target.T_last;
    const T_last_sec = Math.floor(T_last.getTime() / 1000);
    const now_sec = Math.floor(Date.now() / 1000);

    // Diagnose-Stats + Adel-Dörfer mit on-time Status (für Auswahl + Anzeige)
    const eligibleVillages = allVillages.filter(v => !(v.x === target.x && v.y === target.y));
    const nobleVillages = eligibleVillages.filter(v => (v.units.snob || 0) >= 1);
    const offVillages   = eligibleVillages.filter(v => (v.units.axe || 0) >= 500);

    const nobleCandidates = nobleVillages
      .map(v => {
        const d = dist(v, target);
        const travel = travelSec(d, UNIT_MPF.snob);
        const send_sec = T_last_sec - travel;
        const onTime = send_sec > now_sec;
        return { v, d, travel, send_sec, onTime };
      })
      .sort((a, b) => a.d - b.d);

    const plan = {
      target: target,
      T_last: T_last,
      ag: [],
      zc: [],
      stats: {
        totalVillages: allVillages.length,
        nobleCount: nobleVillages.length,
        offCount: offVillages.length,
        closestNobles: nobleCandidates.slice(0, 3)
      }
    };

    // ZCs müssen länger reisen als alle AGs (damit Send-Zeit vor AG-Send liegt)
    let maxAGTravel = 0;

    // === Plan AGs — alle aus EINEM Dorf ===
    // Wir suchen das beste on-time Adel-Dorf das so viele AGs wie möglich tragen kann.
    // Score = möglicheAGs * 1000 - Distanz (mehr AGs > näher).
    let bestAG = null;
    let bestScore = -1;

    nobleCandidates.forEach(c => {
      if (!c.onTime) return;
      const snobs = c.v.units.snob || 0;
      let possibleAGs = Math.min(agCount, snobs);

      // Bei ag1WithOff: AG2-N brauchen die fixe Begleitung — wenn nicht genug da ist,
      // reduzieren wir possibleAGs entsprechend.
      if (ag1WithOff && possibleAGs > 1) {
        for (const u in escortComp) {
          const perAG = escortComp[u] || 0;
          if (perAG <= 0) continue;
          const have = c.v.units[u] || 0;
          // AG1 nimmt rest (kann 0 sein), AG2+ nehmen je perAG → brauchen (possibleAGs-1)*perAG
          const allowed = 1 + Math.floor(have / perAG);
          if (allowed < possibleAGs) possibleAGs = allowed;
        }
      }

      if (possibleAGs < 1) return;

      const score = possibleAGs * 1000 - c.d;
      if (score > bestScore) {
        bestScore = score;
        bestAG = { village: c.v, possibleAGs, travel: c.travel, dist: c.d };
      }
    });

    if (!bestAG) {
      // Kein on-time Adel-Dorf → alle AG-Slots scheitern (ZC läuft trotzdem weiter unten)
      for (let i = 1; i <= agCount; i++) {
        plan.ag.push({ slot: 'AG' + i, status: 'no_village' });
      }
    } else {
      const { village, possibleAGs, travel } = bestAG;
      const comps = buildAGsFromOneVillage(village, possibleAGs, ag1WithOff, escortComp);
      maxAGTravel = travel;

      for (let i = 1; i <= agCount; i++) {
        if (i > possibleAGs) {
          plan.ag.push({ slot: 'AG' + i, status: 'no_village' });
          continue;
        }

        const comp = comps[i - 1];
        const arrival_sec = T_last_sec;
        const send_sec_eff = arrival_sec - travel;

        plan.ag.push({
          slot: 'AG' + i,
          village: village,
          arrival: new Date(arrival_sec * 1000),
          send: new Date(Math.max(send_sec_eff, now_sec) * 1000),
          comp: comp,
          slowestToken: 'snob',
          status: 'ok',
          delaySec: 0
        });

        deductTroops(village, comp);
      }
    }

    // === Plan ZCs (unabhängig vom AG-Plan, strikt on-time) ===
    // Wenn AGs failen ist maxAGTravel=0 → ZC braucht nur on-time zu sein.
    const usedZC = new Set();
    for (let i = 1; i <= zcCount; i++) {
      const candsWith    = rankCandidates(target, ZC_MIN, buildZCCompWith,    allVillages, T_last, usedZC, maxAGTravel);
      const candsWithout = rankCandidates(target, ZC_MIN, buildZCCompWithout, allVillages, T_last, usedZC, maxAGTravel);

      // Beide sind strikt on-time (rankCandidates filtert Späte raus).
      // Bevorzuge "mit Belagerung" wenn verfügbar (mehr Wirkung), sonst "ohne".
      const chosen = candsWith[0] || candsWithout[0] || null;

      if (!chosen) {
        plan.zc.push({ slot: 'ZC' + i, status: 'no_village' });
        continue;
      }

      const hasSiege = (chosen.comp.ram || 0) > 0 || (chosen.comp.catapult || 0) > 0;
      const mode = hasSiege ? 'mit Belagerung' : 'ohne Belagerung';

      usedZC.add(chosen.key);
      deductTroops(chosen.village, chosen.comp);

      const arrival_sec = T_last_sec;
      const send_sec_eff = arrival_sec - chosen.travel;

      plan.zc.push({
        slot: 'ZC' + i,
        village: chosen.village,
        mode: mode,
        arrival: new Date(arrival_sec * 1000),
        send: new Date(Math.max(send_sec_eff, now_sec) * 1000),
        comp: chosen.comp,
        slowestToken: chosen.slowestToken,
        status: 'ok',
        delaySec: 0
      });
    }

    return plan;
  }

  /* ================= WB EXPORT ================= */

  function wbLine(attack, target) {
    const f = villageIdMap[`${attack.village.x}|${attack.village.y}`];
    const t = villageIdMap[`${target.x}|${target.y}`];
    if (!f || !t) return '';

    const fields = WB_UNITS.map(u => `${u}=${toB64(attack.comp[u] || 0)}`).join('/');
    return `${f}&${t}&${attack.slowestToken}&${attack.arrival.getTime()}&0&false&true&${fields}`;
  }

  function exportWB(plans) {
    const lines = [];
    plans.forEach(plan => {
      const all = [];
      plan.ag.forEach(a => { if (a.village) all.push(a); });
      plan.zc.forEach(z => { if (z.village) all.push(z); });
      all.sort((a, b) => a.send - b.send);
      all.forEach(a => {
        const line = wbLine(a, plan.target);
        if (line) lines.push(line);
      });
    });
    return lines.join('\n');
  }

  /* ================= UI ================= */

  const style = document.createElement('style');
  style.id = 'rp-style';
  style.textContent = `
#rp-box {
  width: 540px;
  max-width: calc(100vw - 16px);
  margin: 12px auto;
  background: linear-gradient(160deg,#1a0f2e,#2d1b4e);
  border-radius: 14px;
  color: #e5e7eb;
  font-family: Inter, Verdana;
  box-shadow: 0 4px 18px rgba(0,0,0,.5);
  position: relative;
  z-index: 9999;
}
#rp-header {
  padding: 12px;
  font-weight: 600;
  background: linear-gradient(90deg,#7c2d12,#991b1b);
  border-radius: 14px 14px 0 0;
  display: flex;
  justify-content: space-between;
}
#rp-tabs {
  display: flex;
  background: #1e293b;
  border-bottom: 1px solid #334155;
}
#rp-tabs button {
  flex: 1;
  padding: 8px;
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-weight: 500;
  border-bottom: 2px solid transparent;
}
#rp-tabs button.active {
  color: #e5e7eb;
  border-bottom-color: #ef4444;
}
#rp-body {
  padding: 12px;
  max-height: 75vh;
  overflow-y: auto;
}
#rp-body label {
  display: block;
  font-size: 11px;
  color: #94a3b8;
  margin-top: 6px;
  margin-bottom: 2px;
}
#rp-tab-content > div { display: none; }
#rp-tab-content > div.active { display: block; }
#rp-body input:not([type="checkbox"]),
#rp-body textarea {
  width: 100%;
  background: #020617;
  border: 1px solid #334155;
  border-radius: 8px;
  color: #e5e7eb;
  padding: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  box-sizing: border-box;
  font-family: monospace;
}
#rp-output {
  background: #020617;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 6px;
  font-size: 11px;
  max-height: 380px;
  overflow-y: auto;
}
#rp-output:empty:before {
  content: 'Noch keine Berechnung';
  color: #64748b;
}
#rp-body button {
  width: 100%;
  padding: 9px;
  border-radius: 10px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  background: linear-gradient(90deg,#ef4444,#dc2626);
  color: #fff;
  margin-top: 6px;
  font-size: 13px;
}
#rp-body button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
#rp-footer {
  text-align: right;
  font-size: 10px;
  color: #94a3b8;
  margin-top: 6px;
}
#rp-toggle {
  display: flex !important;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 22px;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  transition: transform 0.15s ease;
}
#rp-toggle:hover {
  transform: scale(1.15);
}
.rp-target {
  background: #0f172a;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 10px;
  border-left: 3px solid #ef4444;
}
.rp-target-header {
  font-weight: 600;
  color: #f87171;
  margin-bottom: 4px;
  font-size: 12px;
}
.rp-target-meta {
  font-size: 10px;
  color: #94a3b8;
  margin-bottom: 6px;
}
.rp-attack-wrap {
  border-bottom: 1px dashed #334155;
  padding: 4px 0 5px 0;
}
.rp-attack-wrap:last-child { border-bottom: none; }
.rp-attack {
  display: grid;
  grid-template-columns: 24px 46px 1fr auto auto;
  gap: 6px;
  font-size: 11px;
  align-items: center;
}
.rp-comp-row {
  font-size: 10px;
  color: #cbd5e1;
  font-family: monospace;
  padding-left: 36px;
  margin-top: 3px;
}
.rp-order { color: #f87171; font-weight: 700; text-align: right; font-size: 11px; }
.rp-slot { color: #94a3b8; font-weight: 600; }
.rp-village { color: #e5e7eb; }
.rp-mode-with { color: #facc15; font-size: 10px; }
.rp-mode-without { color: #34d399; font-size: 10px; }
.rp-times { color: #60a5fa; font-family: monospace; font-size: 10px; }
.rp-status-ok { color: #22c55e; font-weight: 600; }
.rp-status-late { color: #f97316; font-weight: 600; font-size: 10px; }
.rp-status-fail { color: #ef4444; font-weight: 600; }
.rp-divider {
  border-top: 1px solid #334155;
  margin: 6px 0;
}
.rp-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 4px 0;
  font-size: 11px;
  color: #cbd5e1;
}
.rp-checkbox-row input[type="checkbox"] {
  width: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  accent-color: #ef4444;
}
.rp-checkbox-row label {
  margin: 0 !important;
  cursor: pointer;
  color: #cbd5e1 !important;
  font-size: 11px !important;
}
.rp-cache-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  font-size: 10px;
  color: #94a3b8;
  padding: 4px 2px;
}
#rp-cache-clear {
  cursor: pointer;
  color: #f87171;
}
#rp-cache-clear:hover {
  text-decoration: underline;
}
/* Mobile / TW App: Panel über volle Breite, größere Touch-Targets */
@media (max-width: 700px) {
  #rp-box {
    width: calc(100vw - 12px) !important;
    margin: 6px auto !important;
    border-radius: 10px;
  }
  #rp-header { padding: 10px; font-size: 13px; }
  #rp-body { padding: 8px; max-height: 80vh; }
  #rp-tabs button { padding: 12px 4px; font-size: 13px; }
  #rp-body input:not([type="checkbox"]),
  #rp-body textarea {
    padding: 10px;
    font-size: 14px;
    min-height: 40px;
  }
  .rp-checkbox-row input[type="checkbox"] {
    width: 22px !important;
    height: 22px !important;
    min-width: 22px;
    min-height: 22px;
    flex-shrink: 0;
  }
  #rp-body button {
    padding: 12px;
    font-size: 14px;
    min-height: 44px;
  }
}
`;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.id = 'rp-box';
  box.innerHTML = `
<div id="rp-header">
  <span>👑 Readl Planer</span>
  <span id="rp-close" style="cursor:pointer;padding:4px 10px;">✕</span>
</div>
<div id="rp-tabs">
  <button class="active" data-tab="input">Eingabe</button>
  <button data-tab="result">Ergebnis</button>
</div>
<div id="rp-body">
  <div id="rp-tab-content">
    <div id="rp-tab-input" class="active">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        <div>
          <label>AGs pro Ziel</label>
          <input id="rp-ag-count" type="number" min="1" max="10" value="4">
        </div>
        <div>
          <label>Zwischencleaner pro Ziel</label>
          <input id="rp-zc-count" type="number" min="0" max="5" value="1">
        </div>
      </div>
      <div class="rp-checkbox-row">
        <input type="checkbox" id="rp-ag1-off">
        <label for="rp-ag1-off">AG1 mit voller OFF (AG2+ mit fixer Begleitung unten)</label>
      </div>
      <label>AG-Begleitung für AG2+ (nur aktiv wenn ↑ Haken gesetzt)</label>
      <input id="rp-ag-escort" type="text" placeholder="axe=60 light=30" value="axe=60 light=30">
      <div style="font-size:10px;color:#cbd5e1;background:#020617;border:1px solid #334155;border-radius:6px;padding:8px;margin:8px 0;line-height:1.4;">
        ℹ <b>Truppen werden auto aus jedem Dorf befüllt</b> — AG = 1 Adel + alle off-Truppen, ZC = alle off-Truppen.<br>
        ZC-Belagerung wird auto mit/ohne berechnet je nach was zeitlich passt. Pro Anflug max ${MAX_SPY_PER_ATTACK} Späher.
      </div>
      <label>SOS-Befehl(e) einfügen (mehrere Ziele werden auto erkannt)</label>
      <textarea id="rp-sos" rows="8" placeholder="SOS-Befehl(e) hier reinpasten..."></textarea>
      <button id="rp-calc">🛡 Readl berechnen &amp; WB exportieren</button>
      <div class="rp-cache-row">
        <span id="rp-cache-info">📦 0 Readls geplant</span>
        <span id="rp-cache-clear">↺ Cache leeren</span>
      </div>
    </div>
    <div id="rp-tab-result">
      <div id="rp-output"></div>
      <label>Workbench Export (in Zwischenablage kopiert)</label>
      <textarea id="rp-wb-output" rows="6" readonly style="font-family:monospace;font-size:10px;"></textarea>
      <button id="rp-copy-wb">📋 WB-Code erneut kopieren</button>
    </div>
  </div>
  <div id="rp-footer">Readl Planer v1.0 · für Sekunden-Welten</div>
</div>`;
  // Inline-Mount wie miezhub/launchpad: in #contentContainer (oder body fallback) prependen.
  // Kein Questlog-Icon mehr → Panel ist Default-sichtbar, ✕ schließt + setzt Closed-Flag.
  // Funktioniert auch in der TW App weil keine Desktop-Sidebar nötig ist.
  const mount = document.getElementById('contentContainer') || document.body;
  mount.insertBefore(box, mount.firstChild);

  /* ================= EVENTS ================= */

  function updateCacheInfo() {
    const el = document.getElementById('rp-cache-info');
    if (!el) return;
    const cache = getPlanCache();
    const count = Object.keys(cache).length;
    el.textContent = `📦 ${count} Readl${count === 1 ? '' : 's'} geplant (48h TTL)`;
  }

  function bindEventsWhenReady() {
    const calc = document.getElementById('rp-calc');
    const closeBtn = document.getElementById('rp-close');
    const header = document.getElementById('rp-header');
    const body = document.getElementById('rp-body');
    const tabBtns = document.querySelectorAll('#rp-tabs button');
    const copyBtn = document.getElementById('rp-copy-wb');
    const ag1OffBox = document.getElementById('rp-ag1-off');
    const escortInput = document.getElementById('rp-ag-escort');
    const cacheClearBtn = document.getElementById('rp-cache-clear');

    if (!calc || !closeBtn || !header || !body || tabBtns.length === 0 || !ag1OffBox || !escortInput || !cacheClearBtn) {
      return setTimeout(bindEventsWhenReady, 50);
    }

    // Checkbox State aus localStorage wiederherstellen + persistieren
    ag1OffBox.checked = localStorage.getItem(CHECKBOX_AG1_OFF_KEY) === '1';
    ag1OffBox.addEventListener('change', () => {
      localStorage.setItem(CHECKBOX_AG1_OFF_KEY, ag1OffBox.checked ? '1' : '0');
    });

    // Escort-Input State aus localStorage wiederherstellen + persistieren
    const storedEscort = localStorage.getItem(ESCORT_KEY);
    escortInput.value = storedEscort || ESCORT_DEFAULT;
    escortInput.addEventListener('change', () => {
      localStorage.setItem(ESCORT_KEY, escortInput.value);
    });

    // Cache-Clear-Button
    cacheClearBtn.onclick = () => {
      const cache = getPlanCache();
      const count = Object.keys(cache).length;
      if (count === 0) { alert('Cache ist schon leer.'); return; }
      if (confirm(`${count} geplante Readl${count === 1 ? '' : 's'} aus dem Cache entfernen?`)) {
        setPlanCache({});
        updateCacheInfo();
      }
    };

    // Initial Cache-Info anzeigen
    updateCacheInfo();

    tabBtns.forEach(btn => {
      btn.onclick = () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('#rp-tab-content > div').forEach(d => d.classList.remove('active'));
        document.getElementById(`rp-tab-${tab}`).classList.add('active');
      };
    });

    // Close: Panel komplett aus dem DOM + Closed-Flag setzen.
    // Re-Öffnen → Quickbar-Tap (löscht das Flag wieder, siehe oben am Script-Start).
    closeBtn.onclick = () => {
      try { sessionStorage.setItem('rp_closed', '1'); } catch (e) {}
      box.remove();
    };

    calc.onclick = async () => {
      try {
        calc.disabled = true;
        calc.textContent = '⏳ Lade frische Truppen…';

        // 1. Frische Truppen + Village-ID-Map
        const villages = await loadVillagesAndUnits();
        await loadVillageIds();

        if (villages.length === 0) {
          alert('Keine Dörfer/Truppen geladen. Bist du auf einer Seite wo overview_villages erreichbar ist?');
          return;
        }

        // Diagnose: was wurde geparsed?
        const totalSnobs = villages.reduce((s, v) => s + (v.units.snob || 0), 0);
        const villagesWithSnob = villages.filter(v => (v.units.snob || 0) >= 1).length;
        const villagesWithAxe = villages.filter(v => (v.units.axe || 0) >= 500).length;
        console.log(`[Readl Planer] ${villages.length} Dörfer geladen · ${totalSnobs} Adel verteilt auf ${villagesWithSnob} Dörfer · ${villagesWithAxe} Off-Dörfer (axe≥500)`);
        console.log('[Readl Planer] Truppen pro Dorf (erste 5):', villages.slice(0, 5).map(v => ({ coord: `${v.x}|${v.y}`, units: v.units })));
        if (villagesWithSnob === 0) {
          console.warn('[Readl Planer] ⚠ KEIN Dorf mit Adel gefunden! Mögliche Ursachen: (1) Adel grad in Bewegung, (2) snob-Spalte in der Truppen-Übersicht ausgeblendet, (3) Welt hat keinen Adel.');
        }

        // 2. SOS parsen
        const sosText = document.getElementById('rp-sos').value;
        const incs = parseSOS(sosText);
        if (incs.length === 0) {
          alert('Keine SOS-Daten erkannt. Format prüfen (BB-Code mit [b]Dorf:[/b] und Ankunftszeit).');
          return;
        }

        const targets = groupByTarget(incs);
        if (targets.length === 0) {
          alert('Keine Ziel-Dörfer im SOS erkannt.');
          return;
        }

        // 3. Counts + Optionen
        const agCount = Math.max(1, Math.min(10, +document.getElementById('rp-ag-count').value || 4));
        // BUG-FIX: was `+x.value || 1` which evaluates `0 || 1` to 1 since 0 is
        // falsy in JS — meaning setting ZC count to 0 silently became 1 and a
        // Zwischencleaner got planned anyway. Parse explicitly: only fall back
        // to 1 if the input is empty or NaN, NOT when it's exactly 0.
        const zcRaw = document.getElementById('rp-zc-count').value;
        const zcParsed = zcRaw === "" ? 1 : Number(zcRaw);
        const zcCount = Math.max(0, Math.min(5, isNaN(zcParsed) ? 1 : zcParsed));
        const ag1WithOff = ag1OffBox.checked;

        // Escort parsen (für AG2+ wenn ag1WithOff aktiv)
        const escortComp = parseTroopComp(escortInput.value);
        const escortTotal = Object.values(escortComp).reduce((a, b) => a + (b || 0), 0);
        if (ag1WithOff && escortTotal === 0) {
          alert('AG-Begleitung darf nicht leer sein wenn "AG1 mit voller OFF" aktiv ist.\nMindestens ein paar Truppen angeben (z.B. axe=60 light=30).');
          return;
        }

        // 3b. Cache-Check: schon geplante Ziele ausfiltern oder nachfragen
        const cache = getPlanCache();
        const duplicates = targets.filter(t => cache[targetCacheKey(t)]);
        let activeTargets = targets;

        if (duplicates.length > 0) {
          const dupList = duplicates.map(t => {
            const entry = cache[targetCacheKey(t)];
            return `  ${t.x}|${t.y} — T_last ${fmtTimeShort(t.T_last)} (geplant ${fmtTimeShort(new Date(entry.plannedAt))})`;
          }).join('\n');
          const fresh = targets.filter(t => !cache[targetCacheKey(t)]);

          const proceed = confirm(
            `${duplicates.length} Ziel${duplicates.length === 1 ? '' : 'e'} wurde${duplicates.length === 1 ? '' : 'n'} schon geplant:\n\n${dupList}\n\n` +
            `OK = trotzdem alle ${targets.length} neu planen\n` +
            `Abbrechen = nur die ${fresh.length} neuen planen`
          );

          if (!proceed) {
            if (fresh.length === 0) {
              alert('Alle Ziele schon geplant. Nutze "Cache leeren" um neu zu planen.');
              return;
            }
            activeTargets = fresh;
          }
        }

        // 4. Pro Ziel planen (greedy, geteiltes Truppen-Budget, Auto-Comp pro Dorf)
        plannedReadls = activeTargets.map(t => planTarget(t, agCount, zcCount, villages, ag1WithOff, escortComp));

        // 4b. Erfolgreich geplante Ziele in Cache schreiben
        plannedReadls.forEach(p => {
          cache[targetCacheKey(p.target)] = {
            plannedAt: Date.now(),
            agCount: agCount,
            zcCount: zcCount,
            ag1WithOff: ag1WithOff
          };
        });
        setPlanCache(cache);
        updateCacheInfo();

        // 5. Rendern
        renderResult(plannedReadls);

        // 6. WB-Export
        const wb = exportWB(plannedReadls);
        document.getElementById('rp-wb-output').value = wb;
        try { await navigator.clipboard.writeText(wb); } catch (e) { /* clipboard blocked */ }

        // 7. Direkt zum Ergebnis-Tab wechseln (explizit + scroll nach oben)
        tabBtns.forEach(b => b.classList.remove('active'));
        const resultBtn = Array.from(tabBtns).find(b => b.dataset.tab === 'result');
        if (resultBtn) resultBtn.classList.add('active');
        document.querySelectorAll('#rp-tab-content > div').forEach(d => d.classList.remove('active'));
        const resultDiv = document.getElementById('rp-tab-result');
        if (resultDiv) resultDiv.classList.add('active');
        body.scrollTop = 0;
      } catch (e) {
        console.error('[Readl Planer] Fehler:', e);
        alert('Fehler beim Berechnen: ' + e.message);
      } finally {
        calc.disabled = false;
        calc.textContent = '🛡 Readl berechnen & WB exportieren';
      }
    };

    if (copyBtn) {
      copyBtn.onclick = async () => {
        const wb = document.getElementById('rp-wb-output').value;
        await navigator.clipboard.writeText(wb);
        const orig = copyBtn.textContent;
        copyBtn.textContent = '✓ Kopiert!';
        copyBtn.style.background = 'linear-gradient(90deg,#22c55e,#16a34a)';
        setTimeout(() => {
          copyBtn.textContent = orig;
          copyBtn.style.background = 'linear-gradient(90deg,#ef4444,#dc2626)';
        }, 2000);
      };
    }
  }

  /* ================= RESULT RENDER ================= */

  function renderAttack(att, orderIdx) {
    const orderCell = orderIdx ? `<span class="rp-order">${orderIdx}.</span>` : `<span></span>`;

    if (att.status === 'no_village') {
      return `<div class="rp-attack-wrap"><div class="rp-attack">
        ${orderCell}
        <span class="rp-slot rp-status-fail">${att.slot}</span>
        <span class="rp-status-fail">⚠ kein passendes Dorf (Truppen fehlen / Distanz-Constraint)</span>
        <span></span><span></span>
      </div></div>`;
    }

    const v = att.village;
    const modeBadge = att.mode === 'mit Belagerung' ? `<span class="rp-mode-with">[mit Belagerung]</span>` :
                      att.mode === 'ohne Belagerung' ? `<span class="rp-mode-without">[ohne Belagerung]</span>` : '';
    const statusBadge = att.status === 'ok'
      ? `<span class="rp-status-ok">✓ T_last</span>`
      : `<span class="rp-status-late">⚠ +${att.delaySec}s</span>`;

    const compStr = compSummary(att.comp);

    return `<div class="rp-attack-wrap">
      <div class="rp-attack">
        ${orderCell}
        <span class="rp-slot">${att.slot}</span>
        <span class="rp-village">${v.x}|${v.y} ${modeBadge}</span>
        <span class="rp-times">send ${fmtTimeShort(att.send)} → arr ${fmtTimeShort(att.arrival)}</span>
        <span>${statusBadge}</span>
      </div>
      <div class="rp-comp-row">${compStr}</div>
    </div>`;
  }

  function renderResult(plans) {
    const out = document.getElementById('rp-output');
    if (!plans.length) {
      out.innerHTML = '<div style="color:#64748b;">Keine Pläne erstellt</div>';
      return;
    }

    const totalOk = plans.reduce((s, p) => s + [...p.ag, ...p.zc].filter(a => a.status === 'ok').length, 0);
    const totalLate = plans.reduce((s, p) => s + [...p.ag, ...p.zc].filter(a => a.status === 'late').length, 0);
    const totalFail = plans.reduce((s, p) => s + [...p.ag, ...p.zc].filter(a => a.status === 'no_village').length, 0);

    let html = `<div style="margin-bottom:10px;font-size:12px;">`;
    html += `<b>${plans.length} Readl-Plan${plans.length === 1 ? '' : 'e'} erstellt</b> · `;
    html += `<span class="rp-status-ok">${totalOk} pünktlich</span> · `;
    html += `<span class="rp-status-late">${totalLate} verspätet</span> · `;
    html += `<span class="rp-status-fail">${totalFail} unmöglich</span>`;
    html += `</div>`;

    plans.forEach(plan => {
      html += `<div class="rp-target">`;
      html += `<div class="rp-target-header">🎯 ${plan.target.x}|${plan.target.y} — T_last ${fmtTime(plan.T_last)}</div>`;
      html += `<div class="rp-target-meta">${plan.target.totalIncs} Anflüge total, ${plan.target.adelCount} als Adel erkannt · Send-Reihenfolge ZC ▶ AG</div>`;

      // === Diagnose: was steht zur Verfügung? ===
      if (plan.stats) {
        const s = plan.stats;
        const nobleColor = s.nobleCount === 0 ? '#ef4444' : '#22c55e';
        const offColor   = s.offCount   === 0 ? '#ef4444' : '#22c55e';
        let diag = `🔍 <span style="color:${nobleColor}">${s.nobleCount} Dörfer mit Adel</span> · `;
        diag    += `<span style="color:${offColor}">${s.offCount} mit Off (axe≥500)</span> · `;
        diag    += `von ${s.totalVillages} geladenen Dörfern`;

        if (s.closestNobles.length > 0) {
          const list = s.closestNobles.map(c => {
            const h = Math.floor(c.travel / 3600);
            const m = Math.floor((c.travel % 3600) / 60);
            const sendDate = new Date((Math.floor(plan.T_last.getTime() / 1000) - c.travel) * 1000);
            const tooLate  = sendDate.getTime() <= Date.now();
            const stColor  = tooLate ? '#ef4444' : '#22c55e';
            return `${c.v.x}|${c.v.y} (${c.d.toFixed(1)}F, Adel-Flug ${h}h${m}m, <span style="color:${stColor}">send ${fmtTimeShort(sendDate)}</span>)`;
          }).join('<br>&nbsp;&nbsp;&nbsp;');
          diag += `<br>· Nächste Adel-Dörfer:<br>&nbsp;&nbsp;&nbsp;${list}`;
        } else if (s.totalVillages > 0) {
          diag += `<br>· <span style="color:#ef4444;font-weight:600;">⚠ KEIN Dorf hat snob≥1!</span> Entweder Adel grad nicht zuhause, oder Truppen-Parser sieht's nicht. Check F12 → Console.`;
        }
        html += `<div class="rp-target-meta" style="font-size:10px;line-height:1.6;background:#020617;padding:6px 8px;border-radius:6px;margin-bottom:8px;">${diag}</div>`;
      }

      // Geplante Attacken nach Send-Zeit sortieren (= Reihenfolge wie der User klickt)
      const planned = [...plan.zc, ...plan.ag].filter(a => a.status !== 'no_village');
      planned.sort((a, b) => a.send - b.send);
      planned.forEach((att, idx) => { html += renderAttack(att, idx + 1); });

      // Failures unten
      const failed = [...plan.zc, ...plan.ag].filter(a => a.status === 'no_village');
      if (failed.length > 0) {
        html += `<div class="rp-divider"></div>`;
        failed.forEach(att => { html += renderAttack(att); });
      }

      html += `</div>`;
    });

    out.innerHTML = html;
  }

  bindEventsWhenReady();

})();
