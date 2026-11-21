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
      // ---------- update job (survives navigation between sections) ----------
      function update(list) {
        if (!list.length || (App.softwareJob && !App.softwareJob.finished)) return;
        startJob(list.map((i) => ({ id: i.id, name: i.name, from: i.version, to: i.available })), 'update');
        showJob();
      }

      function showJob() {
        const job = App.softwareJob;
        tabsSlot.innerHTML = '';
        body.innerHTML = '';
        const overallBar = h('div', { class: 'bar-fill' });
        const overallLbl = h('div', { class: 'muted' });
        const cancelBtn = btn('Annulla', async () => {
          if (!(await UI.confirmBox('Annullare gli aggiornamenti?', 'L\'aggiornamento in corso verrà interrotto e quelli in coda non verranno eseguiti. Un programma interrotto durante l\'installazione potrebbe dover essere reinstallato.', 'Annulla aggiornamenti', 'danger'))) return;
          api.call('software', 'cancel');
        }, 'ghost', 'stop');
        const doneSlot = h('div');
        const head = h('div', { class: 'card mb' },
          h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, job.mode === 'install' ? 'Installazione in corso' : 'Aggiornamento dei programmi'), cancelBtn),
          h('div', { class: 'bar mt', style: { width: '100%', maxWidth: 'none' } }, overallBar), h('div', { class: 'row between mt' }, overallLbl), doneSlot);
        const list = h('div', { class: 'list' });
        const rows = job.items.map((it) => {
          const el = progressRow(it);
          list.appendChild(el);
          return el;
        });
        body.appendChild(head);
        body.appendChild(list);
        const paint = () => {
          rows.forEach((r) => r.paint());
          overallBar.style.width = Math.max(2, job.overall) + '%';
          const cur = job.items.findIndex((i) => !['done', 'error', 'cancelled'].includes(i.phase));
          overallLbl.textContent = job.finished
            ? `Completato: ${job.items.filter((i) => i.phase === 'done').length} di ${job.items.length} ${job.mode === 'install' ? 'installati' : 'aggiornati'}`
            : `Programma ${Math.max(1, cur + 1)} di ${job.items.length} · ${job.overall}% complessivo`;
          cancelBtn.style.display = job.finished ? 'none' : '';
          if (job.finished && !doneSlot.childNodes.length) {
            doneSlot.appendChild(h('div', { class: 'row mt' }, btn(job.mode === 'install' ? 'Torna alla ricerca' : 'Torna all\'elenco', () => { App.softwareJob = null; data = App.cache.software || null; if (data) { drawTabs(); render(); } else scan(); }, 'primary'), btn('Cerca di nuovo gli aggiornamenti', () => { App.softwareJob = null; scan(); }, 'ghost', 'refresh')));
          }
        };
        job.onChange = paint;
        paint();
      }

      function fmtTime(s) {
        if (!isFinite(s) || s <= 0) return '';
        s = Math.round(s);
        return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
      }

      function progressRow(it) {
        const fill = h('div', { class: 'bar-fill' });
        const bar = h('div', { class: 'bar', style: { width: '100%', maxWidth: 'none', height: '6px' } }, fill);
        const status = h('div', { class: 'd' });
        const tag = h('span', { class: 'tag' });
        const detailsBtn = h('button', { class: 'btn ghost sm', style: { display: 'none' }, onclick: () => UI.modal({ title: it.name, wide: true, body: h('pre', { class: 'log' }, it.log || it.message || '') }) }, 'Dettagli');
        const el = h('div', { class: 'item', style: { alignItems: 'flex-start' } },
          h('div', { class: 'ph', style: { width: '34px', height: '34px', borderRadius: '8px', background: 'var(--panel2)', display: 'grid', placeItems: 'center', flex: 'none' }, html: Icons.get('box') }),
          h('div', { class: 'grow' },
            h('div', { class: 'row between' }, h('div', { class: 't' }, it.name, it.to ? h('span', { class: 'faint mono', style: { fontWeight: 400, fontSize: '12px', marginLeft: '8px' } }, `${it.from || ''} → ${it.to}`) : null), h('div', { class: 'row' }, detailsBtn, tag)),
            h('div', { style: { margin: '8px 0 6px' } }, bar), status));
        el.paint = () => {
          const B = UI.bytes;
          bar.classList.toggle('indet', it.phase === 'install' || it.phase === 'prepare' || (it.phase === 'download' && it.percent == null));
          fill.style.background = it.phase === 'error' ? 'var(--err)' : it.phase === 'done' ? 'var(--ok)' : it.phase === 'cancelled' ? 'var(--faint)' : '';
          let pct = 0, txt = '', tg = ['In coda', ''];
          switch (it.phase) {
            case 'queued': txt = 'In attesa…'; break;
            case 'prepare': txt = it.message || 'Ricerca del pacchetto…'; tg = ['Preparazione', 'info']; break;
            case 'download': {
              pct = it.percent || 0;
              const parts = [`Download${it.part > 1 ? ' (file ' + it.part + ')' : ''}: ${it.file || ''}`];
              if (it.total) parts.push(`${B(it.received)} di ${B(it.total)}`); else if (it.received) parts.push(B(it.received));
              if (it.speed > 0) parts.push(`${B(it.speed)}/s`);
              if (it.speed > 0 && it.total) { const eta = fmtTime((it.total - it.received) / it.speed); if (eta) parts.push(`${eta} rimanenti`); }
              txt = parts.join(' · ');
              tg = [it.percent != null ? `Download ${it.percent}%` : 'Download', 'info'];
              break;
            }
            case 'verify': pct = 100; txt = `Verifica dell'integrità del file scaricato (${B(it.total)})…`; tg = ['Verifica', 'info']; break;
            case 'install': pct = 100; txt = it.message && !/scaricato|downloaded/i.test(it.message) ? it.message : 'Installazione in corso…'; tg = ['Installazione', 'violet']; break;
            case 'done': pct = 100; txt = it.message || 'Aggiornato'; tg = [job().mode === 'install' ? 'Installato' : 'Aggiornato', 'ok']; break;
            case 'error': pct = 100; txt = it.message || 'Non riuscito'; tg = ['Errore', 'err']; break;
            case 'cancelled': pct = 100; txt = 'Annullato'; tg = ['Annullato', '']; break;
          }
          fill.style.width = (it.phase === 'install' || it.phase === 'prepare') ? '' : Math.max(it.phase === 'queued' ? 0 : 2, pct) + '%';
          status.textContent = txt;
          tag.textContent = tg[0]; tag.className = 'tag ' + tg[1];
          detailsBtn.style.display = it.phase === 'error' && it.log ? '' : 'none';
        };
        return el;
      }
      const job = () => App.softwareJob || {};

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
          res.appendChild(UI.table([{ key: 'name', label: 'Nome' }, { key: 'id', label: 'ID', cls: 'mono' }, { key: 'version', label: 'Versione', cls: 'mono' }, { label: '', sort: false, render: (x) => btn('Installa', () => {
            if (App.softwareJob && !App.softwareJob.finished) { UI.toast('Attendi la fine dell\'operazione in corso', 'warn'); return; }
            startJob([{ id: x.id, name: x.name, to: x.version }], 'install');
            showJob();
          }, 'primary sm') }], list));
        }
      }

      if (App.softwareJob) showJob();
      else if (data) { drawTabs(); render(); } else scan();
      return () => { if (App.softwareJob) App.softwareJob.onChange = null; };
    }
  };

  /** Starts an update/install job in the backend; state lives in App.softwareJob so it survives navigation. */
  function startJob(items, mode) {
    const job = App.softwareJob = { mode, items: items.map((i) => Object.assign({ phase: 'queued' }, i)), overall: 0, finished: false, onChange: null };
    const fire = () => { if (job.onChange) job.onChange(); };
    const off = UI.onProgress((p) => {
      if (p.mod !== 'software' || (p.fn !== 'update' && p.fn !== 'install')) return;
      const it = job.items.find((i) => i.id === p.id);
      if (!it) return;
      for (const k of ['phase', 'percent', 'received', 'total', 'speed', 'file', 'part', 'message']) if (p[k] !== undefined) it[k] = p[k];
      if (p.phase === 'prepare' || p.phase === 'install') it.percent = p.percent;
      job.overall = mode === 'install' ? (it.phase === 'download' ? Math.round((it.percent || 0) * 0.7) : it.phase === 'install' || it.phase === 'verify' ? 80 : job.overall) : (p.overall != null ? p.overall : job.overall);
      fire();
    });
    const call = mode === 'install' ? api.call('software', 'install', { id: items[0].id }) : api.call('software', 'update', { ids: items.map((i) => i.id), includeUnknown: true });
    call.then((r) => {
      const results = mode === 'install' ? [Object.assign({ id: items[0].id }, r)] : r.results;
      for (const res of results) {
        const it = job.items.find((i) => i.id === res.id);
        if (!it) continue;
        it.phase = res.cancelled ? 'cancelled' : res.ok ? 'done' : 'error';
        it.message = res.message; it.log = res.log;
      }
      const ok = job.items.filter((i) => i.phase === 'done').length;
      UI.toast(mode === 'install' ? (ok ? `${items[0].name} installato` : `Installazione di ${items[0].name} non riuscita`) : `${ok} di ${items.length} programmi aggiornati`, ok === items.length ? 'ok' : 'warn');
      if (mode === 'update' && App.cache.software) {
        const doneIds = new Set(job.items.filter((i) => i.phase === 'done').map((i) => i.id));
        App.cache.software.items = App.cache.software.items.filter((i) => !doneIds.has(i.id));
        App.setBadge('software', App.cache.software.items.filter((i) => !i.ignored).length, true);
      }
    }).catch((e) => {
      job.items.forEach((i) => { if (!['done', 'error', 'cancelled'].includes(i.phase)) { i.phase = 'error'; i.message = UI.cleanErr(e); } });
      UI.toast(UI.cleanErr(e), 'err', 7000);
    }).finally(() => { job.finished = true; job.overall = 100; off(); fire(); });
  }
})();
