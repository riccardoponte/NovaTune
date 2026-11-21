(function () {
  const { h, bytes, num, btn, checkbox } = UI;
  const KIND = { run: 'Avvio (registro)', folder: 'Avvio (menu Start)', task: 'Attività pianificata', service: 'Servizio' };
  const STATUS = { awake: ['Attivo', 'warn'], sleeping: ['Sospeso', 'ok'], 'awake-temp': ['Attivazione temporanea', 'info'], disabled: ['Disattivato', ''] };

  // ---------------- Sleep mode ----------------
  UI.Views.sleep = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Modalità sospensione', 'Sospendi i programmi che si avviano con Windows o restano in background (servizi, attività pianificate, avvio automatico) per liberare memoria e velocizzare il PC. Puoi riattivarli in qualsiasi momento.', btn('Ripeti scansione', () => scan(), 'ghost', 'refresh')));
      root.appendChild(body);
      let data, q = '';
      async function scan() {
        body.innerHTML = ''; const p = UI.busyPanel('Scansione dei programmi in background…'); body.appendChild(p);
        try { data = await UI.run('startup', 'listPrograms', {}, p); } catch (e) { body.innerHTML = ''; return; }
        App.setBadge('sleep', data.programs.filter((g) => g.status === 'awake' && g.impact === 'high').length);
        render();
      }
      function render() {
        body.innerHTML = '';
        const awake = data.programs.filter((g) => g.status === 'awake');
        const sleeping = data.programs.filter((g) => g.status === 'sleeping');
        body.appendChild(h('div', { class: 'grid g3 mb' },
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Programmi in background'), h('div', { class: 'kpi' }, num(awake.length))),
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Programmi sospesi'), h('div', { class: 'kpi', style: { color: 'var(--ok)' } }, num(sleeping.length))),
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Memoria usata dai programmi attivi'), h('div', { class: 'kpi' }, bytes(awake.reduce((a, g) => a + g.mem, 0))))));
        body.appendChild(h('div', { class: 'row mb' }, UI.search('Cerca un programma…', (v) => { q = v; draw(); }), h('div', { class: 'spacer' }),
          awake.length ? btn('Sospendi tutti quelli ad alto impatto', () => doSleep(awake.filter((g) => g.impact === 'high')), 'ghost', 'moon') : null));
        const tblSlot = h('div'); body.appendChild(tblSlot);
        function draw() {
          tblSlot.innerHTML = '';
          const rows = data.programs.filter((g) => !q || (g.name + g.company).toLowerCase().includes(q));
          tblSlot.appendChild(UI.table([
            { key: 'name', label: 'Programma', render: (g) => h('div', { class: 'prog-cell' }, h('div', { class: 'ph', html: Icons.get('box') }), h('div', { style: { minWidth: 0 } }, h('div', { class: 'nm' }, g.name), h('div', { class: 'sb' }, g.company || g.folder))) },
            { key: 'impact', label: 'Impatto', sortValue: (g) => ({ high: 0, medium: 1, low: 2, none: 3 }[g.impact]), render: (g) => UI.impactTag(g.impact) },
            { key: 'mem', label: 'Memoria', cls: 'nowrap', render: (g) => (g.mem ? bytes(g.mem) : '—') },
            { label: 'Componenti', sort: false, render: (g) => h('span', { class: 'muted', style: { fontSize: '12px' } }, Object.entries(g.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${KIND[k].toLowerCase()}`).join(', ')) },
            { key: 'status', label: 'Stato', render: (g) => { const [t, k] = STATUS[g.status] || ['—', '']; return h('span', { class: 'tag ' + k }, t); } },
            { label: '', sort: false, render: (g) => g.status === 'sleeping' || g.status === 'awake-temp' ? btn('Riattiva', () => doWake([g]), 'ghost sm') : btn('Sospendi', () => doSleep([g]), 'primary sm') },
            { label: '', sort: false, render: (g) => h('button', { class: 'icon-btn', title: 'Dettagli', html: Icons.get('info'), onclick: () => details(g) }) }
          ], rows, { sortKey: 'impact' }));
        }
        draw();
      }
      function details(g) {
        UI.modal({ title: g.name, wide: true, body: h('div', null, h('p', { class: 'muted' }, `${g.company || ''} · ${g.folder}`),
          h('div', { class: 'list' }, g.components.map((c) => h('div', { class: 'item' }, h('span', { class: 'tag' }, KIND[c.kind]), h('div', { class: 'grow' }, h('div', { class: 't' }, c.name), h('div', { class: 'd mono sel' }, c.command)), h('span', { class: 'tag ' + (c.enabled ? 'warn' : 'ok') }, c.enabled ? 'attivo' : 'disattivato'))))) });
      }
      async function doSleep(groups) {
        if (!groups.length) return;
        const kill = await UI.confirmBox('Sospendere ' + (groups.length > 1 ? groups.length + ' programmi' : groups[0].name) + '?', 'L\'avvio automatico, i servizi in background e le attività pianificate verranno disattivati e i processi in background verranno chiusi. Potrai sempre aprire il programma manualmente o riattivarlo da qui.', 'Sospendi');
        if (!kill) return;
        const r = await UI.run('startup', 'sleep', { programs: groups, killProcesses: true });
        UI.toast(`${r.slept} ${r.slept === 1 ? 'programma sospeso' : 'programmi sospesi'}`);
        scan();
      }
      async function doWake(groups) {
        const r = await UI.run('startup', 'wake', { keys: groups.map((g) => g.key) });
        UI.toast(`${r.woken} ${r.woken === 1 ? 'programma riattivato' : 'programmi riattivati'}`);
        scan();
      }
      scan();
    }
  };

  // ---------------- Startup ----------------
  UI.Views.startup = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Programmi all\'avvio', 'Gestisci i programmi che si avviano insieme a Windows. Disattivarli non li disinstalla: velocizza solo l\'avvio del PC.', btn('Aggiorna', () => load(), 'ghost', 'refresh')));
      root.appendChild(body);
      let items, q = '';
      async function load() {
        body.innerHTML = ''; const p = UI.busyPanel('Lettura degli elementi di avvio…'); body.appendChild(p);
        try { items = (await UI.run('startup', 'listStartup', {}, p)).items; } catch (e) { body.innerHTML = ''; return; }
        render();
      }
      function render() {
        body.innerHTML = '';
        const on = items.filter((i) => i.enabled).length;
        body.appendChild(h('div', { class: 'grid g3 mb' },
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Elementi di avvio'), h('div', { class: 'kpi' }, num(items.length))),
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Attivi'), h('div', { class: 'kpi', style: { color: 'var(--warn)' } }, num(on))),
          h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Disattivati'), h('div', { class: 'kpi', style: { color: 'var(--ok)' } }, num(items.length - on)))));
        body.appendChild(h('div', { class: 'row mb' }, UI.search('Cerca…', (v) => { q = v; draw(); })));
        const slot = h('div'); body.appendChild(slot);
        function draw() {
          slot.innerHTML = '';
          slot.appendChild(UI.table([
            { label: 'Attivo', sort: false, width: '70px', render: (i) => UI.toggle(i.enabled, async (v) => { await UI.run('startup', 'setStartup', { items: [Object.assign({}, i, { enable: v })] }); i.enabled = v; UI.toast(`${i.title}: avvio ${v ? 'attivato' : 'disattivato'}`); render(); }) },
            { key: 'title', label: 'Programma', render: (i) => h('div', { class: 'prog-cell' }, h('div', { class: 'ph', html: Icons.get('power') }), h('div', { style: { minWidth: 0 } }, h('div', { class: 'nm' }, i.title), h('div', { class: 'sb' }, i.company || i.name))) },
            { key: 'impact', label: 'Impatto', sortValue: (i) => ({ high: 0, medium: 1, low: 2, none: 3 }[i.impact]), render: (i) => UI.impactTag(i.impact) },
            { key: 'location', label: 'Posizione', cls: 'nowrap' },
            { key: 'command', label: 'Comando', cls: 'ellip mono', render: (i) => h('span', { title: i.command }, i.command) },
            { label: '', sort: false, render: (i) => i.kind === 'run' || i.kind === 'folder' ? h('button', { class: 'icon-btn', title: 'Elimina voce di avvio', html: Icons.get('trash'), onclick: async () => { if (!(await UI.confirmBox('Eliminare la voce di avvio?', `"${i.title}" verrà rimosso dall'avvio automatico. Un backup sarà salvato nel Centro annullamento.`, 'Elimina', 'danger'))) return; await UI.run('startup', 'deleteStartup', { item: i }); load(); } }) : null }
          ], items.filter((i) => !q || (i.title + i.command + i.company).toLowerCase().includes(q)), { sortKey: 'impact', rowClass: (i) => (i.enabled ? '' : 'dim') }));
        }
        draw();
      }
      load();
    }
  };

  // ---------------- Processes ----------------
  UI.Views.processes = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Processi attivi', 'Visualizza i processi in esecuzione, la memoria e la CPU che utilizzano, e termina quelli bloccati.', btn('Aggiorna', () => load(), 'ghost', 'refresh')));
      root.appendChild(body);
      let q = '', list = [];
      async function load() {
        if (!list.length) { body.innerHTML = ''; body.appendChild(UI.busyPanel('Lettura dei processi…')); }
        try { list = await api.call('startup', 'processes'); } catch (e) { return; }
        render();
      }
      function render() {
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'row mb' }, UI.search('Cerca un processo…', (v) => { q = v; draw(); }), h('span', { class: 'muted' }, `${num(list.length)} processi · ${bytes(list.reduce((a, p) => a + p.mem, 0))} di memoria`)));
        const slot = h('div'); body.appendChild(slot);
        function draw() {
          slot.innerHTML = '';
          slot.appendChild(UI.table([
            { key: 'name', label: 'Processo', render: (p) => h('div', null, h('div', { class: 't' }, p.desc || p.name), h('div', { class: 'faint mono' }, `${p.name}.exe · PID ${p.id}`)) },
            { key: 'cpu', label: 'CPU', cls: 'nowrap', render: (p) => p.cpu + '%' },
            { key: 'mem', label: 'Memoria', cls: 'nowrap', render: (p) => bytes(p.mem) },
            { key: 'path', label: 'Percorso', cls: 'ellip mono', render: (p) => h('span', { title: p.path || '' }, p.path || '—') },
            { label: '', sort: false, render: (p) => btn('Termina', async () => { if (!(await UI.confirmBox('Terminare il processo?', `${p.desc || p.name} (PID ${p.id}) verrà chiuso. I dati non salvati andranno persi.`, 'Termina', 'danger'))) return; const r = await UI.run('startup', 'killProcess', { pid: p.id }); UI.toast(r.ok ? 'Processo terminato' : 'Impossibile terminare il processo', r.ok ? 'ok' : 'err'); load(); }, 'ghost sm') }
          ], list.filter((p) => !q || (p.name + (p.desc || '') + (p.path || '')).toLowerCase().includes(q)), { sortKey: 'mem', sortDir: -1, limit: 400 }));
        }
        draw();
      }
      load();
    }
  };
})();
