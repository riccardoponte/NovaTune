// App shell: navigation + router
(function () {
  const { h } = UI;
  const NAV = [
    { group: null, items: [{ id: 'dashboard', label: 'Dashboard', icon: 'home' }, { id: 'maintenance', label: 'Manutenzione', icon: 'wand' }] },
    { group: 'Velocizza', items: [{ id: 'sleep', label: 'Modalità sospensione', icon: 'moon' }, { id: 'startup', label: 'Programmi all\'avvio', icon: 'power' }, { id: 'processes', label: 'Processi attivi', icon: 'activity' }, { id: 'disks', label: 'Ottimizzazione dischi', icon: 'disk' }] },
    { group: 'Libera spazio', items: [{ id: 'junk', label: 'Pulizia disco', icon: 'broom' }, { id: 'browser', label: 'Dati del browser', icon: 'globe' }, { id: 'largefiles', label: 'File di grandi dimensioni', icon: 'file' }] },
    { group: 'Risolvi problemi', items: [{ id: 'fixes', label: 'Problemi di Windows', icon: 'shield' }, { id: 'registry', label: 'Pulizia del registro', icon: 'cube' }, { id: 'shortcuts', label: 'Collegamenti interrotti', icon: 'link' }] },
    { group: 'Driver Updater', items: [{ id: 'drivers', label: 'Aggiornamento driver', icon: 'chip' }, { id: 'driverBackup', label: 'Backup e ripristino driver', icon: 'backup' }] },
    { group: 'Uninstaller', items: [{ id: 'programs', label: 'Programmi', icon: 'apps' }, { id: 'storeapps', label: 'App di Windows', icon: 'windows' }, { id: 'extensions', label: 'Estensioni del browser', icon: 'puzzle' }, { id: 'forced', label: 'Disinstallazione forzata', icon: 'hammer' }, { id: 'software', label: 'Software Updater', icon: 'refresh' }] },
    { group: 'Strumenti', items: [{ id: 'shredder', label: 'Distruggi dati', icon: 'shred' }, { id: 'recovery', label: 'Recupero file', icon: 'lifebuoy' }, { id: 'repair', label: 'Riparazione file', icon: 'bandage' }] },
    { group: 'Altro', items: [{ id: 'undo', label: 'Centro annullamento', icon: 'undo' }, { id: 'stats', label: 'Statistiche', icon: 'chart' }, { id: 'settings', label: 'Impostazioni', icon: 'gear' }] }
  ];

  const App = window.App = { current: null, settings: null, badges: {}, cache: {}, cleanup: null };

  function renderNav() {
    const sb = document.getElementById('sidebar');
    sb.innerHTML = '';
    for (const g of NAV) {
      const grp = h('div', { class: 'nav-group' }, g.group ? h('div', { class: 'nav-group-title' }, g.group) : null,
        g.items.map((it) => h('div', { class: 'nav-item' + (App.current === it.id ? ' active' : ''), 'data-id': it.id, onclick: () => App.go(it.id) },
          h('span', { html: Icons.get(it.icon) }), h('span', null, it.label),
          App.badges[it.id] ? h('span', { class: 'nb' + (App.badges[it.id].info ? ' info' : '') }, App.badges[it.id].n) : null)));
      sb.appendChild(grp);
    }
  }

  App.setBadge = (id, n, info) => { if (n) App.badges[id] = { n, info }; else delete App.badges[id]; renderNav(); };

  App.go = (id, params) => {
    const V = UI.Views[id];
    if (!V) return;
    if (App.cleanup) { try { App.cleanup(); } catch (e) {} App.cleanup = null; }
    App.current = id;
    renderNav();
    const view = document.getElementById('view');
    view.innerHTML = '';
    view.scrollTop = 0;
    const r = V.render(view, params || {});
    if (typeof r === 'function') App.cleanup = r;
  };

  App.applyTheme = (t) => {
    const theme = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
    document.documentElement.dataset.theme = theme;
  };

  async function init() {
    document.getElementById('tbMin').onclick = () => api.win.minimize();
    const tbMax = document.getElementById('tbMax');
    tbMax.onclick = () => api.win.maximize();
    const setMaxIcon = (state) => {
      const max = state === 'max';
      tbMax.title = max ? 'Ripristina' : 'Ingrandisci';
      tbMax.innerHTML = max
        ? '<svg viewBox="0 0 12 12"><rect x="2.5" y="4" width="5.5" height="5.5" /><path d="M4.5 4V2.5H9.5V7.5H8" /></svg>'
        : '<svg viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" /></svg>';
    };
    api.on('win-state', setMaxIcon);    document.getElementById('tbClose').onclick = () => api.win.close();
    App.settings = await api.settings();
    App.applyTheme(App.settings.theme);
    App.info = await api.appInfo();
    api.isAdmin().then((a) => {
      const b = document.getElementById('adminBadge');
      App.isAdmin = a;
      b.textContent = a ? 'Amministratore' : 'Privilegi limitati – alcune funzioni richiedono l\'esecuzione come amministratore';
      b.className = 'tb-admin' + (a ? '' : ' warn');
    });
    api.on('navigate', (id) => App.go(id));
    api.on('shred-add', (paths) => App.go('shredder', { add: paths }));
    if (App.info.shred && App.info.shred.length) App.go('shredder', { add: App.info.shred });
    else App.go(App.info.initialPage || 'dashboard');
  }
  window.addEventListener('DOMContentLoaded', init);
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
})();
