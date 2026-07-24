// ==UserScript==
// @name         WarHub
// @author       FNE
// @match        https://*.die-staemme.de/game.php?*
// @version      2.0
// @description  Stamm-Kriegsraum für de254 — OFF/Voradeln/ZC-Anfragen + tribe-weiter Live-Angriffs-Monitor (GitHub-Sync + Discord). Auto-Upload eigener Incomings.
// @grant        none
// ==/UserScript==

// =============================================================================
// WARHUB — der Kriegsraum. Erweitert MiezHub um einen tribe-weiten Angriffs-
// Monitor: jeder, der das Script offen hat, lädt SEINE eigenen eingehenden
// Angriffe (Incomings-Screen) automatisch in den geteilten GitHub-Store. Das
// Dashboard aggregiert alle → jeder sieht was wo reinkommt, und kann mit einem
// Tap Hilfe (ZC/Voradeln/OFF) für ein Ziel anfordern.
//
// EINSATZ:
//   (A) Tampermonkey: Script speichern, läuft auto auf jedem game.php Page-Load
//   (B) Schnelleiste:  javascript: window.WARHUB_TOKEN='DEIN_TOKEN';
//                      $.getScript('https://fne-stack.github.io/DS-TEST/warhub.user.js?cb='+Date.now());
//
// WEBHOOK-CONFIG (privat im DS-PLAN Repo): warhub.config.json { "webhook": "..." }
// DATEN (privat):                          warhub.json
//
// DATENMODELL (warhub.json):
//   { requests:[…], history:[…],
//     incomings: { "<Spieler>": { updatedAt: ms, attacks:[ {id,targetX,targetY,
//                  target, arrivalMs, isAttack, sourceX?,sourceY?} ] } } }
//   → Jeder Spieler schreibt NUR seinen eigenen incomings-Key ⇒ keine Write-
//     Konflikte zwischen Mitgliedern (Conflict-Retry fängt seltene Overlaps).
// =============================================================================

