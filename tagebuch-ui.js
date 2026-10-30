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
    var a = useState(init.at || T.localNow()); var at = a[0], setAt = a[1];
    var c = useState((init.cats || []).slice()); var cats = c[0], setCats = c[1];
    var v = useState(init.sev || null); var sev = v[0], setSev = v[1];
    var n = useState(init.note || ''); var note = n[0], setNote = n[1];
    var t = useState(init.temp || ''); var temp = t[0], setTemp = t[1];
    var w = useState(init.weight || ''); var weight = w[0], setWeight = w[1];
    var e2 = useState(''); var err = e2[0], setErr = e2[1];
    var b = useState(false); var busy = b[0], setBusy = b[1];

    function toggle(id) { setCats(cats.indexOf(id) >= 0 ? cats.filter(function (x) { return x !== id; }) : cats.concat([id])); }
    function save() {
      if (busy) return;
      setBusy(true); setErr('');
      var by = ''; try { by = localStorage.getItem(T.NAME_KEY) || ''; } catch (e) {}
      T.api('/api/entry', { method: 'POST', body: { entry: {
        id: init.id, at: at, cats: cats, sev: sev, note: note, by: by,
        temp: temp === '' ? null : Number(temp), weight: weight === '' ? null : Number(weight),
        createdAt: init.createdAt,
      } } }).then(props.onSaved).catch(function (e) { setErr(e.message); setBusy(false); });
    }

    // Kategorien nach Gruppe, damit die Liste auf dem Handy lesbar bleibt
    var groups = [];
    T.CATS.forEach(function (x) {
      var g = groups.filter(function (y) { return y.name === x.group; })[0];
      if (!g) { g = { name: x.group, items: [] }; groups.push(g); }
      g.items.push(x);
    });

    return h('div', { style: { background: C.card, border: '1px solid ' + C.line, borderRadius: 16, padding: '1.1rem', marginBottom: '1rem' } },
      h('div', { style: { fontWeight: 800, fontSize: 16, color: C.ink, marginBottom: '0.9rem' } },
        init.id ? 'Eintrag bearbeiten' : 'Neuer Eintrag'),

      h('label', { style: { display: 'block', fontSize: 12.5, fontWeight: 700, color: C.muted, marginBottom: '0.3rem' } }, 'Wann'),
      h('input', { type: 'datetime-local', value: at, onChange: function (e) { setAt(e.target.value); }, style: inputStyle }),

      h('div', { style: { fontSize: 12.5, fontWeight: 700, color: C.muted, margin: '1rem 0 0.4rem' } }, 'Was'),
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

      h('div', { style: { fontSize: 12.5, fontWeight: 700, color: C.muted, margin: '0.9rem 0 0.4rem' } }, 'Wie stark (optional)'),
      h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
        [1, 2, 3, 4, 5].map(function (i) {
          var on = sev === i;
          return h('button', { key: i, onClick: function () { setSev(on ? null : i); }, style: {
            width: 42, height: 38, borderRadius: 10, cursor: 'pointer', fontWeight: 800, fontSize: 14,
            border: '1px solid ' + (on ? C.accent : C.line2), background: on ? C.accent : '#fff', color: on ? '#fff' : C.inkSoft,
          } }, i);
        }),
        sev ? h('span', { style: { fontSize: 13, color: C.muted } }, T.SEV_LABEL[sev]) : null),

      h('div', { style: { fontSize: 12.5, fontWeight: 700, color: C.muted, margin: '0.9rem 0 0.4rem' } }, 'Notiz'),
      h('textarea', { value: note, rows: 3, placeholder: 'Was ist passiert? Wann, wie oft, wie sah es aus …',
        onChange: function (e) { setNote(e.target.value); },
        style: Object.assign({}, inputStyle, { resize: 'vertical', lineHeight: 1.5 }) }),

      h('div', { style: { display: 'flex', gap: 10, marginTop: '0.9rem', flexWrap: 'wrap' } },
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
                  (T.CAT[c] || {}).label || c);
              }),
              e.sev ? h('span', { style: { fontSize: 12, color: C.muted } }, T.SEV_LABEL[e.sev]) : null,
              h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 4 } },
                btn('✎', function () { props.onEdit(e); }, 'ghost', { padding: '0.2rem 0.45rem', fontSize: 14 }),
                btn('✕', function () { props.onDelete(e); }, 'ghost', { padding: '0.2rem 0.45rem', fontSize: 14 }))),
            e.note ? h('div', { style: { fontSize: 14, color: C.inkSoft, marginTop: '0.45rem',
                                         lineHeight: 1.55, whiteSpace: 'pre-wrap' } }, e.note) : null,
            (e.temp || e.weight || e.by) ? h('div', { style: { fontSize: 12, color: C.muted, marginTop: '0.4rem' } },
              [e.temp ? e.temp + ' °C' : null, e.weight ? e.weight + ' kg' : null,
               e.by ? e.by : null].filter(Boolean).join(' · ')) : null);
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
        [['liste', 'Einträge'], ['summary', 'Zusammenfassung']].map(function (x) {
          var on = tab === x[0];
          return h('button', { key: x[0], onClick: function () { setTab(x[0]); }, style: {
            padding: '0.5rem 0.95rem', borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
            border: '1px solid ' + (on ? C.accent : C.line2), background: on ? C.accent : '#fff',
            color: on ? '#fff' : C.inkSoft } }, x[1]);
        })),

      err ? h('div', { style: { background: '#fdf0f0', border: '1px solid #e8c4c6', color: '#8c2026',
                                borderRadius: 10, padding: '0.7rem 0.9rem', fontSize: 13, marginBottom: '1rem' } }, err) : null,

      tab === 'liste' ? h('div', null,
        formOpen
          ? h(EntryForm, { entry: editing, onSaved: function () { setFormOpen(false); setEditing(null); load(); },
                           onCancel: function () { setFormOpen(false); setEditing(null); } })
          : h('div', { style: { marginBottom: '1rem' } },
              btn('+ Neuer Eintrag', function () { setEditing(null); setFormOpen(true); }, 'primary', { width: '100%' })),
        h(EntryList, { entries: entries, onEdit: function (x) { setEditing(x); setFormOpen(true); }, onDelete: del }))
      : h(Summary, { entries: entries }));
  }

  global.HundetagebuchUI = { Diary: Diary };
})(typeof window !== 'undefined' ? window : this);
