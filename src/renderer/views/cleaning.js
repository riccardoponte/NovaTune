(function () {
  const { h, bytes, num, btn, checkbox } = UI;

  async function ignore(kind, id, on) {
    const s = await api.settings();
    const set = new Set(s.ignored[kind] || []);
    on ? set.add(id) : set.delete(id);
    s.ignored[kind] = [...set];
    App.settings = await api.setSettings({ ignored: s.ignored });
  }
  UI.ignore = ignore;

  function doneCard(title, text, again) {
    return h('div', { class: 'card', style: { textAlign: 'center', padding: '40px' } }, h('div', { class: 'empty-ic', html: Icons.get('check') }), h('h2', null, title), h('p', { class: 'muted' }, text), again ? btn('Ripeti la scansione', again, 'ghost', 'refresh') : null);
  }
  UI.doneCard = doneCard;

  // ---------------- Disk cleanup ----------------
  UI.Views.junk = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Pulizia disco', 'Rimuove file temporanei, cache, log, dump di memoria e altri file inutili di Windows e delle applicazioni.', btn('Ripeti scansione', () => scan(), 'ghost', 'refresh')));
      root.appendChild(body);
      let data = null;
      async function scan() {
        body.innerHTML = ''; const p = UI.busyPanel('Ricerca dei file inutili…'); body.appendChild(p);
        try { data = await UI.run('junk', 'scan', { level: 'custom' === App.settings.junkLevel ? 'custom' : App.settings.junkLevel }, p); } catch (e) { body.innerHTML = ''; return; }
        render();
      }
      function render() {
        body.innerHTML = '';
        const sel = () => data.categories.filter((c) => c.selected);
        const totalEl = h('span', { class: 'stat-big' });
        const upd = () => { const s = sel(); totalEl.textContent = bytes(s.reduce((a, c) => a + c.size, 0)); cleanBtn.disabled = !s.length; };
        const cleanBtn = btn('Pulisci', clean, 'primary lg', 'broom');
        const levels = [['basic', 'Pulizia di base', 'Solo elementi sicuri al 100%'], ['full', 'Pulizia completa', 'Consigliata: libera più spazio'], ['custom', 'Personalizzata', 'Scegli tu le categorie']];
        body.appendChild(h('div', { class: 'radio-row mb' }, levels.map(([id, t, d]) => h('div', { class: 'radio-card' + (App.settings.junkLevel === id ? ' on' : ''), onclick: async () => { App.settings = await api.setSettings({ junkLevel: id, junkCategories: id === 'custom' ? sel().map((c) => c.id) : App.settings.junkCategories }); scan(); } }, h('b', null, t), h('span', { class: 'muted' }, d)))));
        for (const grp of [['windows', 'Windows'], ['apps', 'Applicazioni']]) {
          const list = h('div', { class: 'list mb' }, h('div', { class: 'list-head' }, grp[1]));
          for (const c of data.categories.filter((x) => x.group === grp[0])) {
            const sub = h('div', { class: 'sub-list', style: { display: 'none' } }, (c.top || []).map((f) => h('div', { class: 'item' }, h('div', { class: 'grow d mono sel' }, f.path), h('div', { class: 'v' }, bytes(f.size)))), c.count > (c.top || []).length ? h('div', { class: 'item faint' }, `… e altri ${num(c.count - c.top.length)} file`) : null);
            list.appendChild(h('div', { class: 'item' },
              checkbox(c.selected, async (v) => { c.selected = v; upd(); if (App.settings.junkLevel === 'custom') App.settings = await api.setSettings({ junkCategories: sel().map((x) => x.id) }); }),
              h('div', { class: 'grow' }, h('div', { class: 't' }, c.name, c.level === 'custom' ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, 'facoltativo') : null), h('div', { class: 'd' }, c.desc)),
              h('div', { class: 'faint', style: { fontSize: '12px' } }, c.count ? num(c.count) + ' elementi' : ''),
              h('div', { class: 'v', style: { minWidth: '80px', textAlign: 'right' } }, bytes(c.size)),
              (c.top || []).length ? h('button', { class: 'icon-btn', title: 'Mostra file', html: Icons.get('list'), onclick: () => { sub.style.display = sub.style.display === 'none' ? 'block' : 'none'; } }) : h('span', { style: { width: '32px' } })));
            list.appendChild(sub);
          }
          body.appendChild(list);
        }
        body.appendChild(h('div', { class: 'sticky-foot' }, h('div', null, h('div', { class: 'muted' }, 'Spazio da liberare'), totalEl), h('div', { class: 'spacer' }), cleanBtn));
        upd();
      }
      async function clean() {
        const ids = data.categories.filter((c) => c.selected).map((c) => c.id);
        if (ids.includes('winRestorePoints') && !(await UI.confirmBox('Eliminare i punti di ripristino?', 'Verranno eliminati tutti i punti di ripristino tranne il più recente. Non potrai tornare a configurazioni precedenti.', 'Elimina', 'danger'))) return;
        body.innerHTML = ''; const p = UI.busyPanel('Pulizia in corso…'); body.appendChild(p);
        const r = await UI.run('junk', 'clean', { categories: ids }, p).catch(() => null);
        body.innerHTML = '';
        if (!r) return scan();
        body.appendChild(doneCard(`Liberati ${bytes(r.freed)}`, `${num(r.deleted)} file eliminati` + (r.failed ? ` · ${num(r.failed)} file in uso sono stati saltati` : ''), scan));
        UI.toast(`Pulizia completata: ${bytes(r.freed)} liberati`);
      }
      scan();
    }
  };

  // ---------------- Browser ----------------
  UI.Views.browser = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Dati del browser', 'Elimina cache, cronologia, cookie e altri dati di navigazione di Chrome, Edge, Firefox, Brave, Opera e Vivaldi.', btn('Ripeti scansione', () => scan(), 'ghost', 'refresh')));
      root.appendChild(body);
      let data = null; let sel = {};
      async function scan() {
        body.innerHTML = ''; const p = UI.busyPanel('Analisi dei browser…'); body.appendChild(p);
        try { data = await UI.run('browser', 'scan', { level: App.settings.browserLevel }, p); } catch (e) { body.innerHTML = ''; return; }
        sel = {};
        data.browsers.forEach((b) => { sel[b.id] = new Set(b.categories.filter((c) => c.selected).map((c) => c.id)); });
        render();
      }
      function total() { let t = 0; for (const b of data.browsers) { if (b.ignored) continue; for (const c of b.categories) if (sel[b.id].has(c.id)) t += c.size; } return t; }
      function render() {
        body.innerHTML = '';
        if (!data.browsers.length) { body.appendChild(UI.empty('globe', 'Nessun browser trovato', 'Non è stato rilevato nessun browser supportato.')); return; }
        const levels = [['basic', 'Pulizia di base', 'Solo la cache'], ['full', 'Pulizia completa', 'Cache, cronologia e download'], ['custom', 'Personalizzata', 'Scegli tu cosa eliminare']];
        body.appendChild(h('div', { class: 'radio-row mb' }, levels.map(([id, t, d]) => h('div', { class: 'radio-card' + (App.settings.browserLevel === id ? ' on' : ''), onclick: async () => { App.settings = await api.setSettings({ browserLevel: id }); scan(); } }, h('b', null, t), h('span', { class: 'muted' }, d)))));
        const totalEl = h('span', { class: 'stat-big' });
        const upd = () => { totalEl.textContent = bytes(total()); };
        const running = data.browsers.filter((b) => b.running && !b.ignored);
        if (running.length) body.appendChild(h('div', { class: 'notice warn mb', html: Icons.get('alert') + `<div><b>${running.map((b) => b.name).join(', ')}</b> ${running.length > 1 ? 'sono aperti' : 'è aperto'}. Per pulire i dati il browser deve essere chiuso: verrà chiuso automaticamente durante la pulizia (le schede verranno ripristinate alla riapertura).</div>` }));
        for (const b of data.browsers) {
          const list = h('div', { class: 'list mb' + (b.ignored ? ' dim' : '') }, h('div', { class: 'list-head' }, h('span', { html: Icons.get('globe') }), b.name, b.running ? h('span', { class: 'tag warn' }, 'aperto') : null, h('span', { class: 'spacer' }),
            h('label', { class: 'row', style: { fontWeight: 400, fontSize: '13px' } }, h('span', { class: 'muted' }, 'Ignora questo browser'), UI.toggle(b.ignored, async (v) => { await ignore('browser', b.id, v); b.ignored = v; render(); }))));
          if (!b.ignored) for (const c of b.categories) {
            list.appendChild(h('div', { class: 'item' }, checkbox(sel[b.id].has(c.id), (v) => { v ? sel[b.id].add(c.id) : sel[b.id].delete(c.id); upd(); }),
              h('div', { class: 'grow' }, h('div', { class: 't' }, c.name), h('div', { class: 'd' }, c.desc)),
              h('div', { class: 'faint', style: { fontSize: '12px' } }, c.count ? num(c.count) + ' elementi' : ''),
              h('div', { class: 'v', style: { minWidth: '80px', textAlign: 'right' } }, c.size ? bytes(c.size) : '—')));
          }
          body.appendChild(list);
        }
        if (!data.sqlite) body.appendChild(h('div', { class: 'notice warn mb', html: Icons.get('alert') + '<div>Il modulo database non è disponibile: cronologia e moduli non possono essere puliti in modo selettivo.</div>' }));
        body.appendChild(h('div', { class: 'sticky-foot' }, h('div', null, h('div', { class: 'muted' }, 'Spazio da liberare'), totalEl), h('div', { class: 'spacer' }), btn('Pulisci', clean, 'primary lg', 'broom')));
        upd();
      }
      async function clean() {
        const selection = {}; for (const b of data.browsers) selection[b.id] = [...sel[b.id]];
        if (Object.values(selection).some((a) => a.includes('cookies')) && !(await UI.confirmBox('Eliminare i cookie?', 'Verrai disconnesso da tutti i siti web in cui hai effettuato l\'accesso.', 'Elimina cookie', 'danger'))) return;
        body.innerHTML = ''; const p = UI.busyPanel('Pulizia dei browser…'); body.appendChild(p);
        const r = await UI.run('browser', 'clean', { selection, closeRunning: true }, p).catch(() => null);
        body.innerHTML = '';
        if (!r) return scan();
        body.appendChild(doneCard(`Liberati ${bytes(r.freed)}`, `${num(r.items)} elementi eliminati.` + (r.skipped.length ? ` Saltati: ${r.skipped.join(', ')}` : ''), scan));
      }
      scan();
    }
  };

  // ---------------- Broken shortcuts ----------------
  UI.Views.shortcuts = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Collegamenti interrotti', 'Trova i collegamenti sul desktop, nel menu Start e in "Invia a" che puntano a file o programmi che non esistono più.', btn('Ripeti scansione', () => scan(), 'ghost', 'refresh')));
      root.appendChild(body);
      let data;
      async function scan() {
        body.innerHTML = ''; const p = UI.busyPanel('Ricerca dei collegamenti interrotti…'); body.appendChild(p);
        try { data = await UI.run('shortcuts', 'scan', {}, p); } catch (e) { body.innerHTML = ''; return; }
        App.setBadge('shortcuts', data.count);
        render();
      }
      function render() {
        body.innerHTML = '';
        if (!data.items.length) { body.appendChild(UI.empty('check', 'Nessun collegamento interrotto', 'Tutti i collegamenti funzionano correttamente.')); return; }
        data.items.forEach((x) => { x.sel = !x.ignored; });
        body.appendChild(UI.table([
          { label: '', sort: false, width: '36px', render: (r) => checkbox(r.sel, (v) => { r.sel = v; }) },
          { key: 'name', label: 'Collegamento', render: (r) => h('div', null, h('div', { class: 't' }, r.name), h('div', { class: 'faint mono' }, r.path)) },
          { key: 'target', label: 'Destinazione mancante', cls: 'ellip mono', render: (r) => h('span', { title: r.target }, r.target) },
          { key: 'location', label: 'Posizione', cls: 'nowrap' },
          { label: '', sort: false, render: (r) => h('button', { class: 'btn ghost sm', onclick: async () => { await ignore('shortcuts', r.path, !r.ignored); scan(); } }, r.ignored ? 'Non ignorare' : 'Ignora') }
        ], data.items, { rowClass: (r) => (r.ignored ? 'dim' : '') }));
        body.appendChild(h('div', { class: 'sticky-foot' }, h('span', { class: 'muted' }, 'I collegamenti rimossi vengono salvati nel Centro annullamento.'), h('div', { class: 'spacer' }), btn('Rimuovi selezionati', async () => {
          const paths = data.items.filter((x) => x.sel).map((x) => x.path);
          if (!paths.length) return;
          const r = await UI.run('shortcuts', 'clean', { paths });
          UI.toast(`${r.removed} collegamenti rimossi`);
          scan();
        }, 'primary')));
      }
      scan();
    }
  };

  // ---------------- Registry ----------------
  UI.Views.registry = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Pulizia del registro', 'Ricerca voci di registro non valide e riferimenti a file inesistenti. Viene sempre creato un backup prima della pulizia.', btn('Ripeti scansione', () => scan(), 'ghost', 'refresh')));
      root.appendChild(body);
      let data, filter = null;
      async function scan() {
        body.innerHTML = ''; const p = UI.busyPanel('Analisi del registro di sistema…'); body.appendChild(p);
        try { data = await UI.run('registry', 'scan', {}, p); } catch (e) { body.innerHTML = ''; return; }
        data.items.forEach((x) => { x.sel = !x.ignored; });
        App.setBadge('registry', data.count);
        render();
      }
      function render() {
        body.innerHTML = '';
        if (!data.items.length) { body.appendChild(UI.empty('check', 'Il registro è pulito', 'Non sono stati trovati problemi.')); return; }
        body.appendChild(h('div', { class: 'grid g4 mb' }, data.groups.map((g) => h('div', { class: 'card click' + (filter === g.id ? ' on' : ''), style: filter === g.id ? { borderColor: 'var(--accent)' } : null, title: g.tip, onclick: () => { filter = filter === g.id ? null : g.id; render(); } },
          h('div', { class: 'row between' }, h('b', null, g.name), h('span', { class: 'tag ' + (g.count ? 'warn' : 'ok') }, num(g.count))), h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } }, g.tip)))));
        const rows = data.items.filter((x) => !filter || x.cat === filter);
        body.appendChild(UI.table([
          { label: '', sort: false, width: '36px', render: (r) => checkbox(r.sel, (v) => { r.sel = v; }) },
          { key: 'catName', label: 'Categoria', cls: 'nowrap' },
          { key: 'detail', label: 'Problema', cls: 'ellip mono', render: (r) => h('span', { title: r.detail }, r.detail) },
          { key: 'key', label: 'Chiave', cls: 'ellip mono', render: (r) => h('span', { title: r.key + (r.value ? '\n' + r.value : '') }, r.key) },
          { label: '', sort: false, render: (r) => h('button', { class: 'btn ghost sm', onclick: async () => { await ignore('registry', r.key + '|' + (r.value || ''), !r.ignored); r.ignored = !r.ignored; r.sel = !r.ignored; render(); } }, r.ignored ? 'Non ignorare' : 'Ignora') }
        ], rows, { rowClass: (r) => (r.ignored ? 'dim' : '') }));
        body.appendChild(h('div', { class: 'sticky-foot' }, h('span', { class: 'muted' }, `${num(data.items.filter((x) => x.sel).length)} problemi selezionati · backup automatico nel Centro annullamento`), h('div', { class: 'spacer' }), btn('Risolvi selezionati', async () => {
          const ids = data.items.filter((x) => x.sel).map((x) => x.id);
          if (!ids.length) return;
          body.innerHTML = ''; const p = UI.busyPanel('Backup e pulizia del registro…'); body.appendChild(p);
          const r = await UI.run('registry', 'clean', { ids }, p).catch(() => null);
          App.setBadge('registry', 0);
          body.innerHTML = '';
          body.appendChild(doneCard(`${num(r ? r.removed : 0)} problemi risolti`, 'È stato creato un backup che puoi ripristinare dal Centro annullamento.', scan));
        }, 'primary')));
      }
      scan();
    }
  };

  // ---------------- Large & duplicate files ----------------
  UI.Views.largefiles = {
    render(root) {
      let tab = 'large', roots = [], minMB = 100;
      const body = h('div');
      root.appendChild(UI.pageHeader('File di grandi dimensioni e duplicati', 'Individua i file che occupano più spazio e le copie identiche dello stesso file.'));
      const tabsSlot = h('div');
      root.appendChild(tabsSlot); root.appendChild(body);
      function drawTabs() { tabsSlot.innerHTML = ''; tabsSlot.appendChild(UI.tabs([{ id: 'large', label: 'File di grandi dimensioni' }, { id: 'dup', label: 'File duplicati' }], tab, (t) => { tab = t; drawTabs(); intro(); })); }
      function intro() {
        body.innerHTML = '';
        const rootsEl = h('div', { class: 'muted' }, roots.length ? roots.join(' · ') : 'Cartella utente (predefinita)');
        body.appendChild(h('div', { class: 'card' },
          h('h3', null, tab === 'large' ? 'Cerca file di grandi dimensioni' : 'Cerca file duplicati'),
          h('div', { class: 'row mt wrap' }, h('b', null, 'Dove cercare:'), rootsEl, btn('Scegli cartelle…', async () => { const r = await api.openDialog({ properties: ['openDirectory', 'multiSelections'] }); if (r.length) { roots = r; intro(); } }, 'ghost sm', 'folder'),
            btn('Tutte le unità', async () => { const d = await api.call('recovery', 'drives'); roots = d.map((x) => x.letter + ':\\'); intro(); }, 'ghost sm', 'disk')),
          tab === 'large' ? h('div', { class: 'row mt' }, h('b', null, 'Dimensione minima:'), h('select', { class: 'input', onchange: (e) => { minMB = +e.target.value; } }, [50, 100, 250, 500, 1000, 4000].map((v) => h('option', { value: v, selected: v === minMB }, v >= 1000 ? v / 1000 + ' GB' : v + ' MB')))) : null,
          h('div', { class: 'mt' }, btn('Avvia ricerca', go, 'primary', 'search'))));
      }
      async function go() {
        body.innerHTML = ''; const p = UI.busyPanel('Ricerca in corso…'); body.appendChild(p);
        body.appendChild(h('div', { class: 'center' }, btn('Interrompi', () => api.call('files', 'cancel'), 'ghost sm')));
        if (tab === 'large') {
          const r = await UI.run('files', 'large', { roots, minMB }, p).catch(() => null);
          if (!r) return intro();
          showFiles(r.items.map((f) => Object.assign(f, { sel: false })));
        } else {
          const r = await UI.run('files', 'duplicates', { roots, minKB: 100 }, p).catch(() => null);
          if (!r) return intro();
          showDups(r);
        }
      }
      function footer(getSel, refresh) {
        return h('div', { class: 'sticky-foot' }, h('span', { class: 'muted' }, 'I file eliminati vengono spostati nel Cestino.'), h('div', { class: 'spacer' }), btn('Nuova ricerca', intro, 'ghost'), btn('Elimina selezionati', async () => {
          const files = getSel(); if (!files.length) return;
          if (!(await UI.confirmBox('Eliminare i file selezionati?', `${files.length} file (${bytes(files.reduce((a, f) => a + f.size, 0))}) verranno spostati nel Cestino.`, 'Elimina', 'danger'))) return;
          const r = await UI.run('files', 'remove', { files });
          UI.toast(`${r.removed} file spostati nel Cestino`);
          refresh(files);
        }, 'danger'));
      }
      function showFiles(items) {
        body.innerHTML = '';
        if (!items.length) { body.appendChild(UI.empty('check', 'Nessun file trovato', 'Non ci sono file più grandi della dimensione indicata.', btn('Nuova ricerca', intro, 'ghost'))); return; }
        body.appendChild(UI.table([
          { label: '', sort: false, width: '36px', render: (r) => checkbox(r.sel, (v) => { r.sel = v; }) },
          { key: 'name', label: 'Nome', render: (r) => h('div', null, h('div', { class: 't' }, r.name), h('div', { class: 'faint mono ellip', title: r.path }, r.path)) },
          { key: 'size', label: 'Dimensione', cls: 'nowrap', render: (r) => bytes(r.size) },
          { key: 'mtime', label: 'Modificato', cls: 'nowrap', render: (r) => UI.date(r.mtime) },
          { label: '', sort: false, render: (r) => h('button', { class: 'icon-btn', title: 'Mostra nella cartella', html: Icons.get('folder'), onclick: () => api.showInFolder(r.path) }) }
        ], items, { sortKey: 'size', sortDir: -1 }));
        body.appendChild(footer(() => items.filter((x) => x.sel), (rm) => showFiles(items.filter((x) => !rm.includes(x)))));
      }
      function showDups(r) {
        body.innerHTML = '';
        if (!r.groups.length) { body.appendChild(UI.empty('check', 'Nessun duplicato trovato', '', btn('Nuova ricerca', intro, 'ghost'))); return; }
        body.appendChild(h('div', { class: 'notice mb', html: Icons.get('info') + `<div>Trovati <b>${num(r.groups.length)}</b> gruppi di file identici: puoi recuperare <b>${bytes(r.wasted)}</b>. In ogni gruppo il file più vecchio non viene selezionato.</div>` }));
        const list = h('div', { class: 'list' });
        r.groups.forEach((g) => {
          g.files.forEach((f, i) => { f.sel = i > 0; });
          list.appendChild(h('div', { class: 'list-head' }, `${g.files.length} copie · ${bytes(g.size)} ciascuna`));
          g.files.forEach((f) => list.appendChild(h('div', { class: 'item' }, checkbox(f.sel, (v) => { f.sel = v; }), h('div', { class: 'grow d mono sel' }, f.path), h('div', { class: 'faint' }, UI.date(f.mtime)), h('button', { class: 'icon-btn', html: Icons.get('folder'), onclick: () => api.showInFolder(f.path) }))));
        });
        body.appendChild(list);
        body.appendChild(footer(() => r.groups.flatMap((g) => g.files.filter((f) => f.sel)), () => go()));
      }
      drawTabs(); intro();
    }
  };
})();
