(function () {
  const { h, bytes, num, btn, checkbox } = UI;

  function progIcon(p, icons) {
    const src = icons[p.id];
    return src ? h('img', { src }) : h('div', { class: 'ph', html: Icons.get('box') });
  }

  // ---- leftovers review (shared by uninstall & forced) ----
  function leftoversView(container, res, program, onDone) {
    container.innerHTML = '';
    const total = res.files.length + res.registry.length + res.other.length;
    if (!total) { container.appendChild(UI.doneCard(`${program.name} è stato rimosso completamente`, 'Non sono stati trovati file o voci di registro residui.')); onDone && onDone(); return; }
    container.appendChild(h('div', { class: 'notice warn mb', html: Icons.get('alert') + `<div>Trovati <b>${total}</b> elementi residui di <b>${program.name}</b> (${bytes(res.totalSize)}). Controlla l'elenco: le voci di registro vengono salvate nel Centro annullamento e i file spostati nel Cestino.</div>` }));
    const mk = (title, items, render) => items.length ? h('div', { class: 'list mb' }, h('div', { class: 'list-head' }, title, h('span', { class: 'badge' }, items.length)), items.map((it) => h('div', { class: 'item' }, checkbox(it.selected, (v) => { it.selected = v; }), h('div', { class: 'grow' }, render(it))))) : null;
    { const _x = mk('File e cartelle', res.files, (f) => [h('div', { class: 'd mono sel', style: { color: 'var(--text)' } }, f.path), h('div', { class: 'd' }, `${f.reason} · ${f.type === 'folder' ? num(f.count) + ' file · ' : ''}${bytes(f.size)}`)]); if (_x) container.appendChild(_x); }
    { const _x = mk('Registro di sistema', res.registry, (r) => [h('div', { class: 'd mono sel', style: { color: 'var(--text)' } }, r.key + (r.value ? '  →  ' + r.value : '')), h('div', { class: 'd' }, r.reason)]); if (_x) container.appendChild(_x); }
    { const _x = mk('Servizi e attività pianificate', res.other, (o) => [h('div', { class: 't' }, o.display || o.name), h('div', { class: 'd' }, o.reason + (o.path ? ' · ' + o.path : ''))]); if (_x) container.appendChild(_x); }
    container.appendChild(h('div', { class: 'row' }, h('div', { class: 'spacer' }), btn('Salta', () => { container.innerHTML = ''; onDone && onDone(); }, 'ghost'), btn('Rimuovi residui selezionati', async () => {
      const p = UI.busyPanel('Rimozione dei residui…');
      container.innerHTML = ''; container.appendChild(p);
      const r = await UI.run('uninstaller', 'removeLeftovers', { files: res.files.filter((x) => x.selected), registry: res.registry.filter((x) => x.selected), other: res.other.filter((x) => x.selected), programName: program.name }, p).catch(() => null);
      container.innerHTML = '';
      if (r) container.appendChild(UI.doneCard('Residui rimossi', `${num(r.filesRemoved)} file/cartelle e ${num(r.regRemoved)} voci di registro rimossi · ${bytes(r.freed)} liberati` + (r.failed.length ? ` · ${r.failed.length} elementi in uso non rimossi` : '')));
      onDone && onDone();
    }, 'primary')));
  }
  UI.leftoversView = leftoversView;

  UI.Views.programs = {
    render(root) {
      let filter = 'all', q = '', progs = App.cache.programs || null, icons = App.cache.icons || {};
      const head = UI.pageHeader('Programmi', 'Disinstalla i programmi in modo completo: dopo il programma di disinstallazione, NovaTune cerca e rimuove file, cartelle, voci di registro, servizi e attività residui.', btn('Aggiorna', () => load(true), 'ghost', 'refresh'));
      const tabsSlot = h('div'), body = h('div');
      root.appendChild(head); root.appendChild(tabsSlot); root.appendChild(body);
      async function load(force) {
        if (!progs || force) {
          body.innerHTML = ''; tabsSlot.innerHTML = ''; const p = UI.busyPanel('Lettura dei programmi installati…'); body.appendChild(p);
          try { progs = await UI.run('uninstaller', 'list', {}, p); } catch (e) { body.innerHTML = ''; return; }
          App.cache.programs = progs;
          progs.forEach((x) => { x.sel = false; });
          api.call('uninstaller', 'icons', { items: progs.map((x) => ({ id: x.id, icon: x.icon, location: x.location })) }).then((ic) => { icons = App.cache.icons = ic; render(); });
        }
        render();
      }
      function cats() {
        const now = Date.now();
        return {
          all: progs,
          recent: progs.filter((p) => p.installDate && now - new Date(p.installDate) < 30 * 86400000),
          large: progs.filter((p) => p.size > 500 * 1048576),
          rare: progs.filter((p) => p.lastUsed && now - new Date(p.lastUsed) > 60 * 86400000),
          broken: progs.filter((p) => !p.uninstall && !p.quiet)
        };
      }
      function render() {
        const c = cats();
        tabsSlot.innerHTML = '';
        tabsSlot.appendChild(UI.tabs([{ id: 'all', label: 'Tutti i programmi', badge: c.all.length }, { id: 'recent', label: 'Installati di recente', badge: c.recent.length || null }, { id: 'large', label: 'Programmi di grandi dimensioni', badge: c.large.length || null }, { id: 'rare', label: 'Usati raramente', badge: c.rare.length || null }], filter, (t) => { filter = t; render(); }));
        body.innerHTML = '';
        const selCount = h('span', { class: 'muted' });
        const upd = () => { const s = progs.filter((p) => p.sel); selCount.textContent = s.length ? `${s.length} selezionati · ${bytes(s.reduce((a, p) => a + (p.size || 0), 0))}` : 'Seleziona più programmi per la disinstallazione in blocco'; batchBtn.disabled = !s.length; };
        const batchBtn = btn('Disinstalla selezionati', () => uninstall(progs.filter((p) => p.sel)), 'danger', 'trash');
        body.appendChild(h('div', { class: 'row mb' }, UI.search('Cerca un programma o un editore…', (v) => { q = v; draw(); }), h('span', { class: 'muted' }, `${num(progs.length)} programmi · ${bytes(progs.reduce((a, p) => a + (p.size || 0), 0))}`)));
        const slot = h('div'); body.appendChild(slot);
        function draw() {
          slot.innerHTML = '';
          const rows = c[filter].filter((p) => !q || (p.name + ' ' + p.publisher).toLowerCase().includes(q));
          slot.appendChild(UI.table([
            { label: '', sort: false, width: '36px', render: (p) => checkbox(p.sel, (v) => { p.sel = v; upd(); }) },
            { key: 'name', label: 'Programma', render: (p) => h('div', { class: 'prog-cell' }, progIcon(p, icons), h('div', { style: { minWidth: 0 } }, h('div', { class: 'nm' }, p.name), h('div', { class: 'sb' }, p.publisher || '—'))) },
            { key: 'version', label: 'Versione', cls: 'nowrap mono' },
            { key: 'size', label: 'Dimensione', cls: 'nowrap', render: (p) => (p.size ? bytes(p.size) : '—') },
            { key: 'installDate', label: 'Installato', cls: 'nowrap', render: (p) => UI.date(p.installDate) },
            filter === 'rare' ? { key: 'lastUsed', label: 'Ultimo utilizzo', cls: 'nowrap', render: (p) => UI.date(p.lastUsed) } : null,
            { label: '', sort: false, render: (p) => h('div', { class: 'row' }, btn('Disinstalla', () => uninstall([p]), 'ghost sm'), h('button', { class: 'icon-btn', title: 'Dettagli', html: Icons.get('info'), onclick: () => details(p) })) }
          ].filter(Boolean), rows, { sortKey: filter === 'large' ? 'size' : filter === 'recent' ? 'installDate' : 'name', sortDir: filter === 'large' || filter === 'recent' ? -1 : 1 }));
        }
        draw();
        body.appendChild(h('div', { class: 'sticky-foot' }, selCount, h('div', { class: 'spacer' }), batchBtn));
        upd();
      }
      function details(p) {
        UI.modal({ title: p.name, wide: true, body: h('div', { class: 'kv sel' },
          h('div', null, 'Editore'), h('div', null, p.publisher || '—'), h('div', null, 'Versione'), h('div', null, p.version || '—'),
          h('div', null, 'Installato il'), h('div', null, UI.date(p.installDate)), h('div', null, 'Dimensione'), h('div', null, p.size ? bytes(p.size) : '—'),
          h('div', null, 'Cartella'), h('div', { class: 'mono' }, p.location || '—'), h('div', null, 'Disinstallazione'), h('div', { class: 'mono' }, p.uninstall || '—'),
          h('div', null, 'Silenziosa'), h('div', { class: 'mono' }, p.quiet || (p.msi ? 'Windows Installer (msiexec /qn)' : '—')), h('div', null, 'Chiave di registro'), h('div', { class: 'mono' }, p.key),
          h('div', null, 'Sito web'), h('div', null, p.url ? h('a', { class: 'link', onclick: () => api.open(p.url) }, p.url) : '—')),
          actions: [p.location ? { label: 'Apri cartella', kind: 'ghost', onClick: () => api.open(p.location) } : null, { label: 'Disinstalla', kind: 'danger', onClick: () => uninstall([p]) }].filter(Boolean) });
      }
      async function uninstall(list) {
        let quiet = list.length > 1, rp = App.settings.createRestorePoint, autoLeft = false;
        const ok = await new Promise((res) => UI.modal({
          title: list.length > 1 ? `Disinstallare ${list.length} programmi?` : `Disinstallare ${list[0].name}?`,
          body: h('div', null,
            list.length > 1 ? h('div', { class: 'list mb', style: { maxHeight: '180px', overflow: 'auto' } }, list.map((p) => h('div', { class: 'item' }, h('div', { class: 'grow t' }, p.name), h('span', { class: 'muted' }, p.size ? bytes(p.size) : '')))) : null,
            h('label', { class: 'row mb' }, UI.checkbox(rp, (v) => { rp = v; }), h('span', null, 'Crea un punto di ripristino prima della disinstallazione')),
            h('label', { class: 'row mb' }, UI.checkbox(quiet, (v) => { quiet = v; }), h('span', null, 'Disinstallazione silenziosa, se supportata dal programma')),
            h('label', { class: 'row' }, UI.checkbox(autoLeft, (v) => { autoLeft = v; }), h('span', null, 'Rimuovi automaticamente i file residui (senza revisione)'))),
          onClose: () => res(false),
          actions: [{ label: 'Annulla', kind: 'ghost', onClick: () => res(false) }, { label: 'Disinstalla', kind: 'danger', onClick: () => res(true) }]
        }));
        if (!ok) return;
        tabsSlot.innerHTML = '';
        body.innerHTML = '';
        const log = h('div', { class: 'list mb' });
        const stage = h('div');
        body.appendChild(log); body.appendChild(stage);
        let first = true;
        for (const p of list) {
          const row = h('div', { class: 'item' }, progIcon(p, icons), h('div', { class: 'grow' }, h('div', { class: 't' }, p.name), h('div', { class: 'd' }, 'In corso…')));
          log.appendChild(row);
          const st = row.querySelector('.d');
          const panel = UI.busyPanel(`Disinstallazione di ${p.name}`);
          stage.innerHTML = ''; stage.appendChild(panel);
          let r;
          try { r = await UI.run('uninstaller', 'runUninstaller', { program: p, quiet, restorePoint: rp && first }, panel); } catch (e) { st.textContent = 'Errore: ' + UI.cleanErr(e); continue; }
          first = false;
          st.textContent = r.removed ? 'Programma disinstallato · ricerca residui…' : 'Il programma di disinstallazione è terminato (la voce è ancora presente) · ricerca residui…';
          panel.set({ label: 'Ricerca di file e voci di registro residui…', percent: 50 });
          const left = await UI.run('uninstaller', 'scanLeftovers', { program: p, includeUninstallKey: r.removed ? true : false }, panel).catch(() => ({ files: [], registry: [], other: [], totalSize: 0 }));
          if (r.removed) api.call('uninstaller', 'markUninstalled', p.name);
          if (autoLeft || list.length > 1) {
            const sel = { files: left.files, registry: left.registry, other: left.other, programName: p.name };
            if (r.removed && (sel.files.length + sel.registry.length + sel.other.length)) {
              const rr = await UI.run('uninstaller', 'removeLeftovers', sel, panel).catch(() => null);
              st.textContent = rr ? `Completato · ${rr.filesRemoved + rr.regRemoved} residui rimossi (${bytes(rr.freed)})` : 'Completato';
            } else st.textContent = r.removed ? 'Completato · nessun residuo' : 'Disinstallazione annullata o non completata';
            stage.innerHTML = '';
          } else {
            st.textContent = r.removed ? 'Disinstallato' : 'Disinstallazione non completata';
            await new Promise((done) => leftoversView(stage, left, p, done));
          }
        }
        App.cache.programs = null; progs = null;
        stage.appendChild(h('div', { class: 'row mt' }, btn('Torna all\'elenco', () => load(true), 'primary')));
      }
      load();
    }
  };

  // ---- Windows (Store) apps ----
  UI.Views.storeapps = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('App di Windows', 'Rimuovi le app di Microsoft Store e le app preinstallate di Windows che non usi.', btn('Aggiorna', () => load(), 'ghost', 'refresh')));
      root.appendChild(body);
      let apps, q = '', onlyStore = false;
      async function load() {
        body.innerHTML = ''; body.appendChild(UI.busyPanel('Lettura delle app…'));
        try { apps = await api.call('uninstaller', 'storeApps'); } catch (e) { body.innerHTML = ''; UI.toast(UI.cleanErr(e), 'err'); return; }
        apps.forEach((a) => { a.sel = false; });
        render();
      }
      function render() {
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'row mb' }, UI.search('Cerca un\'app…', (v) => { q = v; draw(); }), h('label', { class: 'row muted' }, UI.checkbox(onlyStore, (v) => { onlyStore = v; draw(); }), 'Solo app scaricate da Microsoft Store'), h('span', { class: 'muted' }, `${apps.length} app`)));
        const slot = h('div'); body.appendChild(slot);
        function draw() {
          slot.innerHTML = '';
          slot.appendChild(UI.table([
            { label: '', sort: false, width: '36px', render: (a) => checkbox(a.sel, (v) => { a.sel = v; }) },
            { key: 'name', label: 'App', render: (a) => h('div', { class: 'prog-cell' }, h('div', { class: 'ph', html: Icons.get('windows') }), h('div', { style: { minWidth: 0 } }, h('div', { class: 'nm' }, a.name), h('div', { class: 'sb' }, a.publisher))) },
            { key: 'version', label: 'Versione', cls: 'nowrap mono' },
            { key: 'installDate', label: 'Installata', cls: 'nowrap', render: (a) => UI.date(a.installDate) },
            { key: 'store', label: 'Origine', render: (a) => h('span', { class: 'tag ' + (a.store ? 'info' : '') }, a.store ? 'Store' : 'Sistema/Sideload') },
            { label: '', sort: false, render: (a) => btn('Rimuovi', () => remove([a]), 'ghost sm') }
          ], apps.filter((a) => (!onlyStore || a.store) && (!q || (a.name + a.publisher + a.package).toLowerCase().includes(q))), { sortKey: 'name' }));
        }
        draw();
        body.appendChild(h('div', { class: 'sticky-foot' }, h('span', { class: 'muted' }, 'Le app rimosse possono essere reinstallate da Microsoft Store.'), h('div', { class: 'spacer' }), btn('Rimuovi selezionate', () => remove(apps.filter((a) => a.sel)), 'danger', 'trash')));
      }
      async function remove(list) {
        if (!list.length) return;
        if (!(await UI.confirmBox(`Rimuovere ${list.length > 1 ? list.length + ' app' : list[0].name}?`, list.map((a) => a.name).join(', '), 'Rimuovi', 'danger'))) return;
        body.innerHTML = ''; const p = UI.busyPanel('Rimozione delle app…'); body.appendChild(p);
        const r = await UI.run('uninstaller', 'removeStoreApps', { packages: list.map((a) => a.package) }, p).catch(() => []);
        const ok = r.filter((x) => x.ok).length;
        UI.toast(`${ok} app rimosse` + (ok < list.length ? ` · ${list.length - ok} non rimosse` : ''), ok === list.length ? 'ok' : 'warn');
        load();
      }
      load();
    }
  };

  // ---- Browser extensions ----
  UI.Views.extensions = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Estensioni del browser', 'Individua e rimuovi estensioni e componenti aggiuntivi indesiderati da Chrome, Edge, Brave, Vivaldi, Opera e Firefox.', btn('Aggiorna', () => load(), 'ghost', 'refresh')));
      root.appendChild(body);
      let list;
      async function load() {
        body.innerHTML = ''; body.appendChild(UI.busyPanel('Ricerca delle estensioni…'));
        list = await api.call('uninstaller', 'extensions');
        list.forEach((e) => { e.sel = false; });
        render();
      }
      function render() {
        body.innerHTML = '';
        if (!list.length) { body.appendChild(UI.empty('check', 'Nessuna estensione trovata', '')); return; }
        const browsers = [...new Set(list.map((e) => e.browser))];
        for (const b of browsers) {
          const items = list.filter((e) => e.browser === b);
          body.appendChild(h('div', { class: 'list mb' }, h('div', { class: 'list-head' }, h('span', { html: Icons.get('globe') }), b, h('span', { class: 'badge' }, items.length), h('span', { class: 'spacer' }), h('button', { class: 'btn ghost sm', onclick: () => api.call('uninstaller', 'openExtensionsPage', items[0]) }, 'Apri pagina estensioni')),
            items.map((e) => h('div', { class: 'item' }, checkbox(e.sel, (v) => { e.sel = v; }),
              e.icon ? h('img', { src: e.icon, style: { width: '30px', height: '30px', borderRadius: '6px' } }) : h('div', { class: 'card-ic', style: { margin: 0, width: '30px', height: '30px' }, html: Icons.get('puzzle') }),
              h('div', { class: 'grow' }, h('div', { class: 't' }, e.name, ' ', h('span', { class: 'faint', style: { fontWeight: 400, fontSize: '12px' } }, 'v' + e.version + ' · ' + e.profile)), h('div', { class: 'd' }, e.description || e.id), e.permissions && e.permissions.length ? h('div', { class: 'd faint' }, 'Permessi: ' + e.permissions.join(', ')) : null),
              h('span', { class: 'tag ' + (e.enabled ? 'ok' : '') }, e.enabled ? 'attiva' : 'disattivata'),
              btn('Rimuovi', () => remove([e]), 'ghost sm')))));
        }
        body.appendChild(h('div', { class: 'sticky-foot' }, h('span', { class: 'muted' }, 'Il browser verrà chiuso durante la rimozione.'), h('div', { class: 'spacer' }), btn('Rimuovi selezionate', () => remove(list.filter((e) => e.sel)), 'danger', 'trash')));
      }
      async function remove(items) {
        if (!items.length) return;
        if (!(await UI.confirmBox(`Rimuovere ${items.length > 1 ? items.length + ' estensioni' : '"' + items[0].name + '"'}?`, 'I browser interessati verranno chiusi. Se un\'estensione è sincronizzata con il tuo account, rimuovila anche dalla pagina delle estensioni del browser per evitare che venga reinstallata.', 'Rimuovi', 'danger'))) return;
        const r = await UI.run('uninstaller', 'removeExtensions', { items });
        const ok = r.filter((x) => x.ok).length;
        UI.toast(`${ok} estensioni rimosse`, ok === items.length ? 'ok' : 'warn');
        load();
      }
      load();
    }
  };

  // ---- Forced uninstall ----
  UI.Views.forced = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Disinstallazione forzata', 'Rimuovi programmi ostinati, danneggiati o già disinstallati parzialmente: indica la cartella del programma o il suo nome e NovaTune cercherà ed eliminerà tutte le tracce.'));
      root.appendChild(body);
      let folder = '', name = '';
      function intro() {
        body.innerHTML = '';
        const folderEl = h('input', { class: 'input', style: { flex: 1 }, placeholder: 'Es. C:\\Program Files\\NomeProgramma', value: folder, oninput: (e) => { folder = e.target.value; } });
        const drop = h('div', { class: 'drop mb', ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'), ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) { folder = api.filePath(f); intro(); } } },
          h('div', { html: Icons.get('folder'), style: { marginBottom: '8px' } }), 'Trascina qui la cartella del programma o un suo file eseguibile');
        body.appendChild(h('div', { class: 'card' }, drop,
          h('div', { class: 'row mb' }, h('b', { style: { width: '160px' } }, 'Cartella del programma'), folderEl, btn('Sfoglia…', async () => { const r = await api.openDialog({ properties: ['openDirectory'] }); if (r[0]) { folder = r[0]; intro(); } }, 'ghost', 'folder')),
          h('div', { class: 'row mb' }, h('b', { style: { width: '160px' } }, 'Nome del programma'), h('input', { class: 'input', style: { flex: 1 }, placeholder: 'Facoltativo, es. "Nome Programma"', value: name, oninput: (e) => { name = e.target.value; } })),
          h('div', { class: 'notice warn mb', html: Icons.get('alert') + '<div>La disinstallazione forzata termina i processi del programma, elimina i servizi e le attività pianificate collegate e rimuove file e voci di registro. Controlla attentamente l\'elenco prima di confermare.</div>' }),
          btn('Cerca tracce', scan, 'primary', 'search')));
      }
      async function scan() {
        let f = folder.trim().replace(/"/g, '');
        if (/\.exe$/i.test(f)) f = f.replace(/\\[^\\]+$/, '');
        if (!f && !name.trim()) { UI.toast('Indica una cartella o il nome del programma', 'warn'); return; }
        body.innerHTML = ''; const p = UI.busyPanel('Ricerca delle tracce del programma…'); body.appendChild(p);
        const r = await UI.run('uninstaller', 'forcedScan', { folder: f, name: name.trim() }, p).catch(() => null);
        if (!r) return intro();
        leftoversView(body, r, r.program, () => body.appendChild(h('div', { class: 'row mt' }, btn('Nuova ricerca', intro, 'ghost'))));
      }
      intro();
    }
  };
})();
