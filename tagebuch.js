// ═══════════════════════════════════════════════════════════════════════════
// Hundetagebuch — Oberfläche.
//
// Hängt sich an das bestehende Handbuch an: dieselben Farben, dasselbe
// React-ohne-JSX wie dort. Eigene Datei, damit hundetraining.html nur um ein
// paar Zeilen wächst und das Handbuch selbst unangetastet bleibt.
//
// Einträge liegen beim Worker, damit beide Handys denselben Stand sehen.
// Angemeldet bleibt man über ein Token im localStorage.
// ═══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  var h = React.createElement, useState = React.useState, useEffect = React.useEffect;

  var API = global.DIARY_API || 'https://hundetagebuch.fabian-neidl.workers.dev';
  var TOKEN_KEY = 'hundetagebuch_token';
  var NAME_KEY = 'hundetagebuch_name';

  // Kategorien: antippbar, damit ein Eintrag in Sekunden steht. Die Gruppen
  // tauchen später in der Tierarzt-Zusammenfassung als Überschriften auf.
  var CATS = [
    { id: 'erbrechen',  label: 'Erbrechen',  group: 'Magen & Darm' },
    { id: 'durchfall',  label: 'Durchfall',  group: 'Magen & Darm' },
    { id: 'kot',        label: 'Kot auffällig', group: 'Magen & Darm' },
    { id: 'appetit',    label: 'Appetit',    group: 'Magen & Darm' },
    { id: 'trinken',    label: 'Trinkmenge', group: 'Magen & Darm' },
    { id: 'humpeln',    label: 'Humpeln',    group: 'Bewegung' },
    { id: 'zittern',    label: 'Zittern',    group: 'Bewegung' },
    { id: 'unruhe',     label: 'Unruhe',     group: 'Verhalten' },
    { id: 'juckreiz',   label: 'Juckreiz',   group: 'Haut & Fell' },
    { id: 'haut',       label: 'Haut',       group: 'Haut & Fell' },
    { id: 'ohren',      label: 'Ohren',      group: 'Kopf' },
    { id: 'augen',      label: 'Augen',      group: 'Kopf' },
    { id: 'husten',     label: 'Husten',     group: 'Atmung' },
    { id: 'futter',     label: 'Futter',     group: 'Alltag' },
    { id: 'medikament', label: 'Medikament', group: 'Behandlung' },
    { id: 'tierarzt',   label: 'Tierarzt',   group: 'Behandlung' },
    { id: 'gewicht',    label: 'Gewicht',    group: 'Alltag' },
    { id: 'sonstiges',  label: 'Sonstiges',  group: 'Alltag' },
  ];
  var CAT = {}; CATS.forEach(function (c) { CAT[c.id] = c; });
  var SEV_LABEL = ['', 'ganz leicht', 'leicht', 'mittel', 'stark', 'sehr stark'];

  // Trainingsthemen = die Kapitel des Handbuchs, plus ein paar Alltagssachen,
  // die dort nicht als eigenes Kapitel stehen. So laesst sich spaeter sagen
  // "Kapitel 5 laeuft seit drei Wochen besser", ohne eine zweite Gliederung
  // zu erfinden.
  var TOPICS = [
    { id: 'beziehung',        label: 'Beziehung & Grundhaltung', ch: '01' },
    { id: 'stellvertreter',   label: 'Stellvertreterkonflikte',  ch: '02' },
    { id: 'leine',            label: 'Orientierung an der Leine', ch: '03' },
    { id: 'distanz',          label: 'Orientierung auf Distanz',  ch: '04' },
    { id: 'begegnungen',      label: 'Hundebegegnungen',          ch: '05' },
    { id: 'alltag',           label: 'Alltagsleinenführigkeit',   ch: '06' },
    { id: 'rueckorientierung', label: 'Automatische Rückorientierung', ch: '07' },
    { id: 'warte-stopp',      label: 'Warte & Not-Stopp',         ch: '08' },
    { id: 'rueckruf',         label: 'Rückruf',                   ch: '' },
    { id: 'allein',           label: 'Alleinbleiben',             ch: '' },
    { id: 'autofahren',       label: 'Autofahren',                ch: '' },
    { id: 'besuch',           label: 'Besuch zu Hause',           ch: '' },
    { id: 'sonstiges',        label: 'Sonstiges',                 ch: '' },
  ];
  var TOPIC = {}; TOPICS.forEach(function (t) { TOPIC[t.id] = t; });
  // -2 .. +2, damit "lief schlecht" und "lief gut" gleich weit auseinander
  // liegen und 0 ehrlich "wie immer" heisst.
  var RATING = { '-2': 'schwierig', '-1': 'durchwachsen', '0': 'wie immer', '1': 'gut', '2': 'sehr gut' };
  var isTraining = function (e) { return e && e.kind === 'training'; };
  var ofKind = function (entries, kind) {
    return (entries || []).filter(function (e) {
      return kind === 'training' ? isTraining(e) : !isTraining(e);
    });
  };

  // ── kleine Helfer ────────────────────────────────────────────────────────
  function two(n) { return String(n).padStart(2, '0'); }
  function localNow() {
    var d = new Date();
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function dayOf(at) { return String(at).slice(0, 10); }
  function fmtDay(iso) {
    var d = new Date(iso + 'T12:00');
    var heute = dayOf(localNow());
    if (iso === heute) return 'Heute';
    var g = new Date(); g.setDate(g.getDate() - 1);
    if (iso === g.getFullYear() + '-' + two(g.getMonth() + 1) + '-' + two(g.getDate())) return 'Gestern';
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function fmtTime(at) { return String(at).slice(11, 16); }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    var tok = null;
    try { tok = localStorage.getItem(TOKEN_KEY); } catch (e) {}
    if (tok) headers.Authorization = 'Bearer ' + tok;
    return fetch(API + path, {
      method: opts.method || 'GET', headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('Fehler ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  // ── Zusammenfassung für den Tierarzt ─────────────────────────────────────
  // Das Ziel ist nicht, alle Notizen aneinanderzuhängen, sondern die Muster
  // sichtbar zu machen: wie oft, seit wann, wie schlimm, und in welchem
  // Abstand. Die Notizen kommen darunter, vollständig, damit nichts verloren
  // geht - aber die Übersicht steht oben.
  function summarize(entries, days) {
    var since = new Date(); since.setDate(since.getDate() - (days || 30));
    var sinceIso = since.getFullYear() + '-' + two(since.getMonth() + 1) + '-' + two(since.getDate());
    // Nur Gesundheit - Trainingseinträge haben beim Tierarzt nichts verloren.
    var rows = ofKind(entries, 'health').filter(function (e) { return dayOf(e.at) >= sinceIso; })
                      .sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
    if (!rows.length) return null;

    var byCat = {};
    rows.forEach(function (e) {
      (e.cats || []).forEach(function (c) {
        var b = byCat[c] || (byCat[c] = { n: 0, first: e.at, last: e.at, sev: [], days: {} });
        b.n++; b.last = e.at;
        if (e.sev) b.sev.push(e.sev);
        b.days[dayOf(e.at)] = true;
      });
    });
    var cats = Object.keys(byCat).map(function (c) {
      var b = byCat[c];
      var avg = b.sev.length ? b.sev.reduce(function (x, y) { return x + y; }, 0) / b.sev.length : null;
      var spanDays = Math.max(1, Math.round((new Date(b.last) - new Date(b.first)) / 86400000) + 1);
      return {
        id: c, label: (CAT[c] || {}).label || c, group: (CAT[c] || {}).group || 'Sonstiges',
        n: b.n, tage: Object.keys(b.days).length, first: b.first, last: b.last,
        avg: avg, max: b.sev.length ? Math.max.apply(null, b.sev) : null, spanDays: spanDays,
      };
    }).sort(function (a, b) { return b.n - a.n; });

    return {
      von: rows[0].at, bis: rows[rows.length - 1].at, days: days || 30,
      anzahl: rows.length, tage: Object.keys(rows.reduce(function (m, e) { m[dayOf(e.at)] = 1; return m; }, {})).length,
      cats: cats, entries: rows,
    };
  }

  function summaryText(sum, hundName) {
    if (!sum) return '';
    var L = [];
    L.push('Tagebuch' + (hundName ? ' — ' + hundName : ''));
    L.push('Zeitraum: ' + fmtDay(dayOf(sum.von)) + ' bis ' + fmtDay(dayOf(sum.bis))
           + ' (' + sum.anzahl + ' Einträge an ' + sum.tage + ' Tagen)');
    L.push('');
    L.push('BEOBACHTUNGEN');
    sum.cats.forEach(function (c) {
      var t = '- ' + c.label + ': ' + c.n + '×';
      if (c.tage > 1) t += ' an ' + c.tage + ' Tagen';
      t += ', ' + fmtDay(dayOf(c.first)).replace('Heute', 'heute').replace('Gestern', 'gestern');
      if (dayOf(c.first) !== dayOf(c.last)) t += ' bis ' + fmtDay(dayOf(c.last)).replace('Heute', 'heute').replace('Gestern', 'gestern');
      if (c.avg) t += ', Stärke ' + (Math.round(c.avg * 10) / 10) + ' von 5' + (c.max > c.avg ? ' (max. ' + c.max + ')' : '');
      L.push(t);
    });
    L.push('');
    L.push('EINTRÄGE');
    sum.entries.forEach(function (e) {
      var head = fmtDay(dayOf(e.at)) + ', ' + fmtTime(e.at);
      var labels = (e.cats || []).map(function (c) { return (CAT[c] || {}).label || c; }).join(', ');
      if (labels) head += ' — ' + labels;
      if (e.sev) head += ' (' + SEV_LABEL[e.sev] + ')';
      L.push(head);
      if (e.temp) L.push('   Temperatur: ' + e.temp + ' °C');
      if (e.weight) L.push('   Gewicht: ' + e.weight + ' kg');
      if (e.note) L.push('   ' + e.note.replace(/\n/g, '\n   '));
      if (e.by) L.push('   (notiert von ' + e.by + ')');
    });
    return L.join('\n');
  }

  // Trainingsrückblick. Die Frage ist nicht "wie oft war was", sondern
  // "woran arbeiten wir, und wird es besser?" - deshalb Tendenz statt Häufung:
  // der Schnitt der letzten Einträge gegen den davor.
  function trainingReview(entries, days) {
    var since = new Date(); since.setDate(since.getDate() - (days || 30));
    var sinceIso = since.getFullYear() + '-' + two(since.getMonth() + 1) + '-' + two(since.getDate());
    var rows = ofKind(entries, 'training')
      .filter(function (e) { return dayOf(e.at) >= sinceIso; })
      .sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
    if (!rows.length) return null;

    var byTopic = {};
    rows.forEach(function (e) {
      (e.cats || []).forEach(function (t) {
        var b = byTopic[t] || (byTopic[t] = { n: 0, first: e.at, last: e.at, ratings: [], minutes: 0 });
        b.n++; b.last = e.at;
        if (typeof e.rating === 'number') b.ratings.push({ at: e.at, r: e.rating });
        if (e.minutes) b.minutes += e.minutes;
      });
    });
    var topics = Object.keys(byTopic).map(function (t) {
      var b = byTopic[t];
      var rs = b.ratings;
      var avg = rs.length ? rs.reduce(function (x, y) { return x + y.r; }, 0) / rs.length : null;
      // Tendenz: zweite Hälfte gegen erste Hälfte. Erst ab 4 Bewertungen,
      // davor ist es Rauschen und keine Entwicklung.
      var trend = null;
      if (rs.length >= 4) {
        var mid = Math.floor(rs.length / 2);
        var a1 = rs.slice(0, mid).reduce(function (x, y) { return x + y.r; }, 0) / mid;
        var a2 = rs.slice(mid).reduce(function (x, y) { return x + y.r; }, 0) / (rs.length - mid);
        trend = Math.round((a2 - a1) * 100) / 100;
      }
      return {
        id: t, label: (TOPIC[t] || {}).label || t, ch: (TOPIC[t] || {}).ch || '',
        n: b.n, first: b.first, last: b.last, minutes: b.minutes,
        avg: avg === null ? null : Math.round(avg * 100) / 100, trend: trend,
      };
    }).sort(function (a, b) { return b.n - a.n; });

    return {
      von: rows[0].at, bis: rows[rows.length - 1].at, days: days || 30,
      anzahl: rows.length, minuten: rows.reduce(function (t, e) { return t + (e.minutes || 0); }, 0),
      tage: Object.keys(rows.reduce(function (m, e) { m[dayOf(e.at)] = 1; return m; }, {})).length,
      topics: topics, entries: rows,
      good: rows.filter(function (e) { return e.good; }).slice(-8).reverse(),
      bad: rows.filter(function (e) { return e.bad; }).slice(-8).reverse(),
    };
  }

  global.Hundetagebuch = {
    CATS: CATS, CAT: CAT, SEV_LABEL: SEV_LABEL,
    TOPICS: TOPICS, TOPIC: TOPIC, RATING: RATING,
    isTraining: isTraining, ofKind: ofKind, trainingReview: trainingReview,
    api: api, localNow: localNow, dayOf: dayOf, fmtDay: fmtDay, fmtTime: fmtTime,
    summarize: summarize, summaryText: summaryText,
    TOKEN_KEY: TOKEN_KEY, NAME_KEY: NAME_KEY, API: API,
  };
})(typeof window !== 'undefined' ? window : this);
