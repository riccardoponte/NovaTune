(function () {
  const { h, btn, checkbox } = UI;
  UI.Views.software = {
    render(root) {
      let tab = 'updates';
      const tabsSlot = h('div'), body = h('div');
      root.appendChild(UI.pageHeader('Software Updater', 'Mantieni aggiornate le applicazioni installate: le versioni obsolete possono contenere vulnerabilità di sicurezza. Gli aggiornamenti provengono dal catalogo ufficiale Windows Package Manager.', btn('Cerca aggiornamenti', () => scan(), 'primary', 'refresh')));
      root.appendChild(tabsSlot); root.appendChild(body);
      let data = App.cache.software || null;
      function drawTabs() {
        tabsSlot.innerHTML = '';
        if (!data || !data.winget) return;
        tabsSlot.appendChild(UI.tabs([{ id: 'updates', label: 'Aggiornamenti disponibili', badge: data.items.filter((i) => !i.ignored).length || null }, { id: 'ignored', label: 'Ignorati', badge: data.items.filter((i) => i.ignored).length || null }, { id: 'install', label: 'Installa nuovi programmi' }], tab, (t) => { tab = t; drawTabs(); render(); }));
      }
      async function scan() {
        tabsSlot.innerHTML = ''; body.innerHTML = '';
        const p = UI.busyPanel('Verifica delle versioni dei programmi…'); body.appendChild(p);
        try { data = await UI.run('software', 'scan', {}, p); } catch (e) { body.innerHTML = ''; return; }
        App.cache.software = data;
        data.items.forEach((i) => { i.sel = !i.ignored; });
        App.setBadge('software', data.items.filter((i) => !i.ignored).length, true);
        drawTabs(); render();
      }
      function render() {
        body.innerHTML = '';
        if (!data.winget) {
          body.appendChild(h('div', { class: 'notice warn', html: Icons.get('alert') + '<div><b>Windows Package Manager (winget) non è installato.</b> È incluso nel "Programma di installazione app" di Microsoft, preinstallato su Windows 11 e sulle versioni aggiornate di Windows 10.</div>' }));
          body.appendChild(h('div', { class: 'row mt' }, btn('Installa da Microsoft Store', () => api.open('ms-windows-store://pdp/?productid=9NBLGGH4NNS1'), 'primary'), btn('Riprova', scan, 'ghost')));
          return;
        }
        if (tab === 'install') return installTab();
        const rows = data.items.filter((i) => (tab === 'ignored') === !!i.ignored);
        if (!rows.length) { body.appendChild(UI.empty('check', tab === 'ignored' ? 'Nessun programma ignorato' : 'Tutti i programmi sono aggiornati', '')); return; }
        body.appendChild(UI.table([
          tab === 'updates' ? { label: '', sort: false, width: '36px', render: (i) => checkbox(i.sel, (v) => { i.sel = v; }) } : null,
          { key: 'name', label: 'Programma', render: (i) => h('div', { class: 'prog-cell' }, h('div', { class: 'ph', html: Icons.get('box') }), h('div', { style: { minWidth: 0 } }, h('div', { class: 'nm' }, i.name), h('div', { class: 'sb mono' }, i.id))) },
          { key: 'version', label: 'Versione installata', cls: 'nowrap mono' },
          { key: 'available', label: 'Ultima versione', cls: 'nowrap mono', render: (i) => h('span', { style: { color: 'var(--ok)', fontWeight: 600 } }, i.available) },
          { label: 'Stato', sort: false, render: (i) => i.status ? h('span', { class: 'tag ' + (i.status === 'ok' ? 'ok' : i.status === 'err' ? 'err' : 'info') }, i.statusText) : null },
          { label: '', sort: false, render: (i) => h('div', { class: 'row' }, tab === 'updates' ? btn('Aggiorna', () => update([i]), 'primary sm') : null, h('button', { class: 'btn ghost sm', onclick: async () => { await UI.ignore('software', i.id, !i.ignored); i.ignored = !i.ignored; i.sel = !i.ignored; drawTabs(); render(); } }, i.ignored ? 'Ripristina' : 'Ignora')) }
        ].filter(Boolean), rows, { sortKey: 'name' }));
        if (tab === 'updates') body.appendChild(h('div', { class: 'sticky-foot' }, h('span', { class: 'muted' }, 'Gli aggiornamenti vengono installati in modalità silenziosa. Chiudi i programmi da aggiornare.'), h('div', { class: 'spacer' }), btn('Aggiorna selezionati', () => update(rows.filter((i) => i.sel)), 'primary lg', 'download')));
      }
      async function update(list) {
        if (!list.length) return;
        list.forEach((i) => { i.status = 'run'; i.statusText = 'In coda…'; });
        render();
        const panel = UI.busyPanel(`Aggiornamento di ${list.length} ${list.length === 1 ? 'programma' : 'programmi'}…`);
        body.prepend(panel);
        const r = await UI.run('software', 'update', { ids: list.map((i) => i.id), includeUnknown: true }, panel).catch(() => null);
        panel.remove();
        if (!r) return;
        for (const res of r.results) { const it = data.items.find((x) => x.id === res.id); if (it) { it.status = res.ok ? 'ok' : 'err'; it.statusText = res.ok ? 'Aggiornato' : 'Non riuscito'; it.log = res.log; } }
        const ok = r.results.filter((x) => x.ok).length;
        UI.toast(`${ok} di ${list.length} programmi aggiornati`, ok === list.length ? 'ok' : 'warn');
        data.items = data.items.filter((i) => i.status !== 'ok');
        App.setBadge('software', data.items.filter((i) => !i.ignored).length, true);
        drawTabs(); render();
        const failed = r.results.filter((x) => !x.ok);
        if (failed.length) UI.modal({ title: 'Aggiornamenti non riusciti', wide: true, body: h('div', null, failed.map((f) => h('div', { class: 'mb' }, h('b', null, f.id), h('pre', { class: 'log' }, f.log || 'Codice ' + f.code)))) });
      }
      function installTab() {
        let q = '';
        const res = h('div', { class: 'mt' });
        body.appendChild(h('div', { class: 'card' }, h('h3', null, 'Cerca e installa programmi'), h('p', { class: 'muted' }, 'Installa in modo sicuro programmi dal catalogo ufficiale di Windows Package Manager (es. "vlc", "7zip", "firefox").'),
          h('div', { class: 'row mt' }, h('input', { class: 'input', style: { flex: 1 }, placeholder: 'Nome del programma…', onkeydown: (e) => { if (e.key === 'Enter') go(); }, oninput: (e) => { q = e.target.value; } }), btn('Cerca', () => go(), 'primary', 'search')), res));
        async function go() {
          if (!q.trim()) return;
          res.innerHTML = ''; res.appendChild(UI.busyPanel('Ricerca…'));
          const list = await UI.run('software', 'search', { query: q.trim() }).catch(() => []);
          res.innerHTML = '';
          if (!list.length) { res.appendChild(h('p', { class: 'muted' }, 'Nessun risultato.')); return; }
          res.appendChild(UI.table([{ key: 'name', label: 'Nome' }, { key: 'id', label: 'ID', cls: 'mono' }, { key: 'version', label: 'Versione', cls: 'mono' }, { label: '', sort: false, render: (x) => btn('Installa', async (e) => { e.target.disabled = true; e.target.textContent = 'Installazione…'; const r = await UI.run('software', 'install', { id: x.id }).catch(() => null); e.target.textContent = r && r.ok ? 'Installato' : 'Errore'; UI.toast(r && r.ok ? x.name + ' installato' : 'Installazione non riuscita', r && r.ok ? 'ok' : 'err'); }, 'primary sm') }], list));
        }
      }
      if (data) { drawTabs(); render(); } else scan();
    }
  };
})();
