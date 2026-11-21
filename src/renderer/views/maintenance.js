(function () {
  const { h, bytes, num, btn } = UI;

  UI.Views.maintenance = {
    render(root, params) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Manutenzione', 'Analizza e pulisce in un solo clic file inutili, dati del browser, collegamenti interrotti e problemi del registro.', btn('Personalizza', () => App.go('settings', { tab: 'maintenance' }), 'ghost', 'gear')));
      root.appendChild(body);

      async function start() {
        body.innerHTML = '';
        const p = UI.busyPanel('Analisi del PC in corso…');
        body.appendChild(p);
        let s;
        try { s = await UI.run('maintenance', 'scan', {}, p); } catch (e) { body.innerHTML = ''; body.appendChild(intro()); return; }
        showResults(s);
      }

      function rowItem(icon, cls, title, desc, value, go) {
        return h('div', { class: 'item' }, h('div', { class: 'card-ic ' + cls, style: { margin: 0 }, html: Icons.get(icon) }),
          h('div', { class: 'grow' }, h('div', { class: 't' }, title), h('div', { class: 'd' }, desc)),
          h('div', { class: 'v' }, value), go ? h('button', { class: 'btn ghost sm', onclick: () => App.go(go) }, 'Dettagli') : null);
      }

      function showResults(s) {
        body.innerHTML = '';
        const totalSize = (s.junk ? s.junk.size : 0) + (s.browser ? s.browser.size : 0);
        const totalItems = (s.junk ? s.junk.count : 0) + (s.browser ? s.browser.count : 0) + (s.shortcuts ? s.shortcuts.count : 0) + (s.registry ? s.registry.count : 0);
        body.appendChild(h('div', { class: 'hero' },
          h('div', { style: { position: 'relative', zIndex: 1, flex: 1 } },
            h('h2', null, totalItems ? `Trovati ${num(totalItems)} elementi da pulire` : 'Il PC è già pulito!'),
            h('p', null, totalSize ? `Puoi liberare ${bytes(totalSize)} di spazio su disco.` : 'Non sono stati trovati file inutili.')),
          h('div', { style: { position: 'relative', zIndex: 1 } }, totalItems ? h('button', { class: 'btn white lg', onclick: clean }, 'Pulisci ora') : null)));
        const list = h('div', { class: 'list mt' });
        if (s.junk) list.appendChild(rowItem('broom', 'teal', 'File inutili di sistema e delle app', 'File temporanei, cache, log, dump di memoria, cestino', bytes(s.junk.size), 'junk'));
        if (s.browser) list.appendChild(rowItem('globe', '', 'Dati del browser', s.browser.running && s.browser.running.length ? `Chiudi ${s.browser.running.join(', ')} per una pulizia completa` : 'Cache e cronologia dei browser', bytes(s.browser.size), 'browser'));
        if (s.shortcuts) list.appendChild(rowItem('link', 'warn', 'Collegamenti interrotti', 'Collegamenti sul desktop e nel menu Start che non funzionano più', num(s.shortcuts.count), 'shortcuts'));
        if (s.registry) list.appendChild(rowItem('cube', 'violet', 'Problemi del registro', 'Voci non valide e riferimenti a file inesistenti', num(s.registry.count), 'registry'));
        body.appendChild(list);
        if (s.browser && s.browser.running && s.browser.running.length) {
          const cb = UI.checkbox(true, (v) => { closeBrowsers = v; });
          body.appendChild(h('label', { class: 'row mt' }, cb, h('span', null, `Chiudi automaticamente i browser aperti (${s.browser.running.join(', ')}) durante la pulizia`)));
        }
        body.appendChild(h('div', { class: 'notice mt', html: Icons.get('info') + '<div>Le modifiche al registro e ai collegamenti vengono salvate nel <b>Centro annullamento</b> e possono essere ripristinate in qualsiasi momento.</div>' }));
      }

      let closeBrowsers = true;
      async function clean() {
        body.innerHTML = '';
        const p = UI.busyPanel('Pulizia in corso…');
        body.appendChild(p);
        let r;
        try { r = await UI.run('maintenance', 'clean', { closeBrowsers }, p); } catch (e) { return start(); }
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'card', style: { textAlign: 'center', padding: '40px' } },
          h('div', { class: 'empty-ic', html: Icons.get('check') }),
          h('h2', null, 'Manutenzione completata!'),
          h('p', { class: 'stat-big' }, bytes(r.freed) + ' liberati'),
          h('p', { class: 'muted' }, `${num(r.junk || 0)} file inutili · ${num(r.browser || 0)} elementi del browser · ${num(r.shortcuts || 0)} collegamenti · ${num(r.registry || 0)} voci di registro`),
          h('div', { class: 'row mt', style: { justifyContent: 'center' } }, btn('Torna alla dashboard', () => App.go('dashboard'), 'ghost'), btn('Ripeti analisi', start))));
        UI.toast(`Manutenzione completata: liberati ${bytes(r.freed)}`);
      }

      function intro() {
        return h('div', { class: 'card', style: { textAlign: 'center', padding: '50px' } },
          h('div', { class: 'card-ic', style: { margin: '0 auto 14px', width: '64px', height: '64px' }, html: Icons.get('wand') }),
          h('h2', null, 'Manutenzione con un clic'),
          h('p', { class: 'muted' }, 'NovaTune analizza il PC alla ricerca di file inutili, dati del browser, collegamenti interrotti e problemi del registro.'),
          h('div', { class: 'mt' }, btn('Avvia analisi', start, 'primary lg')));
      }
      if (params.autostart) start(); else body.appendChild(intro());
    }
  };
})();
