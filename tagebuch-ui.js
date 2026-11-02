// ═══════════════════════════════════════════════════════════════════════════
// Hundetagebuch — Ansichten. Setzt tagebuch.js voraus und nutzt die Farben
// und den React-ohne-JSX-Stil des Handbuchs.
// ═══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  var h = React.createElement, useState = React.useState, useEffect = React.useEffect;
  var T = global.Hundetagebuch;
  var C = global.DIARY_COLORS || {
    bg: '#f7f5fb', card: '#ffffff', ink: '#241a38', inkSoft: '#4a3d63', muted: '#8a7fa3',
    line: '#e7e1f2', line2: '#d6cce8', accent: '#6d28d9', accentSoft: '#f1ecfb',
    accentLine: '#cbbfe6', accentDark: '#4c1d95',
  };

  function btn(label, onClick, kind, extra) {
    var base = { padding: '0.62rem 1rem', borderRadius: 10, fontSize: 14, fontWeight: 700,
                 cursor: 'pointer', border: '1px solid ' + C.line2, background: '#fff', color: C.ink };
    if (kind === 'primary') { base.background = C.accent; base.color = '#fff'; base.border = '1px solid ' + C.accent; }
    if (kind === 'ghost') { base.background = 'none'; base.border = '1px solid transparent'; base.color = C.muted; }
    if (kind === 'danger') { base.color = '#b4232a'; base.borderColor = '#e8c4c6'; }
    return h('button', { onClick: onClick, style: Object.assign(base, extra || {}) }, label);
  }
  var inputStyle = {
    width: '100%', padding: '0.62rem 0.7rem', borderRadius: 10, border: '1px solid ' + C.line2,
    fontSize: 16, fontFamily: 'inherit', color: C.ink, background: '#fff',
  };

  // ── Anmeldung ────────────────────────────────────────────────────────────
  function Login(props) {
    var s = useState(''); var pw = s[0], setPw = s[1];
    var e2 = useState(''); var err = e2[0], setErr = e2[1];
    var b = useState(false); var busy = b[0], setBusy = b[1];
    function go() {
      if (busy || !pw) return;
      setBusy(true); setErr('');
      T.api('/api/login', { method: 'POST', body: { password: pw } })
        .then(function (r) { try { localStorage.setItem(T.TOKEN_KEY, r.token); } catch (e) {} props.onDone(); })
        .catch(function (e) { setErr(e.message); setBusy(false); });
    }
    return h('div', { style: { maxWidth: 380, margin: '3rem auto', padding: '0 1rem' } },
      h('div', { style: { background: C.card, border: '1px solid ' + C.line, borderRadius: 16, padding: '1.6rem' } },
        h('div', { style: { fontSize: 20, fontWeight: 800, color: C.ink, marginBottom: '0.3rem' } }, 'Tagebuch'),
        h('div', { style: { fontSize: 13.5, color: C.muted, marginBottom: '1.2rem', lineHeight: 1.5 } },
          'Gemeinsames Passwort — danach bleibt dieses Gerät angemeldet.'),
        h('input', { type: 'password', value: pw, autoFocus: true, placeholder: 'Passwort',
          onChange: function (e) { setPw(e.target.value); }, style: inputStyle,
          onKeyDown: function (e) { if (e.key === 'Enter') go(); } }),
        err ? h('div', { style: { color: '#b4232a', fontSize: 13, marginTop: '0.6rem' } }, err) : null,
        h('div', { style: { marginTop: '1rem' } },
          btn(busy ? '…' : 'Anmelden', go, 'primary', { width: '100%' }))
      ));
  }

  // ── Eintrag anlegen / bearbeiten ─────────────────────────────────────────
  function EntryForm(props) {
    var init = props.entry || {};
    // Gesundheit oder Training - dasselbe Formular, andere Felder.
    var kind = props.kind || init.kind || 'health';
    var training = kind === 'training';
    var a = useState(init.at || T.localNow()); var at = a[0], setAt = a[1];
    var c = useState((init.cats || []).slice()); var cats = c[0], setCats = c[1];
    var v = useState(init.sev || null); var sev = v[0], setSev = v[1];
    var n = useState(init.note || ''); var note = n[0], setNote = n[1];
    var t = useState(init.temp || ''); var temp = t[0], setTemp = t[1];
    var w = useState(init.weight || ''); var weight = w[0], setWeight = w[1];
    var r = useState(init.rating === undefined ? null : init.rating); var rating = r[0], setRating = r[1];
    var mi = useState(init.minutes || ''); var minutes = mi[0], setMinutes = mi[1];
    var wh = useState(init.where || ''); var where = wh[0], setWhere = wh[1];
    var gd = useState(init.good || ''); var good = gd[0], setGood = gd[1];
    var bd = useState(init.bad || ''); var bad = bd[0], setBad = bd[1];
    var e2 = useState(''); var err = e2[0], setErr = e2[1];
    var b = useState(false); var busy = b[0], setBusy = b[1];

    function toggle(id) { setCats(cats.indexOf(id) >= 0 ? cats.filter(function (x) { return x !== id; }) : cats.concat([id])); }
    function save() {
      if (busy) return;
      setBusy(true); setErr('');
      var by = ''; try { by = localStorage.getItem(T.NAME_KEY) || ''; } catch (e) {}
      var entry = { id: init.id, kind: kind, at: at, cats: cats, note: note, by: by, createdAt: init.createdAt };
      if (training) {
        entry.rating = rating;
        entry.minutes = minutes === '' ? null : Number(minutes);
        entry.where = where; entry.good = good; entry.bad = bad;
      } else {
        entry.sev = sev;
        entry.temp = temp === '' ? null : Number(temp);
        entry.weight = weight === '' ? null : Number(weight);
      }
      T.api('/api/entry', { method: 'POST', body: { entry: entry } })
        .then(props.onSaved).catch(function (e) { setErr(e.message); setBusy(false); });
    }

    // Kategorien nach Gruppe, damit die Liste auf dem Handy lesbar bleibt
    // Beim Training die Kapitel des Handbuchs als flache Liste, die
    // Kapitelnummer steht am Chip.
    var groups = [];
    if (training) {
      groups = [{ name: 'Woran habt ihr gearbeitet?', items: T.TOPICS.map(function (x) {
        return { id: x.id, label: (x.ch ? x.ch + ' \u00b7 ' : '') + x.label };
      }) }];
    } else T.CATS.forEach(function (x) {
      var g = groups.filter(function (y) { return y.name === x.group; })[0];
      if (!g) { g = { name: x.group, items: [] }; groups.push(g); }
      g.items.push(x);
    });

    return h('div', { style: { background: C.card, border: '1px solid ' + C.line, borderRadius: 16, padding: '1.1rem', marginBottom: '1rem' } },
      h('div', { style: { fontWeight: 800, fontSize: 16, color: C.ink, marginBottom: '0.9rem' } },
        (init.id ? 'Eintrag bearbeiten' : 'Neuer Eintrag') + (training ? ' \u2014 Training' : '')),

      h('label', { style: { display: 'block', fontSize: 12.5, fontWeight: 700, color: C.muted, marginBottom: '0.3rem' } }, 'Wann'),
      h('input', { type: 'datetime-local', value: at, onChange: function (e) { setAt(e.target.value); }, style: inputStyle }),

      h('div', { style: { fontSize: 12.5, fontWeight: 700, color: C.muted, margin: '1rem 0 0.4rem' } }, training ? 'Thema' : 'Was'),
      groups.map(function (g) {
        return h('div', { key: g.name, style: { marginBottom: '0.55rem' } },
          h('div', { style: { fontSize: 11, color: C.muted, marginBottom: '0.25rem' } }, g.name),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
            g.items.map(function (x) {
              var on = cats.indexOf(x.id) >= 0;
              return h('button', { key: x.id, onClick: function () { toggle(x.id); }, style: {
                padding: '0.42rem 0.72rem', borderRadius: 999, fontSize: 13.5, cursor: 'pointer',
                border: '1px solid ' + (on ? C.accent : C.line2),
                background: on ? C.accent : '#fff', color: on ? '#fff' : C.inkSoft, fontWeight: on ? 700 : 500,
              } }, x.label);
            })));
      }),

      training ? null : h('div', { style: { fontSize: 12.5, fontWeight: 700, color: C.muted, margin: '0.9rem 0 0.4rem' } }, 'Wie stark (optional)'),
      training ? null : h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
        [1, 2, 3, 4, 5].map(function (i) {
          var on = sev === i;
          return h('button', { key: i, onClick: function () { setSev(on ? null : i); }, style: {
            width: 42, height: 38, borderRadius: 10, cursor: 'pointer', fontWeight: 800, fontSize: 14,
            border: '1px solid ' + (on ? C.accent : C.line2), background: on ? C.accent : '#fff', color: on ? '#fff' : C.inkSoft,
          } }, i);
        }),
        sev ? h('span', { style: { fontSize: 13, color: C.muted } }, T.SEV_LABEL[sev]) : null),


      // Training: wie lief es? -2 bis +2, damit "schlecht" und "gut" gleich
      // weit von "wie immer" entfernt sind.
      training ? h('div', { style: { fontSize: 12.5, fontWeight: 700, color: C.muted, margin: '0.9rem 0 0.4rem' } }, 'Wie lief es?') : null,
      training ? h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
        [-2, -1, 0, 1, 2].map(function (i) {
          var on = rating === i;
          var col = i < 0 ? '#b4232a' : i > 0 ? '#2f7d4f' : C.muted;
          return h('button', { key: i, onClick: function () { setRating(on ? null : i); }, style: {
            padding: '0.45rem 0.7rem', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13,
            border: '1px solid ' + (on ? col : C.line2), background: on ? col : '#fff', color: on ? '#fff' : C.inkSoft,
          } }, T.RATING[String(i)]);
        })) : null,

      training ? h('div', { style: { display: 'flex', gap: 10, marginTop: '0.9rem', flexWrap: 'wrap' } },
        h('label', { style: { flex: '1 1 110px' } },
          h('div', { style: { fontSize: 11.5, color: C.muted, marginBottom: '0.25rem' } }, 'Dauer (Min)'),
          h('input', { type: 'number', value: minutes, placeholder: '20',
            onChange: function (e) { setMinutes(e.target.value); }, style: inputStyle })),
        h('label', { style: { flex: '2 1 160px' } },
          h('div', { style: { fontSize: 11.5, color: C.muted, marginBottom: '0.25rem' } }, 'Wo'),
          h('input', { value: where, placeholder: 'Feldweg, Stadt, Zuhause \u2026',
            onChange: function (e) { setWhere(e.target.value); }, style: inputStyle }))) : null,

      training ? h('div', { style: { fontSize: 12.5, fontWeight: 700, color: '#2f7d4f', margin: '0.9rem 0 0.4rem' } }, 'Was lief gut') : null,
      training ? h('textarea', { value: good, rows: 2, placeholder: 'Was hat geklappt?',
        onChange: function (e) { setGood(e.target.value); },
        style: Object.assign({}, inputStyle, { resize: 'vertical', lineHeight: 1.5 }) }) : null,
      training ? h('div', { style: { fontSize: 12.5, fontWeight: 700, color: '#b4232a', margin: '0.9rem 0 0.4rem' } }, 'Was noch nicht') : null,
      training ? h('textarea', { value: bad, rows: 2, placeholder: 'Woran wird weiter gearbeitet?',
        onChange: function (e) { setBad(e.target.value); },
        style: Object.assign({}, inputStyle, { resize: 'vertical', lineHeight: 1.5 }) }) : null,
      h('div', { style: { fontSize: 12.5, fontWeight: 700, color: C.muted, margin: '0.9rem 0 0.4rem' } }, 'Notiz'),
      h('textarea', { value: note, rows: 3, placeholder: 'Was ist passiert? Wann, wie oft, wie sah es aus …',
        onChange: function (e) { setNote(e.target.value); },
        style: Object.assign({}, inputStyle, { resize: 'vertical', lineHeight: 1.5 }) }),

      training ? null : h('div', { style: { display: 'flex', gap: 10, marginTop: '0.9rem', flexWrap: 'wrap' } },
        h('label', { style: { flex: '1 1 130px' } },
          h('div', { style: { fontSize: 11.5, color: C.muted, marginBottom: '0.25rem' } }, 'Temperatur °C'),
          h('input', { type: 'number', step: '0.1', value: temp, placeholder: '38.5',
            onChange: function (e) { setTemp(e.target.value); }, style: inputStyle })),
        h('label', { style: { flex: '1 1 130px' } },
          h('div', { style: { fontSize: 11.5, color: C.muted, marginBottom: '0.25rem' } }, 'Gewicht kg'),
          h('input', { type: 'number', step: '0.1', value: weight, placeholder: '12.4',
            onChange: function (e) { setWeight(e.target.value); }, style: inputStyle }))),

      err ? h('div', { style: { color: '#b4232a', fontSize: 13, marginTop: '0.7rem' } }, err) : null,
      h('div', { style: { display: 'flex', gap: 8, marginTop: '1.1rem' } },
        btn(busy ? '…' : 'Speichern', save, 'primary'),
        btn('Abbrechen', props.onCancel, 'ghost'))
    );
  }

  // ── Liste ────────────────────────────────────────────────────────────────
  function EntryList(props) {
    var byDay = [];
    props.entries.forEach(function (e) {
      var d = T.dayOf(e.at);
      var g = byDay.filter(function (x) { return x.day === d; })[0];
      if (!g) { g = { day: d, items: [] }; byDay.push(g); }
      g.items.push(e);
    });
    if (!byDay.length) {
      return h('div', { style: { textAlign: 'center', color: C.muted, padding: '2.5rem 1rem', fontSize: 14 } },
        'Noch nichts eingetragen. Oben auf „Neuer Eintrag“ tippen.');
    }
    return h('div', null, byDay.map(function (g) {
      return h('div', { key: g.day, style: { marginBottom: '1.3rem' } },
        h('div', { style: { fontSize: 12, fontWeight: 800, color: C.accent, letterSpacing: 0.6,
                            textTransform: 'uppercase', marginBottom: '0.5rem' } }, T.fmtDay(g.day)),
        g.items.map(function (e) {
          return h('div', { key: e.id, style: { background: C.card, border: '1px solid ' + C.line,
                                                borderRadius: 13, padding: '0.85rem 0.95rem', marginBottom: '0.55rem' } },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
              h('span', { style: { fontSize: 12.5, color: C.muted, fontVariantNumeric: 'tabular-nums' } }, T.fmtTime(e.at)),
              (e.cats || []).map(function (c) {
                return h('span', { key: c, style: { fontSize: 12.5, fontWeight: 700, color: C.accentDark,
                  background: C.accentSoft, border: '1px solid ' + C.accentLine, borderRadius: 999, padding: '0.1rem 0.5rem' } },
                  (T.isTraining(e) ? (T.TOPIC[c] || {}).label : (T.CAT[c] || {}).label) || c);
              }),
              e.sev ? h('span', { style: { fontSize: 12, color: C.muted } }, T.SEV_LABEL[e.sev]) : null,
              h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 4 } },
                btn('✎', function () { props.onEdit(e); }, 'ghost', { padding: '0.2rem 0.45rem', fontSize: 14 }),
                btn('✕', function () { props.onDelete(e); }, 'ghost', { padding: '0.2rem 0.45rem', fontSize: 14 }))),
            e.note ? h('div', { style: { fontSize: 14, color: C.inkSoft, marginTop: '0.45rem',
                                         lineHeight: 1.55, whiteSpace: 'pre-wrap' } }, e.note) : null,
            e.good ? h('div', { style: { fontSize: 13.5, color: '#2f7d4f', marginTop: '0.4rem', lineHeight: 1.5 } },
              '\u2713 ' + e.good) : null,
            e.bad ? h('div', { style: { fontSize: 13.5, color: '#b4232a', marginTop: '0.25rem', lineHeight: 1.5 } },
              '\u2192 ' + e.bad) : null,
            (e.temp || e.weight || e.minutes || e.where || e.by) ? h('div', { style: { fontSize: 12, color: C.muted, marginTop: '0.4rem' } },
              [e.temp ? e.temp + ' \u00b0C' : null, e.weight ? e.weight + ' kg' : null,
               e.minutes ? e.minutes + ' Min' : null, e.where ? e.where : null,
               e.by ? e.by : null].filter(Boolean).join(' \u00b7 ')) : null);
        }));
    }));
  }

  // ── Zusammenfassung ──────────────────────────────────────────────────────
  function Summary(props) {
    var d = useState(30); var days = d[0], setDays = d[1];
    var n = useState(''); var name = n[0], setName = n[1];
    var c = useState(''); var copied = c[0], setCopied = c[1];
    useEffect(function () { try { setName(localStorage.getItem('hundetagebuch_hund') || ''); } catch (e) {} }, []);
    var sum = T.summarize(props.entries, days);
    var text = T.summaryText(sum, name);

    function copy() {
      try { localStorage.setItem('hundetagebuch_hund', name); } catch (e) {}
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { setCopied('kopiert'); setTimeout(function () { setCopied(''); }, 2000); })
          .catch(function () { setCopied('ging nicht — Text markieren und kopieren'); });
      } else setCopied('Text markieren und kopieren');
    }
    function share() {
      try { localStorage.setItem('hundetagebuch_hund', name); } catch (e) {}
      if (navigator.share) navigator.share({ title: 'Hundetagebuch', text: text }).catch(function () {});
      else copy();
    }

    return h('div', null,
      h('div', { style: { background: C.card, border: '1px solid ' + C.line, borderRadius: 16, padding: '1.1rem', marginBottom: '1rem' } },
        h('div', { style: { fontWeight: 800, fontSize: 16, color: C.ink, marginBottom: '0.8rem' } }, 'Für den Tierarzt'),
        h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' } },
          h('label', { style: { flex: '1 1 150px' } },
            h('div', { style: { fontSize: 11.5, color: C.muted, marginBottom: '0.25rem' } }, 'Name des Hundes'),
            h('input', { value: name, placeholder: 'optional', onChange: function (e) { setName(e.target.value); }, style: inputStyle })),
          h('label', { style: { flex: '1 1 120px' } },
            h('div', { style: { fontSize: 11.5, color: C.muted, marginBottom: '0.25rem' } }, 'Zeitraum'),
            h('select', { value: days, onChange: function (e) { setDays(Number(e.target.value)); }, style: inputStyle },
              [7, 14, 30, 90, 365].map(function (x) { return h('option', { key: x, value: x }, x + ' Tage'); })))),
        h('div', { style: { display: 'flex', gap: 8, marginTop: '0.9rem', flexWrap: 'wrap', alignItems: 'center' } },
          btn('Kopieren', copy, 'primary'),
          navigator.share ? btn('Teilen', share) : null,
          copied ? h('span', { style: { fontSize: 13, color: C.accent } }, copied) : null)),

      sum ? h('div', null,
        h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: '1rem' } },
          [['Einträge', sum.anzahl], ['Tage mit Eintrag', sum.tage], ['Beobachtungen', sum.cats.length]].map(function (kv) {
            return h('div', { key: kv[0], style: { flex: '1 1 110px', background: C.card, border: '1px solid ' + C.line,
                                                   borderRadius: 13, padding: '0.75rem 0.9rem' } },
              h('div', { style: { fontSize: 22, fontWeight: 800, color: C.accent } }, kv[1]),
              h('div', { style: { fontSize: 11.5, color: C.muted } }, kv[0]));
          })),
        h('pre', { style: { background: C.card, border: '1px solid ' + C.line, borderRadius: 13, padding: '1rem',
                            fontSize: 13, lineHeight: 1.6, color: C.inkSoft, whiteSpace: 'pre-wrap',
                            fontFamily: 'inherit', overflowX: 'auto' } }, text))
        : h('div', { style: { textAlign: 'center', color: C.muted, padding: '2rem 1rem', fontSize: 14 } },
            'Im gewählten Zeitraum gibt es keine Einträge.'));
  }

  // ── Trainingsrückblick ───────────────────────────────────────────────────
  // Andere Frage als beim Tierarzt: nicht "wie oft war was", sondern "woran
  // arbeiten wir, und wird es besser?". Deshalb Tendenz statt Häufung - und
  // "lief gut" / "dran bleiben" stehen oben, weil man das vor der nächsten
  // Einheit liest, nicht die Statistik.
  function Review(props) {
    var d = useState(30); var days = d[0], setDays = d[1];
    var rev = T.trainingReview(props.entries, days);
    if (!rev) {
      return h('div', { style: { textAlign: 'center', color: C.muted, padding: '2.5rem 1rem', fontSize: 14 } },
        'Noch keine Trainingseintr\u00e4ge in diesem Zeitraum.');
    }
    function trendChip(t) {
      if (t.trend === null) return h('span', { style: { fontSize: 11.5, color: C.muted } }, 'noch zu wenig');
      if (t.trend > 0.25) return h('span', { style: { fontSize: 11.5, fontWeight: 700, color: '#2f7d4f' } }, '\u2191 wird besser');
      if (t.trend < -0.25) return h('span', { style: { fontSize: 11.5, fontWeight: 700, color: '#b4232a' } }, '\u2193 wird schwerer');
      return h('span', { style: { fontSize: 11.5, color: C.muted } }, '\u2192 unver\u00e4ndert');
    }
    return h('div', null,
      h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' } },
        h('label', { style: { flex: '0 1 150px' } },
          h('div', { style: { fontSize: 11.5, color: C.muted, marginBottom: '0.25rem' } }, 'Zeitraum'),
          h('select', { value: days, onChange: function (e) { setDays(Number(e.target.value)); }, style: inputStyle },
            [7, 14, 30, 90, 365].map(function (x) { return h('option', { key: x, value: x }, x + ' Tage'); })))),

      h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: '1rem' } },
        [['Einheiten', rev.anzahl], ['Tage ge\u00fcbt', rev.tage], ['Minuten', rev.minuten]].map(function (kv) {
          return h('div', { key: kv[0], style: { flex: '1 1 100px', background: C.card, border: '1px solid ' + C.line,
                                                 borderRadius: 13, padding: '0.75rem 0.9rem' } },
            h('div', { style: { fontSize: 22, fontWeight: 800, color: C.accent } }, kv[1]),
            h('div', { style: { fontSize: 11.5, color: C.muted } }, kv[0]));
        })),

      h('div', { style: { background: C.card, border: '1px solid ' + C.line, borderRadius: 16, padding: '0.3rem 0', marginBottom: '1rem' } },
        h('div', { style: { fontWeight: 800, fontSize: 15, color: C.ink, padding: '0.8rem 1rem 0.5rem' } }, 'Themen'),
        rev.topics.map(function (t) {
          return h('div', { key: t.id, style: { padding: '0.6rem 1rem', borderTop: '1px solid ' + C.line,
                                                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            t.ch ? h('span', { style: { fontSize: 11, fontWeight: 800, color: C.muted, minWidth: 20 } }, t.ch) : null,
            h('span', { style: { flex: 1, minWidth: 140, fontSize: 14, color: C.ink, fontWeight: 600 } }, t.label),
            h('span', { style: { fontSize: 12.5, color: C.muted } }, t.n + '\u00d7'),
            t.avg === null ? null : h('span', { style: { fontSize: 12.5, fontWeight: 700,
              color: t.avg < -0.3 ? '#b4232a' : t.avg > 0.3 ? '#2f7d4f' : C.muted } },
              (t.avg > 0 ? '+' : '') + t.avg),
            trendChip(t));
        })),

      rev.good.length ? h('div', { style: { background: C.card, border: '1px solid ' + C.line, borderRadius: 16,
                                            padding: '0.9rem 1rem', marginBottom: '1rem' } },
        h('div', { style: { fontWeight: 800, fontSize: 14, color: '#2f7d4f', marginBottom: '0.5rem' } }, 'Lief gut'),
        rev.good.map(function (e, i) {
          return h('div', { key: i, style: { fontSize: 13.5, color: C.inkSoft, lineHeight: 1.5, marginBottom: '0.35rem' } },
            h('span', { style: { color: C.muted, fontSize: 12 } }, T.fmtDay(T.dayOf(e.at)) + ' \u00b7 '), e.good);
        })) : null,

      rev.bad.length ? h('div', { style: { background: C.card, border: '1px solid ' + C.line, borderRadius: 16,
                                           padding: '0.9rem 1rem' } },
        h('div', { style: { fontWeight: 800, fontSize: 14, color: '#b4232a', marginBottom: '0.5rem' } }, 'Dran bleiben'),
        rev.bad.map(function (e, i) {
          return h('div', { key: i, style: { fontSize: 13.5, color: C.inkSoft, lineHeight: 1.5, marginBottom: '0.35rem' } },
            h('span', { style: { color: C.muted, fontSize: 12 } }, T.fmtDay(T.dayOf(e.at)) + ' \u00b7 '), e.bad);
        })) : null);
  }

  // ── Hauptansicht ─────────────────────────────────────────────────────────
  function Diary(props) {
    var l = useState(false); var loggedIn = l[0], setLoggedIn = l[1];
    var e = useState(null); var entries = e[0], setEntries = e[1];
    var f = useState(false); var formOpen = f[0], setFormOpen = f[1];
    var ed = useState(null); var editing = ed[0], setEditing = ed[1];
    var t = useState('liste'); var tab = t[0], setTab = t[1];
    var er = useState(''); var err = er[0], setErr = er[1];

    function load() {
      T.api('/api/entries')
        .then(function (r) { setEntries(r.entries || []); setLoggedIn(true); setErr(''); })
        .catch(function (ex) {
          if (ex.status === 401) { setLoggedIn(false); setEntries(null); }
          else { setErr(ex.message); setEntries([]); }
        });
    }
    useEffect(function () {
      var tok = null; try { tok = localStorage.getItem(T.TOKEN_KEY); } catch (ex) {}
      if (tok) load(); else setLoggedIn(false);
    }, []);

    if (!loggedIn) return h(Login, { onDone: load });
    if (entries === null) return h('div', { style: { textAlign: 'center', color: C.muted, padding: '3rem 1rem' } }, 'lädt …');

    function del(entry) {
      if (!global.confirm('Diesen Eintrag löschen?')) return;
      T.api('/api/delete', { method: 'POST', body: { id: entry.id } }).then(load).catch(function (ex) { setErr(ex.message); });
    }
    function logout() {
      T.api('/api/logout', { method: 'POST' }).catch(function () {});
      try { localStorage.removeItem(T.TOKEN_KEY); } catch (ex) {}
      setLoggedIn(false);
    }
    function setName() {
      var cur = ''; try { cur = localStorage.getItem(T.NAME_KEY) || ''; } catch (ex) {}
      var v = global.prompt('Wer trägt hier ein? (erscheint bei den Einträgen)', cur);
      if (v !== null) { try { localStorage.setItem(T.NAME_KEY, v.slice(0, 24)); } catch (ex) {} }
    }

    var myName = ''; try { myName = localStorage.getItem(T.NAME_KEY) || ''; } catch (ex) {}

    return h('div', null,
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: '1rem' } },
        h('div', { style: { fontSize: 24, fontWeight: 800, color: C.ink, letterSpacing: -0.5 } }, 'Tagebuch'),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
          h('button', { onClick: setName, style: { background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12.5, color: C.muted, padding: '0.2rem 0.3rem' } }, myName || 'Name setzen'),
          btn('Abmelden', logout, 'ghost', { fontSize: 12.5, padding: '0.3rem 0.5rem' }))),

      h('div', { style: { display: 'flex', gap: 6, marginBottom: '1.1rem' } },
        [['liste', 'Gesundheit'], ['training', 'Training'], ['summary', 'Arztbericht'], ['review', 'Rückblick']].map(function (x) {
          var on = tab === x[0];
          return h('button', { key: x[0], onClick: function () { setTab(x[0]); setFormOpen(false); setEditing(null); }, style: {
            padding: '0.5rem 0.95rem', borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
            border: '1px solid ' + (on ? C.accent : C.line2), background: on ? C.accent : '#fff',
            color: on ? '#fff' : C.inkSoft } }, x[1]);
        })),

      err ? h('div', { style: { background: '#fdf0f0', border: '1px solid #e8c4c6', color: '#8c2026',
                                borderRadius: 10, padding: '0.7rem 0.9rem', fontSize: 13, marginBottom: '1rem' } }, err) : null,

      (tab === 'liste' || tab === 'training') ? h('div', null,
        formOpen
          ? h(EntryForm, { entry: editing, kind: tab === 'training' ? 'training' : 'health',
                           onSaved: function () { setFormOpen(false); setEditing(null); load(); },
                           onCancel: function () { setFormOpen(false); setEditing(null); } })
          : h('div', { style: { marginBottom: '1rem' } },
              btn(tab === 'training' ? '+ Training eintragen' : '+ Neuer Eintrag',
                  function () { setEditing(null); setFormOpen(true); }, 'primary', { width: '100%' })),
        h(EntryList, { entries: T.ofKind(entries, tab === 'training' ? 'training' : 'health'),
                       onEdit: function (x) { setEditing(x); setFormOpen(true); }, onDelete: del }))
      : tab === 'review' ? h(Review, { entries: entries })
      : h(Summary, { entries: entries }));
  }

  // Die Einzelteile nur fuer die Tests - die Seite benutzt nur Diary.
  global.HundetagebuchUI = { Diary: Diary,
    __test: { EntryForm: EntryForm, EntryList: EntryList, Review: Review, Summary: Summary, Login: Login } };
})(typeof window !== 'undefined' ? window : this);
