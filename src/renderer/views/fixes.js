(function () {
  const { h, num, btn } = UI;
  const GROUPS = { security: ['Sicurezza', 'shield', 'Rischi o problemi che possono esporre il PC ad attacchi o modifiche indesiderate.'], windows: ['Problemi di Windows', 'windows', 'Rischi o problemi relativi al funzionamento di Windows sul PC.'], privacy: ['Privacy', 'eyeoff', 'Impostazioni che potrebbero lasciare alcune informazioni visibili ad altri o condividerle con terze parti.'] };

  UI.Views.fixes = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Problemi di Windows', 'Controlla le impostazioni di Windows, della sicurezza e della privacy per assicurarti che il PC sia configurato correttamente.', btn('Ripeti scansione', () => scan(), 'ghost', 'refresh')));
      root.appendChild(body);
      let data;
      async function scan() {
        body.innerHTML = ''; const p = UI.busyPanel('Ricerca dei problemi…'); body.appendChild(p);
        try { data = await UI.run('fixes', 'scan', {}, p); } catch (e) { body.innerHTML = ''; return; }
        App.setBadge('fixes', data.problems);
        render();
      }
      function render() {
        body.innerHTML = '';
        const bad = data.items.filter((i) => i.bad && !i.ignored);
        body.appendChild(h('div', { class: 'hero mb' }, h('div', { style: { flex: 1, position: 'relative', zIndex: 1 } },
          h('h2', null, bad.length ? `${bad.length} ${bad.length === 1 ? 'problema trovato' : 'problemi trovati'}` : 'Nessun problema da risolvere!'),
          h('p', null, bad.length ? 'Risolvi i problemi per proteggere il PC. Ogni correzione può essere annullata dal Centro annullamento.' : 'Le impostazioni di Windows sono configurate correttamente.')),
          bad.filter((i) => !i.navigate).length ? h('button', { class: 'btn white lg', style: { position: 'relative', zIndex: 1 }, onclick: () => fix(bad.filter((i) => !i.navigate).map((i) => i.id)) }, 'Risolvi tutto') : null));
        for (const [g, [title, icon, desc]] of Object.entries(GROUPS)) {
          const items = data.items.filter((i) => i.group === g);
          const list = h('div', { class: 'list mb' }, h('div', { class: 'list-head' }, h('span', { html: Icons.get(icon) }), title, h('span', { class: 'muted', style: { fontWeight: 400, fontSize: '13px' } }, desc)));
          for (const i of items.sort((a, b) => (b.bad && !b.ignored) - (a.bad && !a.ignored))) {
            list.appendChild(h('div', { class: 'item' + (i.ignored ? ' dim' : ''), style: i.ignored ? { opacity: .55 } : null },
              h('div', { class: 'card-ic ' + (i.bad ? (i.optional ? 'warn' : 'err') : 'ok'), style: { margin: 0, width: '34px', height: '34px' }, html: Icons.get(i.bad ? 'alert' : 'check') }),
              h('div', { class: 'grow' }, h('div', { class: 't' }, i.text), h('div', { class: 'd' }, i.bad ? i.tip : i.title + (i.info ? ' · ' + i.info : '')), i.bad && i.info ? h('div', { class: 'd faint' }, i.info) : null),
              i.bad && i.reboot ? h('span', { class: 'tag' }, 'riavvio') : null,
              i.bad && i.optional ? h('span', { class: 'tag' }, 'consigliato') : null,
              i.bad ? h('button', { class: 'btn ghost sm', onclick: async () => { await UI.ignore('fixes', i.id, !i.ignored); i.ignored = !i.ignored; App.setBadge('fixes', data.items.filter((x) => x.bad && !x.ignored).length); render(); } }, i.ignored ? 'Non ignorare' : 'Ignora') : null,
              i.bad && !i.ignored ? (i.navigate ? btn('Libera spazio', () => App.go(i.navigate), 'primary sm') : btn('Risolvi', () => fix([i.id]), 'primary sm')) : null));
          }
          body.appendChild(list);
        }
      }
      async function fix(ids) {
        const r = await UI.run('fixes', 'fix', { ids });
        if (r.errors.length) UI.toast(`${r.fixed} risolti, ${r.errors.length} non riusciti: ${r.errors[0].error}`, 'warn', 8000);
        else UI.toast(`${r.fixed} ${r.fixed === 1 ? 'problema risolto' : 'problemi risolti'}`);
        if (data.items.some((i) => ids.includes(i.id) && i.reboot)) UI.toast('Alcune modifiche avranno effetto dopo il riavvio del PC.', 'warn', 8000);
        scan();
      }
      scan();
    }
  };
})();
