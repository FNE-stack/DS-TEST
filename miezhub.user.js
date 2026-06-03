// ==UserScript==
// @name         MiezHub
// @author       FNE
// @match        https://*.die-staemme.de/game.php?*
// @version      1.0
// @description  Stamm-OFF-Anforderungs-Hub mit GitHub-Sync + Discord-Webhook (Multi-Claim, 3 Typen)
// @grant        none
// ==/UserScript==

// =============================================================================
// EINSATZ:
//   (A) Tampermonkey: Script speichern, läuft auto auf jedem game.php Page-Load
//   (B) Schnelleiste:  diese Zeile in einen Quickbar-Eintrag packen:
//       javascript: window.LAUNCHPAD_TOKEN='DEIN_TOKEN';
//                   $.getScript('https://fne-stack.github.io/DS-TEST/miezhub.user.js?cb='+Date.now());
//
// WEBHOOK-CONFIG (privat im DS-PLAN Repo):
//   Datei:    DS-PLAN/miezhub.config.json
//   Inhalt:   { "webhook": "https://discord.com/api/webhooks/.../..." }
//   → Wird beim ersten Discord-Ping per GitHub-API mit deinem Token gefetcht.
//   → Nicht-authorisierte Drittparteien (public Script-Repo) sehen die URL nie.
// =============================================================================

