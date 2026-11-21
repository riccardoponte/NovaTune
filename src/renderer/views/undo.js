(function () {
  const { h, btn } = UI;
  const TYPES = { registry: ['Registro', 'cube'], shortcuts: ['Collegamenti', 'link'], startup: ['Avvio', 'power'], 'startup-delete': ['Avvio', 'power'], sleep: ['Sospensione', 'moon'], fix: ['Risolvi problemi', 'shield'], 'fix-custom': ['Risolvi problemi', 'shield'], uninstall: ['Uninstaller', 'apps'], restorepoint: ['Punto di ripristino', 'backup'] };

  UI.Views.undo = {
    render(root) {
      let tab = 'actions';
      const tabsSlot = h('div'), body = h('div');
      root.appendChild(UI.pageHeader('Centro annullamento', 'NovaTune registra ogni modifica effettuata al sistema. Da qui puoi annullare le operazioni recenti o tornare a un punto di ripristino di Windows.'));
      root.appendChild(tabsSlot); root.appendChild(body);
      function drawTabs() { tabsSlot.innerHTML = ''; tabsSlot.appendChild(UI.tabs([{ id: 'actions', label: 'Modifiche di NovaTune' }, { id: 'restore', label: 'Punti di ripristino di Windows' }], tab, (t) => { tab = t; drawTabs(); tab === 'actions' ? actions() : restore(); })); }
      async function actions() {
        body.innerHTML = '';
        const list = await api.call('undo', 'list');
        const ret = App.settings.undoRetentionDays;
        body.appendChild(h('p', { class: 'muted mb' }, ret ? `I backup vengono conservati per ${ret} giorni (modificabile nelle Impostazioni).` : 'I backup non vengono mai eliminati.'));
        if (!list.length) { body.appendChild(UI.empty('undo', 'Nessuna operazione da annullare', 'Dopo aver usato NovaTune per un po\' di tempo, qui troverai un elenco di azioni che è possibile annullare.')); return; }
        body.appendChild(h('div', { class: 'list' }, list.map((e) => {
          const [t, ic] = TYPES[e.type] || ['Modifica', 'info'];
          return h('div', { class: 'item', style: e.undone ? { opacity: .55 } : null },
            h('div', { class: 'card-ic', style: { margin: 0, width: '36px', height: '36px' }, html: Icons.get(ic) }),
            h('div', { class: 'grow' }, h('div', { class: 't' }, e.title), h('div', { class: 'd' }, `${t} · ${UI.date(e.date, true)}`)),
            e.detail ? h('button', { class: 'btn ghost sm', onclick: () => UI.modal({ title: e.title, wide: true, body: h('pre', { class: 'log' }, e.detail) }) }, 'Dettagli') : null,
            e.type === 'restorepoint' ? btn('Ripristino configurazione', () => api.call('undo', 'openSystemRestore'), 'ghost sm') :
              e.undone ? h('span', { class: 'tag ok' }, 'Annullato') : btn('Annulla', async () => {
                if (!(await UI.confirmBox('Annullare questa modifica?', e.title, 'Annulla modifica'))) return;
                await UI.run('undo', 'restore', e.id);
                UI.toast(`"${e.title}" è stato annullato`);
                actions();
              }, 'primary sm'),
            h('button', { class: 'icon-btn', title: 'Elimina backup', html: Icons.get('trash'), onclick: async () => { await api.call('undo', 'remove', e.id); actions(); } }));
        })));
      }
      async function restore() {
        body.innerHTML = ''; body.appendChild(UI.busyPanel('Lettura dei punti di ripristino…'));
        const r = await api.call('undo', 'restorePoints').catch(() => ({ points: [] }));
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'row mb' }, btn('Crea punto di ripristino', async () => {
          const p = UI.busyPanel('Creazione del punto di ripristino…'); body.prepend(p);
          const res = await UI.run('undo', 'createRestorePoint', 'NovaTune - Punto di ripristino manuale').catch(() => null);
          p.remove();
          if (res && res.ok) UI.toast('Punto di ripristino creato'); else UI.toast('Impossibile creare il punto di ripristino: ' + (res && res.error || 'protezione del sistema disattivata?'), 'err', 8000);
          restore();
        }, 'primary', 'backup'), btn('Apri Ripristino configurazione di sistema', () => api.call('undo', 'openSystemRestore'), 'ghost')));
        const pts = (r.points || []).sort((a, b) => b.seq - a.seq);
        if (!pts.length) { body.appendChild(UI.empty('backup', 'Nessun punto di ripristino', 'La protezione del sistema potrebbe essere disattivata. Attivala dalla sezione Problemi di Windows.')); return; }
        body.appendChild(UI.table([{ key: 'seq', label: '#' }, { key: 'description', label: 'Descrizione' }, { key: 'date', label: 'Data', render: (p) => UI.date(p.date, true) }], pts, { sortKey: 'seq', sortDir: -1 }));
      }
      drawTabs(); actions();
    }
  };
})();
