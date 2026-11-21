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
      async function install(ids) {
        if (!ids.length) return;
        if (!App.isAdmin) { UI.toast('L\'installazione dei driver richiede l\'esecuzione come amministratore.', 'err'); return; }
        tabsSlot.innerHTML = ''; body.innerHTML = '';
        const p = UI.busyPanel(`Aggiornamento di ${ids.length} driver…`); body.appendChild(p);
        const r = await UI.run('drivers', 'install', { ids }, p).catch(() => null);
        body.innerHTML = '';
        if (!r) { drawTabs(); render(); return; }
        const ok = r.results.filter((x) => x.ok).length;
        body.appendChild(h('div', { class: 'card', style: { textAlign: 'center', padding: '36px' } },
          h('div', { class: 'empty-ic', html: Icons.get(ok === ids.length ? 'check' : 'alert') }),
          h('h2', null, `${ok} di ${ids.length} driver aggiornati`),
          r.results.filter((x) => !x.ok).map((x) => h('p', { class: 'muted' }, (data.updates.find((u) => u.id === x.id) || {}).device + ': ' + (x.error || 'installazione non riuscita (codice ' + x.code + ')'))),
          r.reboot ? h('div', { class: 'notice warn mt', html: Icons.get('alert') + '<div>Riavvia il PC per completare l\'installazione dei driver.</div>' }) : null,
          h('div', { class: 'row mt', style: { justifyContent: 'center' } }, r.reboot ? btn('Riavvia ora', () => api.reboot(), 'primary') : null, btn('Analizza di nuovo', scan, 'ghost'))));
      }
      if (data) { drawTabs(); render(); } else intro();
    }
  };

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
