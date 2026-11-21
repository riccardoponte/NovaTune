(function () {
  const { h, bytes, num, ago, ring, btn } = UI;

  UI.Views.dashboard = {
    render(root) {
      root.appendChild(UI.pageHeader('Dashboard', 'Stato generale del PC e accesso rapido a tutte le funzioni.'));
      const heroSlot = h('div');
      const sys = h('div', { class: 'card' }, h('h3', null, 'Il tuo PC'), h('p', { class: 'muted' }, 'Caricamento delle informazioni di sistema…'));
      const live = h('div', { class: 'grid g3 mt' });
      root.appendChild(heroSlot);
      root.appendChild(live);

      const tiles = [
        { id: 'maintenance', icon: 'wand', cls: '', t: 'Manutenzione', d: 'Pulisce file inutili, dati del browser, registro e collegamenti in un clic.' },
        { id: 'sleep', icon: 'moon', cls: 'violet', t: 'Modalità sospensione', d: 'Sospendi i programmi in background che rallentano il PC.' },
        { id: 'drivers', icon: 'chip', cls: 'teal', t: 'Driver Updater', d: 'Trova e installa driver aggiornati per i tuoi dispositivi.' },
        { id: 'programs', icon: 'apps', cls: 'warn', t: 'Uninstaller', d: 'Rimuovi programmi completamente, inclusi i residui.' },
        { id: 'software', icon: 'refresh', cls: '', t: 'Software Updater', d: 'Aggiorna le applicazioni installate alla versione più recente.' },
        { id: 'fixes', icon: 'shield', cls: 'ok', t: 'Risolvi problemi', d: 'Correggi impostazioni di Windows, sicurezza e privacy.' },
        { id: 'disks', icon: 'disk', cls: 'violet', t: 'Dischi', d: 'Deframmenta HDD, ottimizza SSD e controlla gli errori.' },
        { id: 'junk', icon: 'broom', cls: 'teal', t: 'Pulizia disco', d: 'Libera spazio eliminando file temporanei e cache.' },
        { id: 'shredder', icon: 'shred', cls: 'err', t: 'Distruggi dati', d: 'Elimina file in modo che non possano essere recuperati.' },
        { id: 'recovery', icon: 'lifebuoy', cls: 'ok', t: 'Recupero file', d: 'Recupera file eliminati per errore.' },
        { id: 'startup', icon: 'power', cls: 'warn', t: 'Avvio', d: 'Gestisci i programmi che partono con Windows.' },
        { id: 'undo', icon: 'undo', cls: '', t: 'Centro annullamento', d: 'Annulla qualsiasi modifica fatta da NovaTune.' }
      ];
      root.appendChild(h('h2', { class: 'mt2', style: { fontSize: '17px' } }, 'Strumenti'));
      root.appendChild(h('div', { class: 'grid g4' }, tiles.map((t) => h('div', { class: 'card click', onclick: () => App.go(t.id) },
        h('div', { class: 'card-ic ' + t.cls, html: Icons.get(t.icon) }), h('h3', null, t.t), h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, t.d)))));
      root.appendChild(h('div', { class: 'mt2' }, sys));

      // hero (maintenance status)
      (async () => {
        const st = await api.call('maintenance', 'status');
        const stats = await api.stats();
        const lastRun = st.lastRun;
        const days = lastRun ? Math.floor((Date.now() - new Date(lastRun.date)) / 86400000) : null;
        let score = 100;
        if (days == null) score = 55; else if (days > 30) score = 45; else if (days > 14) score = 65; else if (days > 7) score = 80; else score = 95;
        const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
        heroSlot.innerHTML = '';
        heroSlot.appendChild(h('div', { class: 'hero' },
          ring(score, String(score), 'Salute PC', color),
          h('div', { style: { flex: 1, position: 'relative', zIndex: 1 } },
            h('h2', null, score >= 80 ? 'Il PC è in ottima forma' : score >= 60 ? 'Il PC ha bisogno di una pulizia' : 'Il PC richiede manutenzione'),
            h('p', null, lastRun ? `Ultima manutenzione ${ago(lastRun.date)} · liberati ${bytes(lastRun.freed)}` : 'Non è ancora stata eseguita alcuna manutenzione.'),
            h('p', { style: { marginTop: '6px', fontSize: '13px' } }, `Spazio totale liberato: ${bytes(stats.spaceFreed)} · Problemi risolti: ${num(stats.problemsFixed + stats.registryItems)} · Driver aggiornati: ${num(stats.driversUpdated)}`),
            h('div', { class: 'row mt' }, h('button', { class: 'btn white lg', onclick: () => App.go('maintenance', { autostart: true }) }, 'Analizza ora'), h('button', { class: 'btn outline', onclick: () => App.go('settings', { tab: 'maintenance' }) }, 'Pianifica manutenzione')))));
      })();

      // system info + live resources
      let timer = null;
      (async () => {
        try {
          const i = App.cache.sysinfo || (App.cache.sysinfo = await api.call('system', 'info'));
          sys.innerHTML = '';
          sys.appendChild(h('div', { class: 'row between' }, h('h3', null, i.computer), h('span', { class: 'tag info' }, `${i.os} ${i.version || ''}`)));
          sys.appendChild(h('div', { class: 'kv mt' },
            h('div', null, 'Produttore / modello'), h('div', { class: 'sel' }, `${i.manufacturer} ${i.model}`),
            h('div', null, 'Processore'), h('div', { class: 'sel' }, `${i.cpu} (${i.cores} core, ${i.threads} thread)`),
            h('div', null, 'Memoria'), h('div', null, bytes(i.ram)),
            h('div', null, 'Grafica'), h('div', { class: 'sel' }, (i.gpu || []).join(', ')),
            h('div', null, 'Scheda madre / BIOS'), h('div', { class: 'sel' }, `${i.board} · ${i.bios}`),
            h('div', null, 'Windows'), h('div', { class: 'sel' }, `Build ${i.build} · ${i.arch} · installato il ${UI.date(i.installDate)}`),
            h('div', null, 'Ultimo avvio'), h('div', null, UI.date(i.lastBoot, true))));
          const diskPct = Math.round((1 - i.diskFree / i.diskSize) * 100);
          let prev = null;
          const cpuEl = h('div', { class: 'kpi' }, '…'); const cpuM = h('div', { class: 'meter mt' }, h('div', { style: { width: '0%' } }));
          const ramEl = h('div', { class: 'kpi' }, '…'); const ramM = h('div', { class: 'meter mt' }, h('div', { style: { width: '0%' } }));
          live.innerHTML = '';
          live.appendChild(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Processore'), h('span', { html: Icons.get('cpu') })), cpuEl, cpuM));
          live.appendChild(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Memoria in uso'), h('span', { html: Icons.get('activity') })), ramEl, ramM));
          live.appendChild(h('div', { class: 'card click', onclick: () => App.go('junk') }, h('div', { class: 'row between' }, h('span', { class: 'muted' }, `Unità ${i.sysDrive}`), h('span', { html: Icons.get('disk') })),
            h('div', { class: 'kpi' }, bytes(i.diskFree), h('small', null, `liberi su ${bytes(i.diskSize)}`)), h('div', { class: 'meter mt ' + (diskPct > 90 ? 'err' : diskPct > 80 ? 'warn' : '') }, h('div', { style: { width: diskPct + '%' } }))));
          const tick = async () => {
            const l = await api.call('system', 'live');
            if (prev) {
              let idle = 0, tot = 0;
              l.cpus.forEach((c, k) => { const p = prev[k]; const d = (x) => c[x] - p[x]; const t = d('user') + d('nice') + d('sys') + d('idle') + d('irq'); tot += t; idle += d('idle'); });
              const cpu = tot ? Math.round((1 - idle / tot) * 100) : 0;
              cpuEl.innerHTML = ''; cpuEl.append(cpu + '%', h('small', null, `${i.threads} thread`));
              cpuM.firstChild.style.width = cpu + '%';
            }
            prev = l.cpus;
            const used = l.ram - l.ramFree;
            ramEl.innerHTML = ''; ramEl.append(bytes(used), h('small', null, `di ${bytes(l.ram)}`));
            ramM.firstChild.style.width = Math.round((used / l.ram) * 100) + '%';
          };
          tick(); timer = setInterval(tick, 2000);
        } catch (e) { sys.innerHTML = ''; sys.append(h('p', { class: 'muted' }, 'Informazioni non disponibili: ' + UI.cleanErr(e))); }
      })();
      return () => clearInterval(timer);
    }
  };
})();
