(function () {
  const { h, bytes, num, btn } = UI;
  UI.Views.stats = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Statistiche', 'Ecco cosa ha fatto NovaTune per il tuo PC.', btn('Azzera statistiche', async () => { if (await UI.confirmBox('Azzerare le statistiche?', 'Tutti i contatori verranno riportati a zero.', 'Azzera', 'danger')) { await api.resetStats(); draw(); } }, 'ghost')));
      root.appendChild(body);
      async function draw() {
        const s = await api.stats();
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'hero mb' }, h('div', { style: { position: 'relative', zIndex: 1 } }, h('p', null, 'Spazio totale liberato'), h('div', { style: { fontSize: '40px', fontWeight: 800 } }, bytes(s.spaceFreed)), h('p', null, `${num(s.maintenanceRuns)} manutenzioni eseguite`))));
        const tiles = [
          ['broom', 'teal', 'File inutili eliminati', num(s.junkItems)], ['globe', '', 'Elementi del browser puliti', num(s.browserItems)], ['cube', 'violet', 'Problemi del registro risolti', num(s.registryItems)], ['link', 'warn', 'Collegamenti interrotti rimossi', num(s.shortcutsRemoved)],
          ['shield', 'ok', 'Problemi di Windows risolti', num(s.problemsFixed)], ['moon', 'violet', 'Programmi sospesi', num(s.programsSleeping)], ['disk', 'teal', 'Ottimizzazioni dei dischi', num(s.defragRuns)], ['chip', '', 'Driver aggiornati', num(s.driversUpdated)],
          ['apps', 'warn', 'Programmi disinstallati', num(s.programsUninstalled)], ['trash', 'err', 'Residui rimossi', num(s.leftoversRemoved)], ['refresh', 'ok', 'Programmi aggiornati', num(s.programsUpdated)], ['shred', 'err', 'File distrutti', num(s.filesShredded)], ['lifebuoy', 'ok', 'File recuperati', num(s.filesRecovered)]
        ];
        body.appendChild(h('div', { class: 'grid g4' }, tiles.map(([ic, cls, t, v]) => h('div', { class: 'card' }, h('div', { class: 'card-ic ' + cls, html: Icons.get(ic) }), h('div', { class: 'kpi' }, v), h('div', { class: 'muted' }, t)))));
        // last 12 weeks of freed space
        const weeks = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) { const start = new Date(now.getTime() - (i + 1) * 7 * 86400000), end = new Date(now.getTime() - i * 7 * 86400000); weeks.push({ start, end, bytes: 0, items: 0 }); }
        for (const e of s.history || []) { const d = new Date(e.date); const w = weeks.find((x) => d > x.start && d <= x.end); if (w) { w.bytes += e.bytes || 0; w.items += e.items || 0; } }
        const max = Math.max(1, ...weeks.map((w) => w.bytes));
        body.appendChild(h('div', { class: 'card mt' }, h('h3', null, 'Spazio liberato nelle ultime 12 settimane'),
          h('div', { class: 'chart' }, weeks.map((w) => h('div', { class: 'bcol', title: `${bytes(w.bytes)} · ${num(w.items)} elementi` }, h('div', { class: 'b', style: { height: Math.round((w.bytes / max) * 110) + 'px' } }), h('div', { class: 'bl' }, w.end.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })))))));
        const hist = (s.history || []).slice(-25).reverse();
        if (hist.length) {
          const names = { junk: 'Pulizia disco', browser: 'Pulizia browser', registry: 'Pulizia registro', shortcuts: 'Collegamenti', sleep: 'Modalità sospensione', fixes: 'Risolvi problemi', defrag: 'Ottimizzazione disco', drivers: 'Driver Updater', software: 'Software Updater', uninstall: 'Disinstallazione', shredder: 'Distruggi dati', recovery: 'Recupero file', files: 'File grandi/duplicati' };
          body.appendChild(h('div', { class: 'list mt' }, h('div', { class: 'list-head' }, 'Attività recenti'), hist.map((e) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, names[e.type] || e.type, e.name ? ': ' + e.name : ''), h('div', { class: 'd' }, UI.date(e.date, true))), h('div', { class: 'v' }, (e.bytes ? bytes(e.bytes) + ' · ' : '') + num(e.items) + ' elementi')))));
        }
      }
      draw();
    }
  };
})();