(function () {
  'use strict';

  // Cleanup vorherige Instanz
  document.querySelectorAll('#mh-box, #mh-toggle, #mh-style').forEach(el => el.remove());
  if (window._mhPoll) { clearInterval(window._mhPoll); window._mhPoll = null; }
  if (window._whIncTimer) { clearInterval(window._whIncTimer); window._whIncTimer = null; }

  const IS_QUICKBAR_TAP = !!(window.LAUNCHPAD_TOKEN || window.WARHUB_TOKEN || window.MIEZHUB_TOKEN);
  if (IS_QUICKBAR_TAP) {
    try { sessionStorage.removeItem('mh_closed'); } catch (e) {}
  }
  try {
    if (sessionStorage.getItem('mh_closed') === '1') return;
  } catch (e) {}

  /* ================= CONFIG ================= */

  const VERSION = 'v2';
  const GITHUB_OWNER = 'FNE-stack';
  const GITHUB_DATA_REPO = 'DS-PLAN';
  const GITHUB_BRANCH = 'main';
  const GITHUB_FILE = 'warhub.json';
  const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_DATA_REPO}/contents/${GITHUB_FILE}`;

  const CONFIG_FILE = 'warhub.config.json';
  const CONFIG_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_DATA_REPO}/contents/${CONFIG_FILE}`;
  let configCache = null;

  const MAX_OPEN_REQUESTS_PER_PLAYER = 3;
  const REOPENED_BADGE_DURATION_MS = 10 * 60 * 1000;
  const POLL_INTERVAL_MS = 60000;
  const AUTO_CLEANUP_OVERLAP_MS = 5 * 60 * 1000;

  // War-Monitor: wie oft die EIGENEN Incomings gescraped + hochgeladen werden.
  const INC_UPLOAD_INTERVAL_MS = 90 * 1000;
  // Incomings älter als (arrival + X) gelten als gelandet → aus dem Board.
  const INC_STALE_AFTER_MS = 3 * 60 * 1000;
  // Ein Spieler-Slice gilt als "veraltet" (Coverage-Warnung) nach:
  const INC_PLAYER_STALE_MS = 8 * 60 * 1000;
  // Angriffe, die in weniger als X landen → rot markieren.
  const INC_SOON_MS = 60 * 60 * 1000;

  const PLAYER_NAME = (typeof game_data !== 'undefined' && game_data.player && game_data.player.name) ? game_data.player.name : 'unknown';
  const WORLD_SPEED = (typeof game_data !== 'undefined' && game_data.speed) ? game_data.speed : 1;

  function getToken() {
    const t = (typeof window !== 'undefined' && (window.WARHUB_TOKEN || window.MIEZHUB_TOKEN || window.LAUNCHPAD_TOKEN)) || localStorage.getItem('warhub_token') || localStorage.getItem('miezhub_token') || '';
    if (t) try { localStorage.setItem('warhub_token', t); } catch (e) {}
    return t;
  }

  /* ================= CONSTANTS ================= */

  const UNIT_MPF = {
    spear: 18, sword: 22, axe: 18, archer: 18,
    spy: 9, light: 10, marcher: 10, heavy: 11,
    ram: 30, catapult: 30, knight: 10, snob: 35
  };
  const WB_UNITS = ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob','militia'];

  const TYPE_META = {
    off:      { label: 'OFF',             color: '#dc2626', mpf: 30, minAxe: 2000, withSiege: true,  sendsSnob: false, minSnob: 0, emoji: '⚔' },
    voradeln: { label: 'Voradeln',        color: '#f97316', mpf: 35, minAxe: 1000, withSiege: true,  sendsSnob: true,  minSnob: 1, emoji: '👑' },
    zc:       { label: 'Zwischencleaner', color: '#22c55e', mpf: 18, minAxe: 500,  withSiege: false, sendsSnob: false, minSnob: 0, emoji: '🧹' }
  };

  /* ================= STATE ================= */

  let cachedData = { requests: [], history: [], incomings: {} };
  let currentSha = null;
  let myVillages = [];
  let villageIdMap = {};
  let villageCoordByVid = {};
  let lastSyncAt = null;
  let activeFilter = 'mine_only';
  let warSort = 'arrival';   // 'arrival' | 'target'

  /* ================= HELPERS ================= */

  function utf8ToBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
  function base64ToUtf8(b64) { return decodeURIComponent(escape(atob(b64))); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function randId() { return 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  function fmtDate(ms) {
    return new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function fmtTime(ms) {
    return new Date(ms).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function fmtCountdown(ms) {
    const total = Math.floor(ms / 1000);
    if (total <= 0) return '⏱ jetzt';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
  function travelSec(d, mpf) { return d * mpf * 60 / WORLD_SPEED; }
  function toB64(n) { return n && n > 0 ? btoa(String(n)) : ''; }

  function compSlowestToken(comp) {
    let max = 0, token = 'spear';
    for (const u in comp) {
      if (comp[u] > 0 && UNIT_MPF[u] && UNIT_MPF[u] > max) { max = UNIT_MPF[u]; token = u; }
    }
    return token;
  }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function parseCoord(s) {
    const m = (s || '').match(/(\d{1,3})\|(\d{1,3})/);
    if (!m) return null;
    return { x: +m[1], y: +m[2] };
  }

  /* ================= GITHUB SYNC ================= */

  async function fetchData() {
    const token = getToken();
    if (!token) throw new Error('Kein GitHub-Token gesetzt. Setz via Quickbar window.WARHUB_TOKEN.');
    const res = await fetch(GITHUB_API + '?ref=' + GITHUB_BRANCH + '&cb=' + Date.now(), {
      headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (res.status === 404) return { data: emptyData(), sha: null };
    if (!res.ok) { const txt = await res.text(); throw new Error('GitHub-Fetch fehlgeschlagen: ' + res.status + ' — ' + txt.slice(0, 200)); }
    const json = await res.json();
    let data;
    try { data = JSON.parse(base64ToUtf8(json.content.replace(/\n/g, ''))); } catch (e) { data = emptyData(); }
    return normalizeData(data);
    function normalizeData(d) {
      if (!d.requests) d.requests = [];
      if (!d.history) d.history = [];
      if (!d.incomings) d.incomings = {};
      return { data: d, sha: json ? json.sha : null };
    }
  }
  function emptyData() { return { requests: [], history: [], incomings: {} }; }

  async function writeData(data, sha) {
    const token = getToken();
    if (!token) throw new Error('Kein GitHub-Token gesetzt.');
    const body = { message: 'WarHub: ' + new Date().toISOString(), content: utf8ToBase64(JSON.stringify(data, null, 2)), branch: GITHUB_BRANCH };
    if (sha) body.sha = sha;
    const res = await fetch(GITHUB_API, {
      method: 'PUT',
      headers: { 'Authorization': 'token ' + token, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' },
      body: JSON.stringify(body)
    });
    if (res.status === 409 || res.status === 422) { const err = new Error('SHA-Konflikt'); err.conflict = true; throw err; }
    if (!res.ok) { const txt = await res.text(); throw new Error('GitHub-Write fehlgeschlagen: ' + res.status + ' — ' + txt.slice(0, 200)); }
    const json = await res.json();
    return json.content.sha;
  }

  async function withConflictRetry(modifier, maxRetries = 4) {
    for (let i = 0; i < maxRetries; i++) {
      const { data, sha } = await fetchData();
      const newData = modifier(JSON.parse(JSON.stringify(data)));
      if (newData === null || newData === undefined) { cachedData = data; currentSha = sha; return data; }
      try {
        const newSha = await writeData(newData, sha);
        cachedData = newData; currentSha = newSha; return newData;
      } catch (e) {
        if (e.conflict && i < maxRetries - 1) { await sleep(400 + Math.random() * 600); continue; }
        throw e;
      }
    }
    throw new Error('Max retries erreicht — bitte später nochmal versuchen.');
  }

  /* ================= CONFIG + DISCORD ================= */

  async function loadConfig() {
    if (configCache) return configCache;
    const token = getToken();
    if (!token) { configCache = { webhook: null }; return configCache; }
    try {
      const res = await fetch(CONFIG_API + '?ref=' + GITHUB_BRANCH + '&cb=' + Date.now(), {
        headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!res.ok) { configCache = { webhook: null }; return configCache; }
      const json = await res.json();
      configCache = JSON.parse(base64ToUtf8(json.content.replace(/\n/g, '')));
      return configCache;
    } catch (e) { configCache = { webhook: null }; return configCache; }
  }

  async function postDiscord(content) {
    const config = await loadConfig();
    if (!config.webhook) return;
    try {
      await fetch(config.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
    } catch (e) { console.warn('[WarHub] Discord-Webhook POST fehlgeschlagen:', e); }
  }

  function discordMsgForCreate(req) {
    const m = TYPE_META[req.type];
    return [
      `${m.emoji} **${m.label} angefordert** — von ${req.requestedBy}`,
      `Ziel: \`${req.target}\``,
      `Ankunft: ${fmtDate(req.arrivalMs)}`,
      `Slots: 0/${req.slotsNeeded} übernommen`,
      req.notes ? `Notiz: ${req.notes}` : null
    ].filter(Boolean).join('\n');
  }

  /* ================= VILLAGES & UNITS ================= */

  async function loadVillagesAndUnits() {
    const html = await fetch('/game.php?screen=overview_villages&mode=units&type=home&group=0').then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const villages = [];
    doc.querySelectorAll('#units_table tbody tr').forEach(row => {
      const m = row.innerText.match(/\b\d{1,3}\|\d{1,3}\b/);
      if (!m) return;
      const [x, y] = m[0].split('|').map(Number);
      const tds = row.querySelectorAll('td.unit-item');
      const get = i => Number((tds[i]?.innerText || '0').replace(/\./g, ''));
      villages.push({ x, y, units: { spear: get(0), sword: get(1), axe: get(2), spy: get(3), light: get(4), heavy: get(5), ram: get(6), catapult: get(7), snob: get(8) } });
    });
    return villages;
  }

  async function loadVillageIds() {
    const txt = await fetch('/map/village.txt').then(r => r.text());
    const map = {};
    villageCoordByVid = {};
    txt.split('\n').forEach(l => {
      const p = l.split(',');
      if (p.length >= 4) { const coord = `${p[2]}|${p[3]}`; map[coord] = p[0]; villageCoordByVid[p[0]] = coord; }
    });
    return map;
  }

  async function refreshLocalState() {
    myVillages = await loadVillagesAndUnits();
    villageIdMap = await loadVillageIds();
  }

  /* ================= INCOMINGS SCRAPER (War-Monitor core) ================= */
  // Liest die EIGENEN eingehenden Angriffe vom Incomings-Screen und liefert
  // [{id, targetX, targetY, target, arrivalMs, isAttack}]. Markup-Muster aus der
  // erprobten dbautoupload.js: Angriff = .command_hover_details[data-command-type
  // ="attack"] ODER img[src*="attack"]; Ankunft = span[data-endtime] (unix s) oder
  // ein deutscher Datums-String; Ziel = das eigene Dorf der Zeile (info_village-
  // Link ODER Koordinate in der Zielspalte).

  function parseGermanDateToMs(str) {
    // "17.07.26 08:05:04" oder "17.07.2026 08:05:04" (evtl. "um" / Wochentag davor)
    const m = (str || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    let [, d, mo, y, h, mi, s] = m.map(Number);
    if (y < 100) y += 2000;
    const t = new Date(y, mo - 1, d, h, mi, s).getTime();
    return isNaN(t) ? null : t;
  }

  function extractArrivalMs(tr) {
    // 1) span[data-endtime] (Sekunden) ist am robustesten (Live-Timer).
    const span = tr.querySelector('span[data-endtime]');
    if (span) {
      const sec = parseInt(span.getAttribute('data-endtime'), 10);
      if (Number.isFinite(sec) && sec > 0) return sec * 1000;
    }
    // 2) Fallback: deutscher Datums-String in einer Zelle (Ankunftsspalte).
    for (const td of tr.querySelectorAll('td')) {
      const ms = parseGermanDateToMs(td.textContent);
      if (ms) return ms;
    }
    return null;
  }

  function extractTargetCoord(tr) {
    // Incomings-Screen listet pro Zeile das ZIEL-Dorf (dein Dorf). Nimm die
    // erste Koordinate in der Zeile die zu EINEM MEINER Dörfer gehört; sonst die
    // erste Koordinate überhaupt.
    const coords = [];
    (tr.innerText.match(/\d{1,3}\|\d{1,3}/g) || []).forEach(c => coords.push(c));
    if (!coords.length) return null;
    const mine = coords.find(c => myVillages.some(v => `${v.x}|${v.y}` === c));
    const pick = mine || coords[0];
    const [x, y] = pick.split('|').map(Number);
    return { x, y, coord: pick };
  }

  function isAttackRow(tr) {
    return !!tr.querySelector('.command_hover_details[data-command-type="attack"]')
        || !!tr.querySelector('img[src*="attack"]');
  }

  async function scrapeMyIncomings() {
    // Der Incomings-Screen (alle eingehenden Befehle über alle Dörfer).
    const url = '/game.php?screen=overview_villages&mode=incomings&type=all&subtype=attacks&group=0&page=-1';
    let doc;
    try {
      const html = await fetch(url, { credentials: 'include' }).then(r => r.text());
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (e) { console.warn('[WarHub] Incomings-Fetch fehlgeschlagen:', e); return null; }

    const table = doc.querySelector('#incomings_table') || doc.querySelector('#incomings_form table') || doc.querySelector('#commands_incomings');
    if (!table) return [];   // kein Incomings-Table = keine Angriffe (oder Screen leer)

    const body = table.tBodies && table.tBodies[0] ? table.tBodies[0] : table;
    const rows = Array.from(body.querySelectorAll('tr')).filter(tr => tr.querySelectorAll('td').length >= 2);

    const out = [];
    for (const tr of rows) {
      if (!isAttackRow(tr)) continue;          // nur echte Angriffe, kein Support
      const arrivalMs = extractArrivalMs(tr);
      if (!arrivalMs) continue;
      const tgt = extractTargetCoord(tr);
      if (!tgt) continue;
      const det = tr.querySelector('.command_hover_details[data-command-id]');
      const cb = tr.querySelector('input[type="checkbox"][name^="id_"]');
      const cid = (det && det.getAttribute('data-command-id')) || (cb && (cb.name.match(/^id_(\d+)/) || [])[1]) || `${tgt.coord}@${arrivalMs}`;
      out.push({ id: String(cid), targetX: tgt.x, targetY: tgt.y, target: tgt.coord, arrivalMs, isAttack: true });
    }
    return out;
  }

  // Push MEINEN incomings-Slice in den geteilten Store (nur mein eigener Key).
  async function uploadMyIncomings() {
    try {
      if (myVillages.length === 0) await refreshLocalState();
      const attacks = await scrapeMyIncomings();
      if (attacks === null) return;   // Fetch-Fehler → nicht überschreiben
      await withConflictRetry(data => {
        if (!data.incomings) data.incomings = {};
        data.incomings[PLAYER_NAME] = { updatedAt: Date.now(), attacks };
        return data;
      });
    } catch (e) {
      console.warn('[WarHub] Incomings-Upload fehlgeschlagen:', e);
    }
  }

  // Aggregiere alle Spieler-Slices → flache, entschärfte Angriffsliste fürs Board.
  function aggregateIncomings() {
    const inc = cachedData.incomings || {};
    const now = Date.now();
    const rows = [];
    const coverage = [];
    Object.keys(inc).forEach(player => {
      const slice = inc[player] || {};
      coverage.push({ player, updatedAt: slice.updatedAt || 0, stale: (now - (slice.updatedAt || 0)) > INC_PLAYER_STALE_MS, count: (slice.attacks || []).length });
      (slice.attacks || []).forEach(a => {
        if (!a || !a.arrivalMs) return;
        if (a.arrivalMs < now - INC_STALE_AFTER_MS) return;   // schon gelandet
        rows.push({ ...a, player });
      });
    });
    return { rows, coverage };
  }

  /* ================= FEASIBILITY ================= */

  function findAllViableVillages(req) {
    const meta = TYPE_META[req.type];
    if (!meta) return [];
    const arrivalSec = Math.floor(req.arrivalMs / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    const targetCoord = { x: req.targetX, y: req.targetY };
    const viable = [];
    myVillages.forEach(v => {
      if ((v.units.axe || 0) < meta.minAxe) return;
      if (meta.minSnob > 0 && (v.units.snob || 0) < meta.minSnob) return;
      if (v.x === req.targetX && v.y === req.targetY) return;
      const d = dist(v, targetCoord);
      const travel = travelSec(d, meta.mpf);
      const sendSec = arrivalSec - travel;
      if (sendSec <= nowSec) return;
      viable.push({ village: v, sendSec, travel, dist: d });
    });
    viable.sort((a, b) => a.dist - b.dist);
    return viable;
  }
  function findBestVillage(req) { return findAllViableVillages(req)[0] || null; }

  /* ================= WB IMPORT PARSER ================= */

  function parseWBLine(line) {
    const parts = (line || '').trim().split('&');
    if (parts.length < 4) return null;
    const toVid = parts[1];
    const slowestToken = parts[2];
    const arrivalMs = parseInt(parts[3], 10);
    if (!toVid || !arrivalMs || isNaN(arrivalMs)) return null;
    const coord = villageCoordByVid[toVid];
    if (!coord) return null;
    const [tx, ty] = coord.split('|').map(Number);
    let type = 'off';
    if (slowestToken === 'snob') type = 'voradeln';
    else if (slowestToken === 'ram' || slowestToken === 'catapult') type = 'off';
    else type = 'zc';
    return { targetX: tx, targetY: ty, target: coord, arrivalMs, type };
  }

  /* ================= REQUEST OPS ================= */

  function applyAutoCleanup(data) {
    const cutoff = Date.now() - AUTO_CLEANUP_OVERLAP_MS;
    const expired = [], open = [];
    data.requests.forEach(r => { if (r.arrivalMs <= cutoff) expired.push({ ...r, archivedAt: Date.now() }); else open.push(r); });
    // Auch veraltete incoming-Angriffe (gelandet) hier NICHT löschen — das macht
    // aggregateIncomings() clientseitig; der Store bleibt schlank durch Re-Upload.
    if (expired.length === 0) return null;
    data.requests = open;
    data.history = (data.history || []).concat(expired).slice(-200);
    return data;
  }

  function countMyOpenRequests(data) { return data.requests.filter(r => r.requestedBy === PLAYER_NAME).length; }

  async function createRequest({ type, targetX, targetY, arrivalMs, slotsNeeded, notes }) {
    const id = randId();
    const target = `${targetX}|${targetY}`;
    const newReq = { id, type, target, targetX, targetY, arrivalMs, slotsNeeded, claims: [], requestedBy: PLAYER_NAME, createdAt: Date.now(), notes: notes || '', reopenedAt: null };
    let createdReq = null;
    await withConflictRetry(data => {
      if (countMyOpenRequests(data) >= MAX_OPEN_REQUESTS_PER_PLAYER) throw new Error(`Du hast schon ${MAX_OPEN_REQUESTS_PER_PLAYER} offene Anfragen. Erst schließen oder löschen.`);
      data.requests.push(newReq); createdReq = newReq; return data;
    });
    if (createdReq) await postDiscord(discordMsgForCreate(createdReq));
    return createdReq;
  }

  async function claimSlot(requestId, fromVillage) {
    await withConflictRetry(data => {
      const req = data.requests.find(r => r.id === requestId);
      if (!req) throw new Error('Request nicht gefunden (evtl. schon geschlossen).');
      if (req.claims.length >= req.slotsNeeded) throw new Error('Bereits alle Slots übernommen.');
      if (req.claims.some(c => c.player === PLAYER_NAME)) throw new Error('Du hast schon einen Slot übernommen.');
      req.claims.push({ player: PLAYER_NAME, fromVillage, claimedAt: Date.now() });
      return data;
    });
  }

  async function releaseClaim(requestId) {
    await withConflictRetry(data => {
      const req = data.requests.find(r => r.id === requestId);
      if (!req) return null;
      const before = req.claims.length;
      req.claims = req.claims.filter(c => c.player !== PLAYER_NAME);
      if (req.claims.length === before) return null;
      if (req.claims.length < req.slotsNeeded) req.reopenedAt = Date.now();
      return data;
    });
  }

  async function deleteRequest(requestId) {
    await withConflictRetry(data => {
      const idx = data.requests.findIndex(r => r.id === requestId);
      if (idx < 0) return null;
      const req = data.requests[idx];
      if (req.requestedBy !== PLAYER_NAME) throw new Error('Kannst nur eigene Anfragen löschen.');
      data.requests.splice(idx, 1);
      return data;
    });
  }

  /* ================= WB EXPORT ================= */

  function buildClaimComp(village, type) {
    const meta = TYPE_META[type];
    const comp = { axe: village.units.axe || 0, light: village.units.light || 0, spy: Math.min(village.units.spy || 0, 50) };
    if (meta.withSiege) { comp.ram = village.units.ram || 0; comp.catapult = village.units.catapult || 0; }
    if (meta.sendsSnob) comp.snob = 1;
    return comp;
  }
  function wbLineFor(req, claim) {
    const fromVid = villageIdMap[claim.fromVillage];
    const toVid = villageIdMap[req.target];
    if (!fromVid || !toVid) return '';
    const village = myVillages.find(v => `${v.x}|${v.y}` === claim.fromVillage);
    if (!village) return '';
    const comp = buildClaimComp(village, req.type);
    const slowestToken = compSlowestToken(comp);
    const fields = WB_UNITS.map(u => `${u}=${toB64(comp[u] || 0)}`).join('/');
    return `${fromVid}&${toVid}&${slowestToken}&${req.arrivalMs}&0&false&true&${fields}`;
  }

  /* ================= UI: STYLE ================= */

  const style = document.createElement('style');
  style.id = 'mh-style';
  style.textContent = `
#mh-box { width: 560px; max-width: calc(100vw - 16px); margin: 12px auto;
  background: linear-gradient(160deg,#0f172a,#1e293b); border-radius: 14px; color: #e5e7eb;
  font-family: Inter, Verdana; box-shadow: 0 4px 18px rgba(0,0,0,.5); position: relative; z-index: 9999; }
#mh-header { padding: 12px; font-weight: 600; background: linear-gradient(90deg,#7c2d12,#9a3412);
  border-radius: 14px 14px 0 0; display: flex; justify-content: space-between; align-items: center; }
#mh-tabs { display: flex; background: #1e293b; border-bottom: 1px solid #334155; }
#mh-tabs button { flex: 1; padding: 8px 4px; background: transparent; border: none; color: #94a3b8;
  cursor: pointer; font-weight: 500; border-bottom: 2px solid transparent; font-size: 12px; }
#mh-tabs button.active { color: #fef3c7; border-bottom-color: #f97316; }
#mh-body { padding: 12px; max-height: 75vh; overflow-y: auto; }
#mh-body label { display: block; font-size: 11px; color: #94a3b8; margin-top: 6px; margin-bottom: 2px; }
#mh-tab-content > div { display: none; }
#mh-tab-content > div.active { display: block; }
#mh-body input, #mh-body textarea, #mh-body select { width: 100%; background: #020617; border: 1px solid #334155;
  border-radius: 8px; color: #e5e7eb; padding: 6px; margin-bottom: 6px; font-size: 12px; box-sizing: border-box; font-family: monospace; }
#mh-body button.mh-action { padding: 7px 12px; border-radius: 8px; font-weight: 600; border: none; cursor: pointer;
  background: linear-gradient(90deg,#f97316,#ea580c); color: #fff; font-size: 12px; margin-top: 4px; }
#mh-body button.mh-action:disabled { opacity: 0.5; cursor: not-allowed; background: #475569; }
#mh-body button.mh-secondary { padding: 5px 10px; border-radius: 6px; font-weight: 500; border: 1px solid #334155;
  cursor: pointer; background: transparent; color: #cbd5e1; font-size: 11px; margin-left: 4px; }
#mh-body button.mh-secondary:hover { background: #1e293b; }
#mh-status { font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; align-items: center; padding: 4px 2px; margin-bottom: 6px; }
.mh-req { background: #0f172a; border: 1px solid #1e293b; border-left-width: 4px; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
.mh-req-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.mh-type-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; color: #fff; }
.mh-coord { color: #fde68a; font-family: monospace; font-weight: 600; font-size: 13px; }
.mh-meta { font-size: 10px; color: #94a3b8; margin-bottom: 6px; line-height: 1.5; }
.mh-progress { display: flex; align-items: center; gap: 8px; font-size: 11px; margin-bottom: 6px; }
.mh-bar { flex: 1; height: 6px; background: #1e293b; border-radius: 3px; overflow: hidden; }
.mh-bar-fill { height: 100%; background: linear-gradient(90deg,#22c55e,#16a34a); transition: width 0.3s; }
.mh-claims { font-size: 10px; color: #cbd5e1; margin-bottom: 6px; background: #020617; padding: 4px 6px; border-radius: 4px; }
.mh-feas-ok { color: #22c55e; font-size: 10px; }
.mh-feas-fail { color: #ef4444; font-size: 10px; }
.mh-reopened { display: inline-block; padding: 1px 6px; background: #facc15; color: #422006; border-radius: 3px; font-size: 9px; font-weight: 700; margin-left: 4px; }
.mh-wb-out { background: #020617; border: 1px solid #334155; border-radius: 4px; padding: 4px 6px; font-family: monospace; font-size: 10px; margin-top: 4px; word-break: break-all; user-select: all; }
.mh-empty { text-align: center; color: #64748b; padding: 20px; font-size: 11px; }
/* War-Monitor */
.wh-war-row { display: flex; align-items: center; gap: 8px; background: #0f172a; border: 1px solid #1e293b;
  border-left-width: 4px; border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; }
.wh-war-row.soon { border-left-color: #ef4444; background: #1a0f13; }
.wh-war-row .wh-when { font-family: monospace; font-size: 11px; min-width: 74px; }
.wh-war-row .wh-cd { font-size: 10px; color: #fca5a5; }
.wh-war-tgt { color: #fde68a; font-family: monospace; font-weight: 600; font-size: 13px; }
.wh-war-owner { font-size: 10px; color: #94a3b8; }
.wh-war-help { margin-left: auto; }
.wh-cov { font-size: 10px; color: #64748b; background: #020617; border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; line-height: 1.6; }
.wh-cov b.stale { color: #f59e0b; }
.wh-cov b.fresh { color: #22c55e; }
.wh-count-badge { display:inline-block; min-width: 16px; text-align:center; background:#dc2626; color:#fff; border-radius: 8px; font-size: 9px; padding: 0 5px; margin-left: 4px; }
@media (max-width: 700px) {
  #mh-box { width: calc(100vw - 12px) !important; margin: 6px auto !important; max-height: 88vh !important; border-radius: 10px; }
  #mh-header { padding: 10px; font-size: 13px; } #mh-body { padding: 8px; max-height: 80vh; }
  #mh-tabs button { padding: 12px 3px; font-size: 12px; }
  #mh-body input, #mh-body textarea, #mh-body select { padding: 10px; font-size: 14px; min-height: 40px; }
  #mh-body button.mh-action { padding: 12px; font-size: 14px; min-height: 44px; }
  #mh-body button.mh-secondary { padding: 10px 14px; font-size: 12px; min-height: 38px; }
  .mh-req { padding: 10px; } .mh-req-head { flex-wrap: wrap; gap: 6px; } .mh-coord { font-size: 14px; }
  .wh-war-row { flex-wrap: wrap; } .mh-village-pick { width: 100% !important; flex: none !important; }
}
`;
  document.head.appendChild(style);

  /* ================= UI: MARKUP ================= */

  const box = document.createElement('div');
  box.id = 'mh-box';
  box.innerHTML = `
<div id="mh-header">
  <span>⚔ WarHub <span style="font-size:10px;opacity:0.7;">${VERSION}</span></span>
  <span id="mh-close" style="cursor:pointer;padding:4px 10px;">✕</span>
</div>
<div id="mh-tabs">
  <button class="active" data-tab="war">🛡 Krieg <span id="wh-war-count" class="wh-count-badge" style="display:none;">0</span></button>
  <button data-tab="list">Anfragen</button>
  <button data-tab="create">Erstellen</button>
  <button data-tab="mine">Meine</button>
</div>
<div id="mh-body">
  <div id="mh-status">
    <span id="mh-sync-info">noch nicht geladen</span>
    <span id="mh-refresh" style="cursor:pointer;color:#fde68a;">↻ Aktualisieren</span>
  </div>
  <div id="mh-tab-content">
    <!-- Tab: Kriegsübersicht (War-Monitor) -->
    <div id="mh-tab-war" class="active">
      <div id="wh-coverage" class="wh-cov"></div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="wh-sort-arrival" class="mh-secondary" style="flex:1;">⏱ nach Ankunft</button>
        <button id="wh-sort-target"  class="mh-secondary" style="flex:1;">🎯 nach Ziel</button>
        <button id="wh-upload-now"   class="mh-secondary" style="flex:1;" title="Meine Incomings jetzt hochladen">⬆ Sync meine</button>
      </div>
      <div id="wh-war-list"></div>
    </div>

    <!-- Tab: Anfragen-Liste -->
    <div id="mh-tab-list">
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="mh-filter-mine" class="mh-secondary" style="flex:1;">Nur meine</button>
        <button id="mh-filter-all" class="mh-secondary" style="flex:1;">Alle</button>
      </div>
      <div id="mh-req-list"></div>
    </div>

    <!-- Tab: Erstellen -->
    <div id="mh-tab-create">
      <details style="margin-bottom:10px;border:1px solid #334155;border-radius:6px;padding:6px 8px;background:#020617;">
        <summary style="cursor:pointer;font-size:11px;color:#fde68a;font-weight:600;">📥 Aus Workbench-Befehl(en) importieren</summary>
        <div style="padding-top:8px;">
          <label>WB-Zeilen (eine Anfrage pro Zeile, Herkunftsdorf wird ignoriert)</label>
          <textarea id="mh-wb-import" rows="4" placeholder="123456&789012&ram&1735894800000&0&false&true&spear=..."></textarea>
          <label>Typ-Mapping</label>
          <select id="mh-wb-import-type">
            <option value="auto">🪄 Auto pro Zeile (snob→Voradeln, ram/cat→OFF, sonst ZC)</option>
            <option value="off">⚔ OFF für alle</option>
            <option value="voradeln">👑 Voradeln für alle</option>
            <option value="zc">🧹 ZC für alle</option>
          </select>
          <label>Slots pro importierter Anfrage</label>
          <input id="mh-wb-import-slots" type="number" min="1" max="20" value="1">
          <button id="mh-wb-import-btn" class="mh-action" style="width:100%;">📥 Import + Anfragen erstellen</button>
        </div>
      </details>
      <label>Typ</label>
      <select id="mh-create-type">
        <option value="off">⚔ OFF (voller Nuker, kein Adel)</option>
        <option value="voradeln">👑 Voradeln (1 Adel + Begleitung)</option>
        <option value="zc">🧹 Zwischencleaner</option>
      </select>
      <label>Ziel-Koordinaten (z.B. 510|450)</label>
      <input id="mh-create-target" type="text" placeholder="510|450">
      <label>Ankunftszeit</label>
      <input id="mh-create-arrival" type="datetime-local" step="1">
      <label>Slots benötigt</label>
      <input id="mh-create-slots" type="number" min="1" max="20" value="1">
      <label>Notiz (optional)</label>
      <textarea id="mh-create-notes" rows="2" placeholder="z.B. nach den Adeln gleich nachklatschen"></textarea>
      <button id="mh-create-submit" class="mh-action" style="width:100%;">📤 Anfrage erstellen + Discord pingen</button>
      <div id="mh-create-info" style="font-size:10px;color:#94a3b8;margin-top:8px;"></div>
    </div>

    <!-- Tab: Meine -->
    <div id="mh-tab-mine">
      <div style="font-size:11px;font-weight:600;color:#fde68a;margin-bottom:6px;">Meine offenen Anfragen</div>
      <div id="mh-my-requests"></div>
      <div style="font-size:11px;font-weight:600;color:#fde68a;margin:12px 0 6px 0;">Meine Übernahmen</div>
      <div id="mh-my-claims"></div>
    </div>
  </div>
  <div style="text-align:right;font-size:10px;color:#94a3b8;margin-top:8px;">WarHub ${VERSION} · ${escHtml(PLAYER_NAME)} · Cap ${MAX_OPEN_REQUESTS_PER_PLAYER}</div>
</div>
`;
  const mount = document.getElementById('contentContainer') || document.body;
  mount.insertBefore(box, mount.firstChild);

  /* ================= RENDER: shared ================= */

  function renderStatus() {
    const el = document.getElementById('mh-sync-info');
    if (!el) return;
    if (!lastSyncAt) el.textContent = 'noch nicht geladen';
    else {
      const totalReq = cachedData.requests.length;
      const { rows } = aggregateIncomings();
      el.textContent = `📊 ${totalReq} Anfr. · 🛡 ${rows.length} Angriffe · synced ${fmtTime(lastSyncAt.getTime())}`;
    }
  }

  /* ================= RENDER: War-Monitor ================= */

  function renderWar() {
    const list = document.getElementById('wh-war-list');
    const cov = document.getElementById('wh-coverage');
    const badge = document.getElementById('wh-war-count');
    if (!list) return;
    const { rows, coverage } = aggregateIncomings();

    // Coverage-Zeile: wer teilt (frisch/veraltet).
    if (cov) {
      if (coverage.length === 0) {
        cov.innerHTML = '⚠ Noch keine Incomings geteilt. Sobald Mitglieder WarHub offen haben, erscheinen hier ihre Angriffe automatisch.';
      } else {
        const parts = coverage.sort((a, b) => a.player.localeCompare(b.player)).map(c => {
          const cls = c.stale ? 'stale' : 'fresh';
          const ago = c.updatedAt ? fmtCountdown(Date.now() - c.updatedAt) + ' her' : 'nie';
          return `<b class="${cls}">${escHtml(c.player)}</b> (${c.count}, ${ago})`;
        });
        cov.innerHTML = '📡 Teilen: ' + parts.join(' · ');
      }
    }

    // Angriffe sortieren.
    const now = Date.now();
    rows.sort((a, b) => warSort === 'target' ? (a.target.localeCompare(b.target) || a.arrivalMs - b.arrivalMs) : (a.arrivalMs - b.arrivalMs));

    if (badge) {
      const soon = rows.filter(r => r.arrivalMs - now < INC_SOON_MS).length;
      badge.textContent = String(rows.length);
      badge.style.display = rows.length ? 'inline-block' : 'none';
      badge.style.background = soon > 0 ? '#dc2626' : '#475569';
    }

    if (rows.length === 0) {
      list.innerHTML = '<div class="mh-empty">Keine bekannten eingehenden Angriffe 🎉<br><span style="font-size:10px;">(Zeigt Angriffe aller Mitglieder, die WarHub offen haben)</span></div>';
      return;
    }

    list.innerHTML = rows.map(r => {
      const til = r.arrivalMs - now;
      const soon = til < INC_SOON_MS;
      const cd = til > 0 ? `noch ${fmtCountdown(til)}` : 'gelandet';
      return `
        <div class="wh-war-row ${soon ? 'soon' : ''}">
          <div class="wh-when">${fmtTime(r.arrivalMs)}<div class="wh-cd">${cd}</div></div>
          <div>
            <span class="wh-war-tgt">${escHtml(r.target)}</span>
            <div class="wh-war-owner">${escHtml(r.player)}</div>
          </div>
          <div class="wh-war-help">
            <button class="mh-secondary wh-help-btn" data-wx="${r.targetX}" data-wy="${r.targetY}" data-warr="${r.arrivalMs}">🆘 Hilfe</button>
          </div>
        </div>`;
    }).join('');
  }

  /* ================= RENDER: requests (unverändert) ================= */

  function renderClaimsLine(req) {
    if (req.claims.length === 0) return '<i>noch keine Übernahmen</i>';
    return req.claims.map(c => `<b>${escHtml(c.player)}</b>${c.fromVillage ? ` (${escHtml(c.fromVillage)})` : ''}`).join(', ');
  }

  function renderRequestCard(req, options = {}) {
    const meta = TYPE_META[req.type] || TYPE_META.off;
    const slotsFilled = req.claims.length;
    const progressPct = Math.min(100, Math.round(100 * slotsFilled / req.slotsNeeded));
    const isMyClaim = req.claims.some(c => c.player === PLAYER_NAME);
    const myClaim = req.claims.find(c => c.player === PLAYER_NAME);
    const isMine = req.requestedBy === PLAYER_NAME;
    const isReopened = req.reopenedAt && (Date.now() - req.reopenedAt < REOPENED_BADGE_DURATION_MS);
    const reopenedBadge = isReopened ? `<span class="mh-reopened">↻ wieder offen</span>` : '';

    let feasHtml = '', actionHtml = '';
    if (isMyClaim) {
      const wbLine = wbLineFor(req, myClaim);
      actionHtml = `
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span class="mh-feas-ok">✓ Du übernimmst aus ${escHtml(myClaim.fromVillage)}</span>
          <button class="mh-secondary" data-action="release" data-id="${req.id}">↩ Freigeben</button>
          <button class="mh-secondary" data-action="wb" data-id="${req.id}">📋 WB kopieren</button>
        </div>
        <div class="mh-wb-out" data-wb="${escHtml(req.id)}" style="display:none;">${escHtml(wbLine)}</div>`;
    } else if (slotsFilled >= req.slotsNeeded) {
      actionHtml = `<span style="color:#22c55e;font-size:11px;">✓ Voll besetzt</span>`;
    } else {
      const viable = findAllViableVillages(req);
      if (viable.length > 0) {
        const optionsHtml = viable.map(c => `<option value="${c.village.x}|${c.village.y}">${c.village.x}|${c.village.y} — send ${fmtTime(c.sendSec * 1000)} (${c.dist.toFixed(1)}F)</option>`).join('');
        feasHtml = `<div class="mh-feas-ok">✓ ${viable.length} Dorf${viable.length > 1 ? 'er' : ''} möglich</div>`;
        actionHtml = `
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px;">
            <select class="mh-village-pick" data-id="${req.id}" style="flex:1;min-width:180px;">${optionsHtml}</select>
            <button class="mh-action" data-action="claim" data-id="${req.id}">Übernehmen</button>
          </div>`;
      } else {
        feasHtml = `<div class="mh-feas-fail">✗ Kein Dorf kann's pünktlich</div>`;
        actionHtml = `<button class="mh-action" disabled>kein passendes Dorf</button>`;
      }
    }

    const tilLeft = req.arrivalMs - Date.now();
    const countdown = tilLeft > 0 ? `noch ${fmtCountdown(tilLeft)}` : `<span style="color:#ef4444;">vergangen</span>`;
    const deleteBtn = (isMine && !options.hideDelete) ? `<button class="mh-secondary" data-action="delete" data-id="${req.id}" style="float:right;">🗑</button>` : '';

    return `
      <div class="mh-req" style="border-left-color:${meta.color};">
        <div class="mh-req-head">
          <span><span class="mh-type-badge" style="background:${meta.color};">${meta.emoji} ${meta.label}</span>
            <span class="mh-coord">${escHtml(req.target)}</span>${reopenedBadge}</span>
          <span>${deleteBtn}</span>
        </div>
        <div class="mh-meta">Ankunft <b>${fmtDate(req.arrivalMs)}</b> (${countdown})<br>
          Angefordert von <b>${escHtml(req.requestedBy)}</b>${req.notes ? ` — <i>${escHtml(req.notes)}</i>` : ''}</div>
        <div class="mh-progress"><span>${slotsFilled} / ${req.slotsNeeded} Slots</span>
          <div class="mh-bar"><div class="mh-bar-fill" style="width:${progressPct}%;"></div></div></div>
        <div class="mh-claims">${renderClaimsLine(req)}</div>
        ${feasHtml}${actionHtml}
      </div>`;
  }

  function renderList() {
    const out = document.getElementById('mh-req-list');
    if (!out) return;
    let list = cachedData.requests.slice();
    if (activeFilter === 'mine_only') {
      list = list.filter(r => findBestVillage(r) !== null || r.claims.some(c => c.player === PLAYER_NAME) || r.requestedBy === PLAYER_NAME);
    }
    list.sort((a, b) => {
      const ar = a.reopenedAt && (Date.now() - a.reopenedAt < REOPENED_BADGE_DURATION_MS) ? 1 : 0;
      const br = b.reopenedAt && (Date.now() - b.reopenedAt < REOPENED_BADGE_DURATION_MS) ? 1 : 0;
      if (ar !== br) return br - ar;
      return a.arrivalMs - b.arrivalMs;
    });
    if (list.length === 0) { out.innerHTML = `<div class="mh-empty">Keine offenen Anfragen ${activeFilter === 'mine_only' ? '(die du übernehmen könntest)' : ''}</div>`; return; }
    out.innerHTML = list.map(r => renderRequestCard(r)).join('');
    document.getElementById('mh-filter-mine').style.background = activeFilter === 'mine_only' ? '#334155' : '';
    document.getElementById('mh-filter-all').style.background = activeFilter === 'all' ? '#334155' : '';
  }

  function renderMine() {
    const myReqOut = document.getElementById('mh-my-requests');
    const myClaimsOut = document.getElementById('mh-my-claims');
    if (!myReqOut || !myClaimsOut) return;
    const myRequests = cachedData.requests.filter(r => r.requestedBy === PLAYER_NAME);
    const myClaims = cachedData.requests.filter(r => r.claims.some(c => c.player === PLAYER_NAME));
    myReqOut.innerHTML = myRequests.length === 0 ? `<div class="mh-empty">Keine offenen eigenen Anfragen (Cap: ${MAX_OPEN_REQUESTS_PER_PLAYER})</div>` : myRequests.map(r => renderRequestCard(r)).join('');
    myClaimsOut.innerHTML = myClaims.length === 0 ? `<div class="mh-empty">Du hast nichts übernommen</div>` : myClaims.map(r => renderRequestCard(r, { hideDelete: true })).join('');
  }

  function renderAll() { renderStatus(); renderWar(); renderList(); renderMine(); updateCreateInfo(); }

  function updateCreateInfo() {
    const el = document.getElementById('mh-create-info');
    if (!el) return;
    const mine = countMyOpenRequests(cachedData);
    el.textContent = `Du hast aktuell ${mine}/${MAX_OPEN_REQUESTS_PER_PLAYER} offene Anfragen.`;
    const btn = document.getElementById('mh-create-submit');
    if (btn) btn.disabled = mine >= MAX_OPEN_REQUESTS_PER_PLAYER;
  }

  /* ================= REFRESH + POLL + UPLOAD ================= */

  async function refresh() {
    try {
      if (myVillages.length === 0) await refreshLocalState();
      await withConflictRetry(data => applyAutoCleanup(data));
      lastSyncAt = new Date();
      renderAll();
    } catch (e) {
      console.error('[WarHub] Refresh-Fehler:', e);
      const el = document.getElementById('mh-sync-info');
      if (el) el.textContent = '⚠ ' + e.message;
    }
  }

  function startPolling() {
    if (!window._mhPoll) window._mhPoll = setInterval(refresh, POLL_INTERVAL_MS);
    // Auto-Upload der eigenen Incomings (eigener, langsamerer Takt).
    if (!window._whIncTimer) {
      window._whIncTimer = setInterval(async () => { await uploadMyIncomings(); await refresh(); }, INC_UPLOAD_INTERVAL_MS);
    }
  }
  function stopPolling() {
    if (window._mhPoll) { clearInterval(window._mhPoll); window._mhPoll = null; }
    if (window._whIncTimer) { clearInterval(window._whIncTimer); window._whIncTimer = null; }
  }

  /* ================= EVENTS ================= */

  function bindEvents() {
    const calc = document.getElementById('mh-create-submit');
    const closeBtn = document.getElementById('mh-close');
    const body = document.getElementById('mh-body');
    const tabBtns = document.querySelectorAll('#mh-tabs button');
    const refreshBtn = document.getElementById('mh-refresh');

    if (!calc || !closeBtn || !body || tabBtns.length === 0) return setTimeout(bindEvents, 50);

    tabBtns.forEach(btn => {
      btn.onclick = () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('#mh-tab-content > div').forEach(d => d.classList.remove('active'));
        document.getElementById(`mh-tab-${tab}`).classList.add('active');
        if (tab === 'mine') renderMine();
        if (tab === 'create') updateCreateInfo();
        if (tab === 'war') renderWar();
      };
    });

    closeBtn.onclick = () => { try { sessionStorage.setItem('mh_closed', '1'); } catch (e) {} stopPolling(); box.remove(); };
    refreshBtn.onclick = refresh;

    document.getElementById('mh-filter-mine').onclick = () => { activeFilter = 'mine_only'; renderList(); };
    document.getElementById('mh-filter-all').onclick   = () => { activeFilter = 'all'; renderList(); };

    // War-Monitor controls
    document.getElementById('wh-sort-arrival').onclick = () => { warSort = 'arrival'; renderWar(); };
    document.getElementById('wh-sort-target').onclick  = () => { warSort = 'target'; renderWar(); };
    const upBtn = document.getElementById('wh-upload-now');
    if (upBtn) upBtn.onclick = async () => {
      upBtn.disabled = true; upBtn.textContent = '⏳…';
      try { await uploadMyIncomings(); await refresh(); } finally { upBtn.disabled = false; upBtn.textContent = '⬆ Sync meine'; }
    };

    calc.onclick = async () => {
      try {
        calc.disabled = true; calc.textContent = '⏳ erstelle…';
        const type = document.getElementById('mh-create-type').value;
        const coord = parseCoord(document.getElementById('mh-create-target').value);
        const arrivalStr = document.getElementById('mh-create-arrival').value;
        const slotsNeeded = Math.max(1, Math.min(20, +document.getElementById('mh-create-slots').value || 1));
        const notes = document.getElementById('mh-create-notes').value.trim();
        if (!coord) { alert('Ungültige Koordinaten — Format z.B. 510|450'); return; }
        if (!arrivalStr) { alert('Ankunftszeit eingeben.'); return; }
        const arrivalMs = new Date(arrivalStr).getTime();
        if (isNaN(arrivalMs)) { alert('Ankunftszeit konnte nicht geparsed werden.'); return; }
        if (arrivalMs <= Date.now()) { alert('Ankunftszeit muss in der Zukunft liegen.'); return; }
        await createRequest({ type, targetX: coord.x, targetY: coord.y, arrivalMs, slotsNeeded, notes });
        document.getElementById('mh-create-target').value = '';
        document.getElementById('mh-create-notes').value = '';
        document.querySelector('#mh-tabs button[data-tab="list"]').click();
        await refresh();
        alert('Anfrage erstellt + Discord gepingt.');
      } catch (e) { alert('Fehler: ' + e.message); }
      finally { calc.disabled = false; calc.textContent = '📤 Anfrage erstellen + Discord pingen'; updateCreateInfo(); }
    };

    // WB-Import
    const wbImportBtn = document.getElementById('mh-wb-import-btn');
    if (wbImportBtn) wbImportBtn.onclick = async () => {
      try {
        wbImportBtn.disabled = true; wbImportBtn.textContent = '⏳ importiere…';
        if (Object.keys(villageCoordByVid).length === 0) await loadVillageIds();
        const text = document.getElementById('mh-wb-import').value;
        const typeOverride = document.getElementById('mh-wb-import-type').value;
        const slotsImport = Math.max(1, Math.min(20, +document.getElementById('mh-wb-import-slots').value || 1));
        const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
        if (lines.length === 0) { alert('Keine WB-Zeilen eingefügt.'); return; }
        const parsed = [], skipped = [];
        lines.forEach(l => { const p = parseWBLine(l); if (p) parsed.push(p); else skipped.push(l.slice(0, 40)); });
        if (parsed.length === 0) { alert(`Keine validen WB-Zeilen.\nÜbersprungen: ${skipped.length}.`); return; }
        const myOpen = countMyOpenRequests(cachedData);
        if (myOpen + parsed.length > MAX_OPEN_REQUESTS_PER_PLAYER) {
          const max = MAX_OPEN_REQUESTS_PER_PLAYER - myOpen;
          if (max <= 0) { alert(`Cap ${MAX_OPEN_REQUESTS_PER_PLAYER} erreicht.`); return; }
          if (!confirm(`Cap würde überschritten — nur erste ${max} importieren?`)) return;
          parsed.length = max;
        }
        const summary = parsed.map(p => `  ${p.target} @ ${fmtTime(p.arrivalMs)} (${TYPE_META[typeOverride === 'auto' ? p.type : typeOverride].label})`).join('\n');
        if (!confirm(`${parsed.length} Anfrage(n) erstellen?\n\n${summary}`)) return;
        let created = 0;
        for (const p of parsed) {
          try { await createRequest({ type: typeOverride === 'auto' ? p.type : typeOverride, targetX: p.targetX, targetY: p.targetY, arrivalMs: p.arrivalMs, slotsNeeded: slotsImport, notes: '' }); created++; }
          catch (e) { console.warn('[WarHub] Import skip:', e.message); }
        }
        document.getElementById('mh-wb-import').value = '';
        document.querySelector('#mh-tabs button[data-tab="list"]').click();
        await refresh();
        alert(`${created} Anfrage(n) erstellt.`);
      } catch (e) { alert('Fehler: ' + e.message); }
      finally { wbImportBtn.disabled = false; wbImportBtn.textContent = '📥 Import + Anfragen erstellen'; }
    };

    // Delegated: claim/release/delete/wb + War "Hilfe anfordern"
    body.addEventListener('click', async (e) => {
      // War: 🆘 Hilfe → springt zu Erstellen mit vorausgefülltem Ziel + Ankunft.
      const helpBtn = e.target.closest('button.wh-help-btn');
      if (helpBtn) {
        const tx = helpBtn.dataset.wx, ty = helpBtn.dataset.wy, arr = +helpBtn.dataset.warr;
        document.querySelector('#mh-tabs button[data-tab="create"]').click();
        document.getElementById('mh-create-target').value = `${tx}|${ty}`;
        document.getElementById('mh-create-type').value = 'zc';   // Defense-Hilfe = ZC default
        // Ankunft = kurz VOR dem Einschlag (Verteidigung soll vorher landen).
        const pre = new Date(arr - 60000);
        const pad = n => String(n).padStart(2, '0');
        document.getElementById('mh-create-arrival').value =
          `${pre.getFullYear()}-${pad(pre.getMonth()+1)}-${pad(pre.getDate())}T${pad(pre.getHours())}:${pad(pre.getMinutes())}:${pad(pre.getSeconds())}`;
        document.getElementById('mh-create-notes').value = `Verteidigung für ${tx}|${ty} (Angriff ${fmtTime(arr)})`;
        return;
      }
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action, id = btn.dataset.id;
      try {
        btn.disabled = true;
        if (action === 'claim') {
          const select = body.querySelector(`select.mh-village-pick[data-id="${id}"]`);
          const fromVillage = (btn.dataset.village || (select && select.value) || '').trim();
          if (!fromVillage) { alert('Kein Dorf gewählt.'); btn.disabled = false; return; }
          await claimSlot(id, fromVillage); await refresh();
        } else if (action === 'release') {
          if (!confirm('Slot wirklich freigeben?')) { btn.disabled = false; return; }
          await releaseClaim(id); await refresh();
        } else if (action === 'delete') {
          if (!confirm('Eigene Anfrage löschen?')) { btn.disabled = false; return; }
          await deleteRequest(id); await refresh();
        } else if (action === 'wb') {
          const out = body.querySelector(`.mh-wb-out[data-wb="${id}"]`);
          if (out) { out.style.display = out.style.display === 'none' ? 'block' : 'none'; if (out.style.display === 'block') { try { await navigator.clipboard.writeText(out.textContent); } catch (err) {} } }
          btn.disabled = false;
        }
      } catch (err) { alert('Fehler: ' + err.message); btn.disabled = false; }
    });

    // Erststart: State laden, eigene Incomings hochladen, Polling starten.
    (async () => {
      await refresh();
      await uploadMyIncomings();
      await refresh();
      startPolling();
    })();
  }

  bindEvents();
})();

