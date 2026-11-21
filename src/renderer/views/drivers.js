(function () {
  const { h, bytes, num, btn, checkbox } = UI;
  const CLS = { DISPLAY: 'Schede video', MEDIA: 'Audio', NET: 'Rete', BLUETOOTH: 'Bluetooth', USB: 'USB', HIDCLASS: 'Dispositivi di input', SYSTEM: 'Sistema', HDC: 'Controller di archiviazione', SCSIADAPTER: 'Controller di archiviazione', DISKDRIVE: 'Unità disco', MONITOR: 'Monitor', PRINTER: 'Stampanti', CAMERA: 'Fotocamere', IMAGE: 'Imaging', KEYBOARD: 'Tastiere', MOUSE: 'Mouse', BATTERY: 'Batterie', PROCESSOR: 'Processori', BIOMETRIC: 'Biometria', FIRMWARE: 'Firmware', SOFTWARECOMPONENT: 'Componenti software', EXTENSION: 'Estensioni', AUDIOENDPOINT: 'Endpoint audio', SECURITYDEVICES: 'Sicurezza' };

  UI.Views.drivers = {
    render(root) {
      let tab = 'updates';
      const tabsSlot = h('div'), body = h('div');
      root.appendChild(UI.pageHeader('Driver Updater', 'Analizza i dispositivi del PC, trova i driver obsoleti o mancanti nel catalogo ufficiale Windows Update e li installa in modo sicuro, con backup e punto di ripristino.', btn('Analizza driver', () => scan(), 'primary', 'search')));
      root.appendChild(tabsSlot); root.appendChild(body);
      let data = App.cache.drivers || null;
      function drawTabs() {
        tabsSlot.innerHTML = '';
        if (!data) return;
        tabsSlot.appendChild(UI.tabs([
          { id: 'updates', label: 'Aggiornamenti disponibili', badge: data.updates.filter((u) => !u.ignored).length || null },
          { id: 'problems', label: 'Dispositivi con problemi', badge: data.problems.length || null },
          { id: 'all', label: 'Tutti i driver', badge: data.drivers.length },
          { id: 'ignored', label: 'Ignorati', badge: data.updates.filter((u) => u.ignored).length || null }
        ], tab, (t) => { tab = t; drawTabs(); render(); }));
      }
      async function scan() {
        tabsSlot.innerHTML = ''; body.innerHTML = '';
        const p = UI.busyPanel('Analisi dei driver…'); body.appendChild(p);
        try { data = await UI.run('drivers', 'scan', {}, p); } catch (e) { body.innerHTML = ''; intro(); return; }
        App.cache.drivers = data;
        data.updates.forEach((u) => { u.sel = !u.ignored; });
        App.setBadge('drivers', data.updates.filter((u) => !u.ignored).length);
        drawTabs(); render();
      }
      function intro() {
        body.appendChild(h('div', { class: 'card', style: { textAlign: 'center', padding: '50px' } },
          h('div', { class: 'card-ic teal', style: { margin: '0 auto 14px', width: '64px', height: '64px' }, html: Icons.get('chip') }),
          h('h2', null, 'Mantieni aggiornati i driver'), h('p', { class: 'muted' }, 'I driver aggiornati migliorano prestazioni, stabilità e compatibilità di schede video, audio, rete, Bluetooth, chipset e periferiche.'),
          h('div', { class: 'mt' }, btn('Analizza driver', scan, 'primary lg'))));
      }
      function render() {
        body.innerHTML = '';
        if (data.wuError) body.appendChild(h('div', { class: 'notice warn mb', html: Icons.get('alert') + `<div>Impossibile contattare Windows Update: ${data.wuError}. Verifica la connessione a Internet e che il servizio Windows Update sia attivo.</div>` }));
        if (tab === 'updates' || tab === 'ignored') {
          const rows = data.updates.filter((u) => (tab === 'ignored') === !!u.ignored);
          if (!rows.length) { body.appendChild(UI.empty('check', tab === 'ignored' ? 'Nessun driver ignorato' : 'Tutti i driver sono aggiornati', tab === 'ignored' ? '' : `Ultima analisi: ${UI.date(data.lastScan, true)}`)); return; }
          body.appendChild(UI.table([
            tab === 'updates' ? { label: '', sort: false, width: '36px', render: (u) => checkbox(u.sel, (v) => { u.sel = v; }) } : null,
            { key: 'device', label: 'Dispositivo', render: (u) => h('div', { class: 'prog-cell' }, h('div', { class: 'ph', html: Icons.get('chip') }), h('div', { style: { minWidth: 0 } }, h('div', { class: 'nm' }, u.device || u.model), h('div', { class: 'sb' }, `${u.manufacturer || u.provider} · ${CLS[(u.cls || '').toUpperCase()] || u.cls || ''}`))) },
            { key: 'currentVersion', label: 'Versione attuale', cls: 'nowrap', render: (u) => u.missing ? h('span', { class: 'tag err' }, 'Driver mancante') : h('div', null, h('div', null, u.currentVersion || '—'), h('div', { class: 'faint' }, UI.date(u.currentDate))) },
            { key: 'newVersion', label: 'Nuova versione', cls: 'nowrap', render: (u) => h('div', null, h('div', { style: { color: 'var(--ok)', fontWeight: 600 } }, u.newVersion || 'Disponibile'), h('div', { class: 'faint' }, UI.date(u.date))) },
            { key: 'size', label: 'Dimensione', cls: 'nowrap', render: (u) => (u.size ? bytes(u.size) : '—') },
            { label: '', sort: false, render: (u) => h('div', { class: 'row' }, tab === 'updates' ? btn('Aggiorna', () => install([u.id]), 'primary sm') : null, h('button', { class: 'btn ghost sm', onclick: async () => { await UI.ignore('drivers', u.id, !u.ignored); u.ignored = !u.ignored; u.sel = !u.ignored; drawTabs(); render(); } }, u.ignored ? 'Ripristina' : 'Ignora'), h('button', { class: 'icon-btn', html: Icons.get('info'), title: 'Dettagli', onclick: () => UI.modal({ title: u.title, body: h('div', null, h('p', { class: 'muted sel' }, u.description), h('div', { class: 'kv' }, h('div', null, 'Produttore'), h('div', null, u.manufacturer), h('div', null, 'Fornitore'), h('div', null, u.provider), h('div', null, 'ID hardware'), h('div', { class: 'mono sel' }, u.hwid), h('div', null, 'Riavvio'), h('div', null, u.reboot ? 'Potrebbe essere necessario' : 'Non necessario'))) }) })) }
          ].filter(Boolean), rows));
          if (tab === 'updates') body.appendChild(h('div', { class: 'sticky-foot' }, h('span', { class: 'muted' }, 'Prima dell\'installazione vengono creati un punto di ripristino e un backup dei driver.'), h('div', { class: 'spacer' }), btn('Aggiorna selezionati', () => install(rows.filter((u) => u.sel).map((u) => u.id)), 'primary lg', 'download')));
        } else if (tab === 'problems') {
          if (!data.problems.length) { body.appendChild(UI.empty('check', 'Nessun dispositivo con problemi', 'Tutti i dispositivi funzionano correttamente.')); return; }
          body.appendChild(h('div', { class: 'list' }, data.problems.map((p) => h('div', { class: 'item' }, h('div', { class: 'card-ic err', style: { margin: 0, width: '34px', height: '34px' }, html: Icons.get('alert') }),
            h('div', { class: 'grow' }, h('div', { class: 't' }, p.name), h('div', { class: 'd' }, p.reason), h('div', { class: 'd mono faint sel' }, p.deviceId)),
            p.hasUpdate ? h('span', { class: 'tag ok' }, 'driver disponibile') : h('span', { class: 'tag' }, 'nessun driver nel catalogo')))));
          body.appendChild(h('div', { class: 'row mt' }, btn('Ricerca modifiche hardware', async () => { await UI.run('drivers', 'rescanDevices'); UI.toast('Ricerca dispositivi completata'); scan(); }, 'ghost', 'refresh'), btn('Apri Gestione dispositivi', () => api.open('devmgmt.msc'), 'ghost')));
        } else {
          let q = '';
          const slot = h('div');
          body.appendChild(h('div', { class: 'row mb' }, UI.search('Cerca dispositivo, produttore, versione…', (v) => { q = v; draw(); }), h('label', { class: 'row muted' }, UI.checkbox(onlyThird, (v) => { onlyThird = v; draw(); }), 'Solo driver di terze parti')));
          body.appendChild(slot);
          function draw() {
            slot.innerHTML = '';
            slot.appendChild(UI.table([
              { key: 'name', label: 'Dispositivo', render: (d) => h('div', null, h('div', { class: 't' }, d.name), h('div', { class: 'faint' }, CLS[(d.cls || '').toUpperCase()] || d.cls)) },
              { key: 'provider', label: 'Fornitore', cls: 'nowrap' },
              { key: 'version', label: 'Versione', cls: 'nowrap mono' },
              { key: 'date', label: 'Data', cls: 'nowrap', render: (d) => h('span', { class: d.ageYears >= 3 ? 'tag warn' : '' }, UI.date(d.date)) },
              { key: 'inf', label: 'INF', cls: 'nowrap mono' },
              { label: '', sort: false, render: (d) => d.thirdParty ? h('button', { class: 'icon-btn', title: 'Backup di questo driver', html: Icons.get('backup'), onclick: async () => { const r = await UI.run('drivers', 'backup', { inf: d.inf, label: d.name.slice(0, 40) }); UI.toast(r.ok ? 'Backup salvato in ' + r.dir : 'Backup non riuscito', r.ok ? 'ok' : 'err', 7000); } }) : null }
            ], data.drivers.filter((d) => (!onlyThird || d.thirdParty) && (!q || (d.name + d.provider + d.version + d.manufacturer).toLowerCase().includes(q))), { sortKey: 'name' }));
          }
          draw();
        }
      }
      let onlyThird = true;
      function install(ids) {
        if (!ids.length) return;
        if (!App.isAdmin) { UI.toast('L\'installazione dei driver richiede l\'esecuzione come amministratore.', 'err'); return; }
        if (App.driverJob && !App.driverJob.finished) { showJob(); return; }
        startDriverJob(ids.map((id) => { const u = data.updates.find((x) => x.id === id) || {}; return { id, name: u.device || u.model || u.title, from: u.currentVersion, to: u.newVersion, size: u.size }; }));
        showJob();
      }

      function showJob() {
        const job = App.driverJob;
        tabsSlot.innerHTML = ''; body.innerHTML = '';
        const overallBar = h('div', { class: 'bar-fill' });
        const overallLbl = h('div', { class: 'muted' });
        const cancelBtn = btn('Annulla', async () => {
          if (!(await UI.confirmBox('Annullare l\'aggiornamento dei driver?', 'Il download in corso verrà interrotto e i driver in coda non verranno installati. Un driver già in fase di installazione verrà completato.', 'Annulla aggiornamento', 'danger'))) return;
          api.call('drivers', 'cancel');
        }, 'ghost', 'stop');
        const doneSlot = h('div');
        body.appendChild(h('div', { class: 'card mb' },
          h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, 'Aggiornamento dei driver'), cancelBtn),
          h('div', { class: 'bar mt', style: { width: '100%', maxWidth: 'none' } }, overallBar), h('div', { class: 'row between mt' }, overallLbl), doneSlot));
        const list = h('div', { class: 'list' });
        const rows = job.items.map((it) => { const r = driverRow(it); list.appendChild(r); return r; });
        body.appendChild(list);
        const paint = () => {
          rows.forEach((r) => r.paint());
          overallBar.style.width = Math.max(2, job.overall) + '%';
          const cur = job.items.findIndex((i) => !['done', 'error', 'cancelled'].includes(i.phase));
          overallLbl.textContent = job.finished
            ? `Completato: ${job.items.filter((i) => i.phase === 'done').length} di ${job.items.length} driver aggiornati`
            : job.setup ? job.setup : `Driver ${Math.max(1, cur + 1)} di ${job.items.length} · ${job.overall}% complessivo`;
          cancelBtn.style.display = job.finished ? 'none' : '';
          if (job.finished && !doneSlot.childNodes.length) {
            if (job.reboot) doneSlot.appendChild(h('div', { class: 'notice warn mt', html: Icons.get('alert') + '<div>Riavvia il PC per completare l\'installazione dei driver.</div>' }));
            doneSlot.appendChild(h('div', { class: 'row mt' }, job.reboot ? btn('Riavvia ora', () => api.reboot(), 'primary') : null, btn('Analizza di nuovo', () => { App.driverJob = null; scan(); }, job.reboot ? 'ghost' : 'primary', 'refresh'), btn('Torna all\'elenco', () => { App.driverJob = null; drawTabs(); render(); }, 'ghost')));
          }
        };
        job.onChange = paint;
        paint();
      }

      function fmtTime(s) {
        if (!isFinite(s) || s < 1) return '';
        s = Math.round(s);
        return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
      }

      function driverRow(it) {
        const fill = h('div', { class: 'bar-fill' });
        const bar = h('div', { class: 'bar', style: { width: '100%', maxWidth: 'none', height: '6px' } }, fill);
        const status = h('div', { class: 'd' });
        const tag = h('span', { class: 'tag' });
        const el = h('div', { class: 'item', style: { alignItems: 'flex-start' } },
          h('div', { style: { width: '34px', height: '34px', borderRadius: '8px', background: 'var(--panel2)', display: 'grid', placeItems: 'center', flex: 'none' }, html: Icons.get('chip') }),
          h('div', { class: 'grow' },
            h('div', { class: 'row between' }, h('div', { class: 't' }, it.name, it.to ? h('span', { class: 'faint mono', style: { fontWeight: 400, fontSize: '12px', marginLeft: '8px' } }, `${it.from || ''} → ${it.to}`) : null), tag),
            h('div', { style: { margin: '8px 0 6px' } }, bar), status));
        el.paint = () => {
          const B = UI.bytes;
          const indet = it.phase === 'prepare' || (it.phase === 'install' && !it.percent);
          bar.classList.toggle('indet', indet);
          fill.style.background = it.phase === 'error' ? 'var(--err)' : it.phase === 'done' ? 'var(--ok)' : it.phase === 'cancelled' ? 'var(--faint)' : '';
          let pct = 0, txt = '', tg = ['In coda', ''];
          switch (it.phase) {
            case 'queued': txt = 'In attesa…'; break;
            case 'prepare': txt = it.message || 'Ricerca del driver…'; tg = ['Preparazione', 'info']; break;
            case 'download': {
              pct = it.percent || 0;
              const parts = ['Download'];
              if (it.total) parts.push(`${B(it.received || 0)} di ${B(it.total)}`);
              if (it.speed > 0) parts.push(`${B(it.speed)}/s`);
              if (it.speed > 0 && it.total && it.received < it.total) { const eta = fmtTime((it.total - it.received) / it.speed); if (eta) parts.push(`${eta} rimanenti`); }
              txt = parts.join(' · ');
              tg = [`Download ${pct}%`, 'info'];
              break;
            }
            case 'install': pct = it.percent || 0; txt = it.percent ? `Installazione del driver… ${it.percent}%` : 'Installazione del driver…'; tg = ['Installazione', 'violet']; break;
            case 'done': pct = 100; txt = it.message || 'Installato'; tg = ['Aggiornato', 'ok']; break;
            case 'error': pct = 100; txt = it.message || 'Non riuscito'; tg = ['Errore', 'err']; break;
            case 'cancelled': pct = 100; txt = 'Annullato'; tg = ['Annullato', '']; break;
          }
          fill.style.width = indet ? '' : Math.max(it.phase === 'queued' ? 0 : 2, pct) + '%';
          status.textContent = txt;
          tag.textContent = tg[0]; tag.className = 'tag ' + tg[1];
        };
        return el;
      }

      if (App.driverJob) showJob();
      else if (data) { drawTabs(); render(); } else intro();
      return () => { if (App.driverJob) App.driverJob.onChange = null; };
    }
  };

  /** Driver update job: state lives in App.driverJob so it survives navigation. */
  function startDriverJob(items) {
    const job = App.driverJob = { items: items.map((i) => Object.assign({ phase: 'queued' }, i)), overall: 0, finished: false, setup: 'Preparazione…', onChange: null };
    const fire = () => { if (job.onChange) job.onChange(); };
    const off = UI.onProgress((p) => {
      if (p.mod !== 'drivers' || p.fn !== 'install') return;
      if (p.phase === 'setup') { job.setup = p.label; job.overall = p.percent || job.overall; fire(); return; }
      job.setup = null;
      const it = job.items.find((i) => i.id === p.id);
      if (!it) return;
      if (p.phase === 'download') {
        const now = Date.now();
        if (it.phase !== 'download') { it.dlStart = now; it.dlStartBytes = p.received || 0; }
        const el = (now - it.dlStart) / 1000;
        it.speed = el > 0.8 ? ((p.received || 0) - it.dlStartBytes) / el : 0;
      }
      for (const k of ['phase', 'percent', 'received', 'total', 'message']) if (p[k] !== undefined) it[k] = p[k];
      if (p.overall != null) job.overall = p.overall;
      fire();
    });
    api.call('drivers', 'install', { ids: items.map((i) => i.id) }).then((r) => {
      for (const res of r.results) {
        const it = job.items.find((i) => i.id === res.id);
        if (!it) continue;
        it.phase = res.cancelled ? 'cancelled' : res.ok ? 'done' : 'error';
        if (!res.ok && !res.cancelled) it.message = res.error || `Installazione non riuscita (codice ${res.code})`;
        if (res.ok) it.message = res.reboot ? 'Installato · riavvio necessario' : 'Installato';
      }
      job.reboot = r.reboot;
      const ok = job.items.filter((i) => i.phase === 'done').length;
      UI.toast(`${ok} di ${items.length} driver aggiornati`, ok === items.length ? 'ok' : 'warn');
      if (App.cache.drivers) {
        const done = new Set(job.items.filter((i) => i.phase === 'done').map((i) => i.id));
        App.cache.drivers.updates = App.cache.drivers.updates.filter((u) => !done.has(u.id));
        App.setBadge('drivers', App.cache.drivers.updates.filter((u) => !u.ignored).length);
      }
    }).catch((e) => {
      job.items.forEach((i) => { if (!['done', 'error', 'cancelled'].includes(i.phase)) { i.phase = 'error'; i.message = UI.cleanErr(e); } });
      UI.toast(UI.cleanErr(e), 'err', 7000);
    }).finally(() => { job.finished = true; job.overall = 100; job.setup = null; off(); fire(); });
  }

  UI.Views.driverBackup = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Backup e ripristino driver', 'Salva una copia di tutti i driver di terze parti installati, per reinstallarli dopo un aggiornamento non riuscito o una reinstallazione di Windows.', btn('Crea backup completo', async () => {
        const p = UI.busyPanel('Backup dei driver in corso…'); body.prepend(p);
        const r = await UI.run('drivers', 'backup', {}, p).catch(() => null);
        p.remove();
        if (r) UI.toast(r.ok ? `Backup completato: ${r.count} driver salvati` : 'Backup non riuscito', r.ok ? 'ok' : 'err');
        load();
      }, 'primary', 'backup')));
      root.appendChild(body);
      async function load() {
        body.innerHTML = '';
        const list = await api.call('drivers', 'listBackups');
        if (!list.length) { body.appendChild(UI.empty('backup', 'Nessun backup', 'Crea un backup completo dei driver per poterli ripristinare in futuro.')); return; }
        body.appendChild(h('div', { class: 'list' }, list.map((b) => h('div', { class: 'item' }, h('div', { class: 'card-ic', style: { margin: 0 }, html: Icons.get('backup') }),
          h('div', { class: 'grow' }, h('div', { class: 't' }, b.name), h('div', { class: 'd' }, `${b.count} driver · ${UI.date(b.date, true)}`)),
          btn('Apri', () => api.open(b.dir), 'ghost sm', 'folder'),
          btn('Ripristina', async () => {
            if (!(await UI.confirmBox('Ripristinare i driver?', 'Tutti i driver del backup verranno reinstallati sui dispositivi compatibili.', 'Ripristina'))) return;
            const p = UI.busyPanel('Ripristino dei driver…'); body.prepend(p);
            const r = await UI.run('drivers', 'restore', { dir: b.dir }, p).catch(() => null);
            p.remove();
            if (r) UI.modal({ title: r.ok ? 'Ripristino completato' : 'Ripristino completato con avvisi', body: h('div', null, r.reboot ? h('p', null, 'Riavvia il PC per completare.') : null, h('pre', { class: 'log' }, r.log)) });
          }, 'primary sm'),
          h('button', { class: 'icon-btn', title: 'Elimina backup', html: Icons.get('trash'), onclick: async () => { if (await UI.confirmBox('Eliminare il backup?', b.name, 'Elimina', 'danger')) { await api.call('drivers', 'deleteBackup', { dir: b.dir }); load(); } } })))));
      }
      load();
    }
  };
})();