(function () {
  'use strict';

  // Cleanup vorherige Instanz
  document.querySelectorAll('#mh-box, #mh-toggle, #mh-style').forEach(el => el.remove());
  if (window._mhPoll) { clearInterval(window._mhPoll); window._mhPoll = null; }

  // Launchpad-Pattern: Panel ist Default-on. Closed-Flag in sessionStorage merkt sich
  // wenn der User explizit geschlossen hat (= stay closed bei TM-Auto-Load auf nächster Seite).
  // Quickbar-Tap killt das Flag immer → Re-Tap macht Panel sicher wieder auf, auch in der App.
  const IS_QUICKBAR_TAP = !!(window.LAUNCHPAD_TOKEN || window.MIEZHUB_TOKEN);
  if (IS_QUICKBAR_TAP) {
    try { sessionStorage.removeItem('mh_closed'); } catch (e) {}
  }
  try {
    if (sessionStorage.getItem('mh_closed') === '1') return;  // User hat geschlossen — Script exit
  } catch (e) {}

  /* ================= CONFIG ================= */

  const VERSION = 'v1';
  const GITHUB_OWNER = 'FNE-stack';
  const GITHUB_DATA_REPO = 'DS-PLAN';            // privat
  const GITHUB_BRANCH = 'main';
  const GITHUB_FILE = 'miezhub.json';
  const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_DATA_REPO}/contents/${GITHUB_FILE}`;

  // Discord-Webhook wird zur Laufzeit aus DS-PLAN/miezhub.config.json gefetcht
  // (siehe Kommentar oben). Der Wert steht NICHT im Script und ist nur mit gültigem
  // Token erreichbar.
  const CONFIG_FILE = 'miezhub.config.json';
  const CONFIG_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_DATA_REPO}/contents/${CONFIG_FILE}`;
  let configCache = null;

  const MAX_OPEN_REQUESTS_PER_PLAYER = 3;
  const REOPENED_BADGE_DURATION_MS = 10 * 60 * 1000; // 10 min
  const POLL_INTERVAL_MS = 60000;
  const AUTO_CLEANUP_OVERLAP_MS = 5 * 60 * 1000; // erst 5 min nach arrival ausräumen

  const PLAYER_NAME = (typeof game_data !== 'undefined' && game_data.player && game_data.player.name) ? game_data.player.name : 'unknown';
  const WORLD_SPEED = (typeof game_data !== 'undefined' && game_data.speed) ? game_data.speed : 1;

  // Token: erst window.MIEZHUB_TOKEN, dann window.LAUNCHPAD_TOKEN, dann localStorage.
  // Wenn launchpad-Quickbar geklickt wurde → window.LAUNCHPAD_TOKEN gesetzt → wir
  // sichern's in localStorage damit's bei späteren Page-Loads ohne Quickbar funzt.
  function getToken() {
    const t = (typeof window !== 'undefined' && (window.MIEZHUB_TOKEN || window.LAUNCHPAD_TOKEN)) || localStorage.getItem('miezhub_token') || '';
    if (t) try { localStorage.setItem('miezhub_token', t); } catch (e) {}
    return t;
  }

  /* ================= CONSTANTS ================= */

  const UNIT_MPF = {
    spear: 18, sword: 22, axe: 18, archer: 18,
    spy: 9, light: 10, marcher: 10, heavy: 11,
    ram: 30, catapult: 30, knight: 10, snob: 35
  };

  const WB_UNITS = ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob','militia'];

  // Voradeln = Loyalität runterziehen damit Kollege mit weniger als 4 AGs adeln kann.
  // Daher MUSS 1 Adel rein (sendsSnob: true, minSnob: 1) — slowest wird snob (35 mpf).
  const TYPE_META = {
    off:      { label: 'OFF',             color: '#dc2626', mpf: 30, minAxe: 2000, withSiege: true,  sendsSnob: false, minSnob: 0, emoji: '⚔' },
    voradeln: { label: 'Voradeln',        color: '#f97316', mpf: 35, minAxe: 1000, withSiege: true,  sendsSnob: true,  minSnob: 1, emoji: '👑' },
    zc:       { label: 'Zwischencleaner', color: '#22c55e', mpf: 18, minAxe: 500,  withSiege: false, sendsSnob: false, minSnob: 0, emoji: '🧹' }
  };

  /* ================= STATE ================= */

  let cachedData = { requests: [], history: [] };
  let currentSha = null;
  let myVillages = [];          // [{vid, x, y, units: {...}}]
  let villageIdMap = {};        // "x|y" → vid
  let villageCoordByVid = {};   // vid → "x|y" (für WB-Import-Reverse-Lookup)
  // pollTimer wird in window._mhPoll gespeichert damit Re-Tap der Quickbar
  // den alten Interval-Timer killen kann (siehe Cleanup oben).
  let lastSyncAt = null;
  let panelOpen = false;
  let activeFilter = 'mine_only';  // 'mine_only' | 'all'

  /* ================= HELPERS ================= */

  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function base64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(b64)));
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function randId() {
    return 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function fmtDate(ms) {
    return new Date(ms).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  function fmtTime(ms) {
    return new Date(ms).toLocaleString('de-DE', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
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

  function dist(a, b) {
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }
  function travelSec(d, mpf) {
    return d * mpf * 60 / WORLD_SPEED;
  }

  function toB64(n) { return n && n > 0 ? btoa(String(n)) : ''; }

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
    if (!token) throw new Error('Kein GitHub-Token gesetzt. Setz via Quickbar window.LAUNCHPAD_TOKEN oder window.MIEZHUB_TOKEN.');

    const res = await fetch(GITHUB_API + '?ref=' + GITHUB_BRANCH + '&cb=' + Date.now(), {
      headers: {
        'Authorization': 'token ' + token,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (res.status === 404) {
      return { data: { requests: [], history: [] }, sha: null };
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error('GitHub-Fetch fehlgeschlagen: ' + res.status + ' — ' + txt.slice(0, 200));
    }
    const json = await res.json();
    let data;
    try {
      data = JSON.parse(base64ToUtf8(json.content.replace(/\n/g, '')));
    } catch (e) {
      data = { requests: [], history: [] };
    }
    if (!data.requests) data.requests = [];
    if (!data.history) data.history = [];
    return { data, sha: json.sha };
  }

  async function writeData(data, sha) {
    const token = getToken();
    if (!token) throw new Error('Kein GitHub-Token gesetzt.');

    const body = {
      message: 'MiezHub: ' + new Date().toISOString(),
      content: utf8ToBase64(JSON.stringify(data, null, 2)),
      branch: GITHUB_BRANCH
    };
    if (sha) body.sha = sha;

    const res = await fetch(GITHUB_API, {
      method: 'PUT',
      headers: {
        'Authorization': 'token ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(body)
    });
    if (res.status === 409 || res.status === 422) {
      const err = new Error('SHA-Konflikt');
      err.conflict = true;
      throw err;
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error('GitHub-Write fehlgeschlagen: ' + res.status + ' — ' + txt.slice(0, 200));
    }
    const json = await res.json();
    return json.content.sha;
  }

  // Read-modify-write mit Konflikt-Retry. modifier(data) → modified data oder null (=kein Write).
  async function withConflictRetry(modifier, maxRetries = 4) {
    for (let i = 0; i < maxRetries; i++) {
      const { data, sha } = await fetchData();
      const newData = modifier(JSON.parse(JSON.stringify(data)));  // deep copy
      if (newData === null || newData === undefined) {
        cachedData = data;
        currentSha = sha;
        return data;
      }
      try {
        const newSha = await writeData(newData, sha);
        cachedData = newData;
        currentSha = newSha;
        return newData;
      } catch (e) {
        if (e.conflict && i < maxRetries - 1) {
          await sleep(400 + Math.random() * 600);
          continue;
        }
        throw e;
      }
    }
    throw new Error('Max retries erreicht — bitte später nochmal versuchen.');
  }

  /* ================= CONFIG LOAD (Webhook aus privatem Repo) ================= */

  async function loadConfig() {
    if (configCache) return configCache;
    const token = getToken();
    if (!token) {
      configCache = { webhook: null };
      return configCache;
    }
    try {
      const res = await fetch(CONFIG_API + '?ref=' + GITHUB_BRANCH + '&cb=' + Date.now(), {
        headers: {
          'Authorization': 'token ' + token,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (!res.ok) {
        console.warn('[MiezHub] miezhub.config.json nicht gefunden (' + res.status + ') — Discord-Pings deaktiviert.');
        configCache = { webhook: null };
        return configCache;
      }
      const json = await res.json();
      configCache = JSON.parse(base64ToUtf8(json.content.replace(/\n/g, '')));
      if (!configCache.webhook) {
        console.warn('[MiezHub] Config ohne "webhook" — Discord-Pings deaktiviert.');
      }
      return configCache;
    } catch (e) {
      console.warn('[MiezHub] Config-Load Fehler:', e);
      configCache = { webhook: null };
      return configCache;
    }
  }

  /* ================= DISCORD WEBHOOK ================= */

  async function postDiscord(content) {
    const config = await loadConfig();
    if (!config.webhook) return;  // soft-fail wenn Webhook nicht konfiguriert
    try {
      await fetch(config.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
    } catch (e) {
      console.warn('[MiezHub] Discord-Webhook POST fehlgeschlagen:', e);
    }
  }

  function discordMsgForCreate(req) {
    const m = TYPE_META[req.type];
    return [
      `${m.emoji} **${m.label} angefordert** — von ${req.requestedBy}`,
      `Ziel: \`${req.target}\``,
      `Ankunft: ${fmtDate(req.arrivalMs)}`,
      `Slots: 0/${req.slotsNeeded} übernommen`,
      req.notes ? `Notiz: ${req.notes}` : null,
      `→ MiezHub öffnen zum Übernehmen`
    ].filter(Boolean).join('\n');
  }

  /* ================= LOAD VILLAGES & TRUPPEN ================= */

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
      villages.push({
        x, y,
        units: {
          spear: get(0), sword: get(1), axe: get(2), spy: get(3),
          light: get(4), heavy: get(5), ram: get(6), catapult: get(7),
          snob: get(8)
        }
      });
    });
    return villages;
  }

  async function loadVillageIds() {
    const txt = await fetch('/map/village.txt').then(r => r.text());
    const map = {};
    villageCoordByVid = {};
    txt.split('\n').forEach(l => {
      const p = l.split(',');
      if (p.length >= 4) {
        const coord = `${p[2]}|${p[3]}`;
        map[coord] = p[0];
        villageCoordByVid[p[0]] = coord;
      }
    });
    return map;
  }

  async function refreshLocalState() {
    myVillages = await loadVillagesAndUnits();
    villageIdMap = await loadVillageIds();
  }

  /* ================= FEASIBILITY ================= */

  // Alle MEINER Dörfer die diesen Request erfüllen können — sortiert nach Distanz.
  // Returns [{ village, sendSec, travel, dist }, ...]
  function findAllViableVillages(req) {
    const meta = TYPE_META[req.type];
    if (!meta) return [];

    const arrivalSec = Math.floor(req.arrivalMs / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    const targetCoord = { x: req.targetX, y: req.targetY };

    const viable = [];
    myVillages.forEach(v => {
      if ((v.units.axe || 0) < meta.minAxe) return;
      if (meta.minSnob > 0 && (v.units.snob || 0) < meta.minSnob) return;  // Voradeln braucht Adel
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

  function findBestVillage(req) {
    const all = findAllViableVillages(req);
    return all[0] || null;
  }

  /* ================= WB IMPORT PARSER ================= */

  // Format: fromVid&toVid&slowestToken&arrivalMs&0&false&true&unit=B64/unit=B64/...
  // Returns { targetX, targetY, target, arrivalMs, type } oder null.
  // fromVid wird verworfen — Quelldorf wird beim Claim individuell gewählt.
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

    // Auto-Erkennung des Typs aus dem Slowest-Token:
    //  snob → Voradeln (Loyalitäts-Drop mit 1 Adel)
    //  ram/cat → OFF (voller Nuker mit Belagerung)
    //  axe/spear/sword/heavy/light/marcher → ZC (Cleaner ohne Adel/Siege)
    let type = 'off';
    if (slowestToken === 'snob') type = 'voradeln';
    else if (slowestToken === 'ram' || slowestToken === 'catapult') type = 'off';
    else type = 'zc';

    return { targetX: tx, targetY: ty, target: coord, arrivalMs, type };
  }

  /* ================= REQUEST OPS ================= */

  function applyAutoCleanup(data) {
    const cutoff = Date.now() - AUTO_CLEANUP_OVERLAP_MS;
    const expired = [];
    const open = [];
    data.requests.forEach(r => {
      if (r.arrivalMs <= cutoff) {
        expired.push({ ...r, archivedAt: Date.now() });
      } else {
        open.push(r);
      }
    });
    if (expired.length === 0) return null;  // nichts zu tun
    data.requests = open;
    data.history = (data.history || []).concat(expired).slice(-200);
    return data;
  }

  function countMyOpenRequests(data) {
    return data.requests.filter(r => r.requestedBy === PLAYER_NAME).length;
  }

  async function createRequest({ type, targetX, targetY, arrivalMs, slotsNeeded, notes }) {
    const id = randId();
    const target = `${targetX}|${targetY}`;
    const newReq = {
      id, type, target, targetX, targetY,
      arrivalMs, slotsNeeded,
      claims: [],
      requestedBy: PLAYER_NAME,
      createdAt: Date.now(),
      notes: notes || '',
      reopenedAt: null
    };

    let createdReq = null;
    await withConflictRetry(data => {
      if (countMyOpenRequests(data) >= MAX_OPEN_REQUESTS_PER_PLAYER) {
        throw new Error(`Du hast schon ${MAX_OPEN_REQUESTS_PER_PLAYER} offene Anfragen. Erst schließen oder löschen.`);
      }
      data.requests.push(newReq);
      createdReq = newReq;
      return data;
    });

    if (createdReq) await postDiscord(discordMsgForCreate(createdReq));
    return createdReq;
  }

  async function claimSlot(requestId, fromVillage) {
    // fromVillage: "x|y" string
    await withConflictRetry(data => {
      const req = data.requests.find(r => r.id === requestId);
      if (!req) throw new Error('Request nicht gefunden (evtl. schon geschlossen).');
      if (req.claims.length >= req.slotsNeeded) throw new Error('Bereits alle Slots übernommen.');
      if (req.claims.some(c => c.player === PLAYER_NAME)) throw new Error('Du hast schon einen Slot übernommen.');

      req.claims.push({
        player: PLAYER_NAME,
        fromVillage,
        claimedAt: Date.now()
      });
      return data;
    });
  }

  async function releaseClaim(requestId) {
    await withConflictRetry(data => {
      const req = data.requests.find(r => r.id === requestId);
      if (!req) return null;
      const before = req.claims.length;
      req.claims = req.claims.filter(c => c.player !== PLAYER_NAME);
      if (req.claims.length === before) return null;  // war gar nicht claimed
      if (req.claims.length < req.slotsNeeded) {
        req.reopenedAt = Date.now();
      }
      return data;
    });
  }

  async function deleteRequest(requestId) {
    await withConflictRetry(data => {
      const idx = data.requests.findIndex(r => r.id === requestId);
      if (idx < 0) return null;
      const req = data.requests[idx];
      if (req.requestedBy !== PLAYER_NAME) {
        throw new Error('Kannst nur eigene Anfragen löschen.');
      }
      data.requests.splice(idx, 1);
      return data;
    });
  }

  /* ================= WB EXPORT ================= */

  function buildClaimComp(village, type) {
    const meta = TYPE_META[type];
    const comp = {
      axe: village.units.axe || 0,
      light: village.units.light || 0,
      spy: Math.min(village.units.spy || 0, 50)
    };
    if (meta.withSiege) {
      comp.ram = village.units.ram || 0;
      comp.catapult = village.units.catapult || 0;
    }
    if (meta.sendsSnob) {
      comp.snob = 1;  // Voradeln = 1 Adel mit voller Begleitung
    }
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

  /* ================= UI ================= */

  const style = document.createElement('style');
  style.id = 'mh-style';
  style.textContent = `
#mh-box {
  width: 540px;
  max-width: calc(100vw - 16px);
  margin: 12px auto;
  background: linear-gradient(160deg,#0f172a,#1e293b);
  border-radius: 14px;
  color: #e5e7eb;
  font-family: Inter, Verdana;
  box-shadow: 0 4px 18px rgba(0,0,0,.5);
  position: relative;
  z-index: 9999;
}
#mh-header {
  padding: 12px;
  font-weight: 600;
  background: linear-gradient(90deg,#7c2d12,#9a3412);
  border-radius: 14px 14px 0 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
#mh-tabs {
  display: flex;
  background: #1e293b;
  border-bottom: 1px solid #334155;
}
#mh-tabs button {
  flex: 1;
  padding: 8px;
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  font-size: 12px;
}
#mh-tabs button.active {
  color: #fef3c7;
  border-bottom-color: #f97316;
}
#mh-body {
  padding: 12px;
  max-height: 75vh;
  overflow-y: auto;
}
#mh-body label {
  display: block;
  font-size: 11px;
  color: #94a3b8;
  margin-top: 6px;
  margin-bottom: 2px;
}
#mh-tab-content > div { display: none; }
#mh-tab-content > div.active { display: block; }
#mh-body input,
#mh-body textarea,
#mh-body select {
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
#mh-body button.mh-action {
  padding: 7px 12px;
  border-radius: 8px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  background: linear-gradient(90deg,#f97316,#ea580c);
  color: #fff;
  font-size: 12px;
  margin-top: 4px;
}
#mh-body button.mh-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: #475569;
}
#mh-body button.mh-secondary {
  padding: 5px 10px;
  border-radius: 6px;
  font-weight: 500;
  border: 1px solid #334155;
  cursor: pointer;
  background: transparent;
  color: #cbd5e1;
  font-size: 11px;
  margin-left: 4px;
}
#mh-body button.mh-secondary:hover {
  background: #1e293b;
}
#mh-status {
  font-size: 10px;
  color: #94a3b8;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 2px;
  margin-bottom: 6px;
}
.mh-req {
  background: #0f172a;
  border: 1px solid #1e293b;
  border-left-width: 4px;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
}
.mh-req-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.mh-type-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
}
.mh-coord {
  color: #fde68a;
  font-family: monospace;
  font-weight: 600;
  font-size: 13px;
}
.mh-meta {
  font-size: 10px;
  color: #94a3b8;
  margin-bottom: 6px;
  line-height: 1.5;
}
.mh-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  margin-bottom: 6px;
}
.mh-bar {
  flex: 1;
  height: 6px;
  background: #1e293b;
  border-radius: 3px;
  overflow: hidden;
}
.mh-bar-fill {
  height: 100%;
  background: linear-gradient(90deg,#22c55e,#16a34a);
  transition: width 0.3s;
}
.mh-claims {
  font-size: 10px;
  color: #cbd5e1;
  margin-bottom: 6px;
  background: #020617;
  padding: 4px 6px;
  border-radius: 4px;
}
.mh-feas-ok { color: #22c55e; font-size: 10px; }
.mh-feas-fail { color: #ef4444; font-size: 10px; }
.mh-reopened {
  display: inline-block;
  padding: 1px 6px;
  background: #facc15;
  color: #422006;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  margin-left: 4px;
}
.mh-wb-out {
  background: #020617;
  border: 1px solid #334155;
  border-radius: 4px;
  padding: 4px 6px;
  font-family: monospace;
  font-size: 10px;
  margin-top: 4px;
  word-break: break-all;
  user-select: all;
}
.mh-empty {
  text-align: center;
  color: #64748b;
  padding: 20px;
  font-size: 11px;
}
/* Mobile / TW App: Panel über volle Breite, größere Touch-Targets */
@media (max-width: 700px) {
  #mh-box {
    width: calc(100vw - 12px) !important;
    margin: 6px auto !important;
    max-height: 88vh !important;
    border-radius: 10px;
  }
  #mh-header { padding: 10px; font-size: 13px; }
  #mh-body { padding: 8px; max-height: 80vh; }
  #mh-tabs button { padding: 12px 4px; font-size: 13px; }
  #mh-body input,
  #mh-body textarea,
  #mh-body select {
    padding: 10px;
    font-size: 14px;          /* >=16px verhindert iOS-Zoom, 14 ist Kompromiss */
    min-height: 40px;
  }
  #mh-body button.mh-action {
    padding: 12px;
    font-size: 14px;
    min-height: 44px;
  }
  #mh-body button.mh-secondary {
    padding: 10px 14px;
    font-size: 12px;
    min-height: 38px;
  }
  .mh-req { padding: 10px; }
  .mh-req-head { flex-wrap: wrap; gap: 6px; }
  .mh-coord { font-size: 14px; }
  .mh-progress { font-size: 12px; }
  .mh-wb-out { font-size: 11px; }
  /* Action-Reihe (Dropdown + Button) untereinander damit's nicht überquillt */
  .mh-village-pick { width: 100% !important; flex: none !important; }
}
`;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.id = 'mh-box';
  box.innerHTML = `
<div id="mh-header">
  <span>🐾 MiezHub <span style="font-size:10px;opacity:0.7;">${VERSION}</span></span>
  <span id="mh-close" style="cursor:pointer;padding:4px 10px;">✕</span>
</div>
<div id="mh-tabs">
  <button class="active" data-tab="list">Anfragen</button>
  <button data-tab="create">Erstellen</button>
  <button data-tab="mine">Meine</button>
</div>
<div id="mh-body">
  <div id="mh-status">
    <span id="mh-sync-info">noch nicht geladen</span>
    <span id="mh-refresh" style="cursor:pointer;color:#fde68a;">↻ Aktualisieren</span>
  </div>
  <div id="mh-tab-content">
    <!-- Tab: Liste -->
    <div id="mh-tab-list" class="active">
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
        <option value="voradeln">👑 Voradeln (1 Adel + Begleitung — Loyalität runterziehen für Kollegen-Adelung)</option>
        <option value="zc">🧹 Zwischencleaner (Cleaner zwischen feindlichen Adelswellen)</option>
      </select>

      <label>Ziel-Koordinaten (z.B. 510|450)</label>
      <input id="mh-create-target" type="text" placeholder="510|450">

      <label>Ankunftszeit</label>
      <input id="mh-create-arrival" type="datetime-local" step="1">

      <label>Slots benötigt (Anzahl Übernehmer)</label>
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
  <div style="text-align:right;font-size:10px;color:#94a3b8;margin-top:8px;">MiezHub ${VERSION} · ${escHtml(PLAYER_NAME)} · Cap ${MAX_OPEN_REQUESTS_PER_PLAYER}</div>
</div>
`;
  // Inline-Mount wie launchpad: direkt in #contentContainer (oder body fallback) prependen.
  // Kein Questlog-Icon mehr — Panel ist Default-sichtbar, Close-Button räumt's weg.
  // Funktioniert auch in der TW App weil keine Desktop-Sidebar nötig ist.
  const mount = document.getElementById('contentContainer') || document.body;
  mount.insertBefore(box, mount.firstChild);

  /* ================= RENDER ================= */

  function renderStatus() {
    const el = document.getElementById('mh-sync-info');
    if (!el) return;
    if (!lastSyncAt) el.textContent = 'noch nicht geladen';
    else {
      const totalReq = cachedData.requests.length;
      el.textContent = `📊 ${totalReq} offen · synced ${fmtTime(lastSyncAt.getTime())}`;
    }
  }

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

    // Feasibility
    let feasHtml = '';
    let actionHtml = '';
    if (isMyClaim) {
      // Show my claim + release button + WB export
      const wbLine = wbLineFor(req, myClaim);
      actionHtml = `
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span class="mh-feas-ok">✓ Du übernimmst aus ${escHtml(myClaim.fromVillage)}</span>
          <button class="mh-secondary" data-action="release" data-id="${req.id}">↩ Freigeben</button>
          <button class="mh-secondary" data-action="wb" data-id="${req.id}">📋 WB kopieren</button>
        </div>
        <div class="mh-wb-out" data-wb="${escHtml(req.id)}" style="display:none;">${escHtml(wbLine)}</div>
      `;
    } else if (slotsFilled >= req.slotsNeeded) {
      actionHtml = `<span style="color:#22c55e;font-size:11px;">✓ Voll besetzt</span>`;
    } else {
      const viable = findAllViableVillages(req);
      if (viable.length > 0) {
        const optionsHtml = viable.map(c => {
          const sendTime = fmtTime(c.sendSec * 1000);
          return `<option value="${c.village.x}|${c.village.y}">${c.village.x}|${c.village.y} — send ${sendTime} (${c.dist.toFixed(1)}F)</option>`;
        }).join('');
        feasHtml = `<div class="mh-feas-ok">✓ ${viable.length} Dorf${viable.length > 1 ? 'er' : ''} möglich (sortiert nach Nähe)</div>`;
        actionHtml = `
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px;">
            <select class="mh-village-pick" data-id="${req.id}" style="flex:1;min-width:180px;">${optionsHtml}</select>
            <button class="mh-action" data-action="claim" data-id="${req.id}">Übernehmen</button>
          </div>
        `;
      } else {
        feasHtml = `<div class="mh-feas-fail">✗ Kein Dorf kann's pünktlich (zu weit oder zu wenig Truppen)</div>`;
        actionHtml = `<button class="mh-action" disabled>kein passendes Dorf</button>`;
      }
    }

    const tilLeft = req.arrivalMs - Date.now();
    const countdown = tilLeft > 0 ? `noch ${fmtCountdown(tilLeft)}` : `<span style="color:#ef4444;">vergangen</span>`;

    const deleteBtn = (isMine && !options.hideDelete) ? `<button class="mh-secondary" data-action="delete" data-id="${req.id}" style="float:right;">🗑</button>` : '';

    return `
      <div class="mh-req" style="border-left-color:${meta.color};">
        <div class="mh-req-head">
          <span>
            <span class="mh-type-badge" style="background:${meta.color};">${meta.emoji} ${meta.label}</span>
            <span class="mh-coord">${escHtml(req.target)}</span>
            ${reopenedBadge}
          </span>
          <span>${deleteBtn}</span>
        </div>
        <div class="mh-meta">
          Ankunft <b>${fmtDate(req.arrivalMs)}</b> (${countdown})<br>
          Angefordert von <b>${escHtml(req.requestedBy)}</b>${req.notes ? ` — <i>${escHtml(req.notes)}</i>` : ''}
        </div>
        <div class="mh-progress">
          <span>${slotsFilled} / ${req.slotsNeeded} Slots</span>
          <div class="mh-bar"><div class="mh-bar-fill" style="width:${progressPct}%;"></div></div>
        </div>
        <div class="mh-claims">${renderClaimsLine(req)}</div>
        ${feasHtml}
        ${actionHtml}
      </div>
    `;
  }

  function renderList() {
    const out = document.getElementById('mh-req-list');
    if (!out) return;
    let list = cachedData.requests.slice();

    if (activeFilter === 'mine_only') {
      list = list.filter(r => findBestVillage(r) !== null || r.claims.some(c => c.player === PLAYER_NAME) || r.requestedBy === PLAYER_NAME);
    }

    // Re-opened zuerst, dann nach Ankunftszeit
    list.sort((a, b) => {
      const aReopened = a.reopenedAt && (Date.now() - a.reopenedAt < REOPENED_BADGE_DURATION_MS) ? 1 : 0;
      const bReopened = b.reopenedAt && (Date.now() - b.reopenedAt < REOPENED_BADGE_DURATION_MS) ? 1 : 0;
      if (aReopened !== bReopened) return bReopened - aReopened;
      return a.arrivalMs - b.arrivalMs;
    });

    if (list.length === 0) {
      out.innerHTML = `<div class="mh-empty">Keine offenen Anfragen ${activeFilter === 'mine_only' ? '(die du übernehmen könntest)' : ''}</div>`;
      return;
    }

    out.innerHTML = list.map(r => renderRequestCard(r)).join('');

    // Filter-Toggle Aktive markieren
    document.getElementById('mh-filter-mine').style.background = activeFilter === 'mine_only' ? '#334155' : '';
    document.getElementById('mh-filter-all').style.background = activeFilter === 'all' ? '#334155' : '';
  }

  function renderMine() {
    const myReqOut = document.getElementById('mh-my-requests');
    const myClaimsOut = document.getElementById('mh-my-claims');
    if (!myReqOut || !myClaimsOut) return;

    const myRequests = cachedData.requests.filter(r => r.requestedBy === PLAYER_NAME);
    const myClaims = cachedData.requests.filter(r => r.claims.some(c => c.player === PLAYER_NAME));

    myReqOut.innerHTML = myRequests.length === 0
      ? `<div class="mh-empty">Keine offenen eigenen Anfragen (Cap: ${MAX_OPEN_REQUESTS_PER_PLAYER})</div>`
      : myRequests.map(r => renderRequestCard(r)).join('');

    myClaimsOut.innerHTML = myClaims.length === 0
      ? `<div class="mh-empty">Du hast nichts übernommen</div>`
      : myClaims.map(r => renderRequestCard(r, { hideDelete: true })).join('');
  }

  function renderAll() {
    renderStatus();
    renderList();
    renderMine();
    updateCreateInfo();
  }

  function updateCreateInfo() {
    const el = document.getElementById('mh-create-info');
    if (!el) return;
    const mine = countMyOpenRequests(cachedData);
    el.textContent = `Du hast aktuell ${mine}/${MAX_OPEN_REQUESTS_PER_PLAYER} offene Anfragen.`;
    document.getElementById('mh-create-submit').disabled = mine >= MAX_OPEN_REQUESTS_PER_PLAYER;
  }

  /* ================= REFRESH + POLL ================= */

  async function refresh() {
    try {
      // Lokalen State laden (Dörfer + IDs) wenn noch nicht da
      if (myVillages.length === 0) {
        await refreshLocalState();
      }

      // Auto-Cleanup + Fetch in einem Conflict-Retry
      await withConflictRetry(data => applyAutoCleanup(data));
      // Falls Cleanup nichts geändert hat, cachedData/sha sind durch withConflictRetry's "no-write" Pfad gesetzt

      lastSyncAt = new Date();
      renderAll();
    } catch (e) {
      console.error('[MiezHub] Refresh-Fehler:', e);
      const el = document.getElementById('mh-sync-info');
      if (el) el.textContent = '⚠ ' + e.message;
    }
  }

  function startPolling() {
    if (window._mhPoll) return;
    window._mhPoll = setInterval(refresh, POLL_INTERVAL_MS);
  }
  function stopPolling() {
    if (window._mhPoll) { clearInterval(window._mhPoll); window._mhPoll = null; }
  }

  /* ================= EVENTS ================= */

  function bindEvents() {
    const calc = document.getElementById('mh-create-submit');
    const closeBtn = document.getElementById('mh-close');
    const header = document.getElementById('mh-header');
    const body = document.getElementById('mh-body');
    const tabBtns = document.querySelectorAll('#mh-tabs button');
    const refreshBtn = document.getElementById('mh-refresh');
    const filterMineBtn = document.getElementById('mh-filter-mine');
    const filterAllBtn = document.getElementById('mh-filter-all');

    if (!calc || !closeBtn || !header || !body || tabBtns.length === 0) {
      return setTimeout(bindEvents, 50);
    }

    // Tabs
    tabBtns.forEach(btn => {
      btn.onclick = () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('#mh-tab-content > div').forEach(d => d.classList.remove('active'));
        document.getElementById(`mh-tab-${tab}`).classList.add('active');
        if (tab === 'mine') renderMine();
        if (tab === 'create') updateCreateInfo();
      };
    });

    // Close: Panel komplett aus dem DOM + Closed-Flag setzen.
    // Re-Öffnen → Quickbar-Tap (löscht das Flag wieder).
    closeBtn.onclick = () => {
      try { sessionStorage.setItem('mh_closed', '1'); } catch (e) {}
      stopPolling();
      box.remove();
    };

    // Manual refresh
    refreshBtn.onclick = refresh;

    // Filter toggles
    filterMineBtn.onclick = () => { activeFilter = 'mine_only'; renderList(); };
    filterAllBtn.onclick   = () => { activeFilter = 'all';        renderList(); };

    // Create request submission
    calc.onclick = async () => {
      try {
        calc.disabled = true;
        calc.textContent = '⏳ erstelle…';

        const type = document.getElementById('mh-create-type').value;
        const targetStr = document.getElementById('mh-create-target').value;
        const arrivalStr = document.getElementById('mh-create-arrival').value;
        const slotsNeeded = Math.max(1, Math.min(20, +document.getElementById('mh-create-slots').value || 1));
        const notes = document.getElementById('mh-create-notes').value.trim();

        const coord = parseCoord(targetStr);
        if (!coord) { alert('Ungültige Koordinaten — Format z.B. 510|450'); return; }
        if (!arrivalStr) { alert('Ankunftszeit eingeben.'); return; }

        // datetime-local hat keinen Zeitzonen-Suffix → wird als lokale Zeit interpretiert
        const arrivalMs = new Date(arrivalStr).getTime();
        if (isNaN(arrivalMs)) { alert('Ankunftszeit konnte nicht geparsed werden.'); return; }
        if (arrivalMs <= Date.now()) { alert('Ankunftszeit muss in der Zukunft liegen.'); return; }

        await createRequest({
          type,
          targetX: coord.x, targetY: coord.y,
          arrivalMs, slotsNeeded, notes
        });

        // Reset form
        document.getElementById('mh-create-target').value = '';
        document.getElementById('mh-create-notes').value = '';
        // Switch to list tab
        document.querySelector('#mh-tabs button[data-tab="list"]').click();
        await refresh();
        alert('Anfrage erstellt + Discord gepingt.');
      } catch (e) {
        console.error('[MiezHub] Create-Fehler:', e);
        alert('Fehler: ' + e.message);
      } finally {
        calc.disabled = false;
        calc.textContent = '📤 Anfrage erstellen + Discord pingen';
        updateCreateInfo();
      }
    };

    // Panel ist Default-sichtbar → direkt syncen + Polling starten
    refresh();
    startPolling();

    // WB-Import → Anfragen erstellen
    const wbImportBtn = document.getElementById('mh-wb-import-btn');
    if (wbImportBtn) {
      wbImportBtn.onclick = async () => {
        try {
          wbImportBtn.disabled = true;
          wbImportBtn.textContent = '⏳ importiere…';

          // VillageCoordByVid sicher laden (für Reverse-Lookup)
          if (Object.keys(villageCoordByVid).length === 0) await loadVillageIds();

          const text = document.getElementById('mh-wb-import').value;
          const typeOverride = document.getElementById('mh-wb-import-type').value;
          const slotsImport = Math.max(1, Math.min(20, +document.getElementById('mh-wb-import-slots').value || 1));

          const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
          if (lines.length === 0) { alert('Keine WB-Zeilen eingefügt.'); return; }

          const parsed = [];
          const skipped = [];
          lines.forEach(l => {
            const p = parseWBLine(l);
            if (p) parsed.push(p); else skipped.push(l.slice(0, 40));
          });

          if (parsed.length === 0) {
            alert(`Keine validen WB-Zeilen geparsed.\n\nÜbersprungen: ${skipped.length} Zeile(n).`);
            return;
          }

          // Cap-Check vorab (cumulativ)
          const myOpen = countMyOpenRequests(cachedData);
          if (myOpen + parsed.length > MAX_OPEN_REQUESTS_PER_PLAYER) {
            const max = MAX_OPEN_REQUESTS_PER_PLAYER - myOpen;
            if (max <= 0) {
              alert(`Du hast schon ${MAX_OPEN_REQUESTS_PER_PLAYER} offene Anfragen. Erst schließen oder löschen.`);
              return;
            }
            if (!confirm(`Cap ${MAX_OPEN_REQUESTS_PER_PLAYER} würde überschritten — nur die ersten ${max} importieren?`)) return;
            parsed.length = max;
          }

          const summary = parsed.map(p => `  ${p.target} @ ${fmtTime(p.arrivalMs)} (${TYPE_META[typeOverride === 'auto' ? p.type : typeOverride].label})`).join('\n');
          if (!confirm(`${parsed.length} Anfrage(n) erstellen?\n\n${summary}${skipped.length > 0 ? `\n\n(${skipped.length} Zeile(n) übersprungen)` : ''}`)) return;

          let created = 0;
          for (const p of parsed) {
            try {
              const type = typeOverride === 'auto' ? p.type : typeOverride;
              await createRequest({
                type,
                targetX: p.targetX, targetY: p.targetY,
                arrivalMs: p.arrivalMs,
                slotsNeeded: slotsImport,
                notes: ''
              });
              created++;
            } catch (e) {
              console.warn('[MiezHub] Import skip:', e.message);
            }
          }

          document.getElementById('mh-wb-import').value = '';
          document.querySelector('#mh-tabs button[data-tab="list"]').click();
          await refresh();
          alert(`${created} Anfrage(n) erstellt + auf Discord gepingt.`);
        } catch (e) {
          console.error('[MiezHub] WB-Import Fehler:', e);
          alert('Fehler: ' + e.message);
        } finally {
          wbImportBtn.disabled = false;
          wbImportBtn.textContent = '📥 Import + Anfragen erstellen';
        }
      };
    }

    // Delegated handler for claim/release/delete/wb
    body.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      try {
        btn.disabled = true;
        if (action === 'claim') {
          const select = body.querySelector(`select.mh-village-pick[data-id="${id}"]`);
          const fromVillage = (btn.dataset.village || (select && select.value) || '').trim();
          if (!fromVillage) { alert('Kein Dorf gewählt.'); btn.disabled = false; return; }
          await claimSlot(id, fromVillage);
          await refresh();
        } else if (action === 'release') {
          if (!confirm('Slot wirklich freigeben?')) { btn.disabled = false; return; }
          await releaseClaim(id);
          await refresh();
        } else if (action === 'delete') {
          if (!confirm('Eigene Anfrage löschen?')) { btn.disabled = false; return; }
          await deleteRequest(id);
          await refresh();
        } else if (action === 'wb') {
          const out = body.querySelector(`.mh-wb-out[data-wb="${id}"]`);
          if (out) {
            out.style.display = out.style.display === 'none' ? 'block' : 'none';
            if (out.style.display === 'block') {
              try { await navigator.clipboard.writeText(out.textContent); } catch (err) {}
            }
          }
          btn.disabled = false;
        }
      } catch (err) {
        console.error('[MiezHub]', action, 'Fehler:', err);
        alert('Fehler: ' + err.message);
        btn.disabled = false;
      }
    });
  }

  bindEvents();

})();
