(function () {
  const { h, bytes, num, btn, checkbox } = UI;

  // ---------------- Data shredder ----------------
  UI.Views.shredder = {
    render(root, params) {
      const items = App.cache.shredItems || (App.cache.shredItems = []);
      (params.add || []).forEach((p) => { if (!items.includes(p)) items.push(p); });
      let algo = App.settings.shredAlgorithm || 'dod';
      const body = h('div');
      root.appendChild(UI.pageHeader('Distruggi dati', 'Elimina file e cartelle in modo permanente sovrascrivendone il contenuto: nessun programma di recupero potrà ripristinarli.'));
      root.appendChild(body);
      function render() {
        body.innerHTML = '';
        const drop = h('div', { class: 'drop', ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
          ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); for (const f of e.dataTransfer.files) { const p = api.filePath(f); if (p && !items.includes(p)) items.push(p); } render(); } },
          h('div', { html: Icons.get('shred'), style: { marginBottom: '8px' } }), h('div', null, 'Trascina qui file e cartelle da distruggere'),
          h('div', { class: 'row mt', style: { justifyContent: 'center' } }, btn('Aggiungi file…', async () => { const r = await api.openDialog({ properties: ['openFile', 'multiSelections'] }); r.forEach((p) => !items.includes(p) && items.push(p)); render(); }, 'ghost sm', 'file'), btn('Aggiungi cartella…', async () => { const r = await api.openDialog({ properties: ['openDirectory', 'multiSelections'] }); r.forEach((p) => !items.includes(p) && items.push(p)); render(); }, 'ghost sm', 'folder')));
        body.appendChild(drop);
        if (items.length) body.appendChild(h('div', { class: 'list mt' }, h('div', { class: 'list-head' }, 'Elementi da distruggere', h('span', { class: 'badge' }, items.length), h('span', { class: 'spacer' }), h('button', { class: 'btn ghost sm', onclick: () => { items.length = 0; render(); } }, 'Svuota elenco')),
          items.map((p, i) => h('div', { class: 'item' }, h('span', { html: Icons.get('file') }), h('div', { class: 'grow d mono sel', style: { color: 'var(--text)' } }, p), h('button', { class: 'icon-btn', html: Icons.get('x'), onclick: () => { items.splice(i, 1); render(); } })))));
        const algos = [['quick', 'Rapido', '1 passaggio con zeri'], ['random', 'Dati casuali', '1 passaggio casuale'], ['dod', 'DoD 5220.22-M', '3 passaggi · standard del Dipartimento della Difesa USA'], ['gutmann', 'Gutmann', '35 passaggi · massima sicurezza, molto lento']];
        body.appendChild(h('h3', { class: 'mt2' }, 'Metodo di distruzione'));
        body.appendChild(h('div', { class: 'radio-row mt' }, algos.map(([id, t, d]) => h('div', { class: 'radio-card' + (algo === id ? ' on' : ''), onclick: () => { algo = id; api.setSettings({ shredAlgorithm: id }).then((s) => { App.settings = s; }); render(); } }, h('b', null, t), h('span', { class: 'muted' }, d)))));
        body.appendChild(h('div', { class: 'notice warn mt', html: Icons.get('alert') + '<div>Sugli <b>SSD</b> e sulle chiavette USB il controller del disco può conservare copie dei dati in aree non accessibili: per questi dispositivi la cancellazione sicura è garantita al meglio dal comando TRIM (sezione Dischi) e dalla crittografia BitLocker.</div>' }));
        body.appendChild(h('div', { class: 'row mt' }, btn('Distruggi definitivamente', shred, 'danger lg', 'shred'), h('div', { class: 'spacer' }), btn('Cancella spazio libero di un\'unità…', wipeFree, 'ghost', 'disk')));
      }
      async function shred() {
        if (!items.length) { UI.toast('Aggiungi almeno un file o una cartella', 'warn'); return; }
        if (!(await UI.confirmBox('Distruggere definitivamente?', `${items.length} elementi verranno sovrascritti ed eliminati. L'operazione NON può essere annullata e i dati non potranno essere recuperati.`, 'Distruggi', 'danger'))) return;
        body.innerHTML = ''; const p = UI.busyPanel('Distruzione dei dati…'); body.appendChild(p);
        body.appendChild(h('div', { class: 'center' }, btn('Interrompi', () => api.call('shredder', 'cancel'), 'ghost sm')));
        const r = await UI.run('shredder', 'shred', { paths: items.slice(), algorithm: algo }, p).catch(() => null);
        body.innerHTML = '';
        if (!r) return render();
        items.length = 0;
        body.appendChild(UI.doneCard(r.cancelled ? 'Operazione interrotta' : `${num(r.shredded)} file distrutti`, `Metodo: ${r.algorithm}` + (r.failed.length ? ` · ${r.failed.length} file non distrutti (${r.failed[0].error})` : '')));
        body.appendChild(h('div', { class: 'row mt', style: { justifyContent: 'center' } }, btn('Distruggi altri file', render, 'ghost')));
      }
      async function wipeFree() {
        const drives = await api.call('recovery', 'drives');
        let letter = drives[0] && drives[0].letter, random = false;
        const ok = await new Promise((res) => UI.modal({ title: 'Cancella lo spazio libero', body: h('div', null,
          h('p', { class: 'muted' }, 'Sovrascrive lo spazio libero dell\'unità per rendere irrecuperabili i file eliminati in passato. L\'operazione può richiedere molto tempo e riempie temporaneamente il disco.'),
          h('select', { class: 'input', style: { width: '100%' }, onchange: (e) => { letter = e.target.value; } }, drives.map((d) => h('option', { value: d.letter }, `${d.letter}: ${d.label || ''} · ${bytes(d.free)} liberi`))),
          h('label', { class: 'row mt' }, UI.checkbox(false, (v) => { random = v; }), 'Usa dati casuali (più lento)')),
          onClose: () => res(false), actions: [{ label: 'Annulla', kind: 'ghost', onClick: () => res(false) }, { label: 'Avvia', kind: 'danger', onClick: () => res(true) }] }));
        if (!ok) return;
        body.innerHTML = ''; const p = UI.busyPanel(`Sovrascrittura dello spazio libero dell'unità ${letter}:…`); body.appendChild(p);
        body.appendChild(h('div', { class: 'center' }, btn('Interrompi', () => api.call('shredder', 'cancel'), 'ghost sm')));
        const r = await UI.run('shredder', 'wipeFreeSpace', { letter, random }, p).catch(() => null);
        body.innerHTML = '';
        body.appendChild(UI.doneCard(r && !r.cancelled ? 'Spazio libero cancellato' : 'Operazione interrotta', r ? `${bytes(r.written)} sovrascritti` : ''));
        body.appendChild(h('div', { class: 'row mt', style: { justifyContent: 'center' } }, btn('Indietro', render, 'ghost')));
      }
      render();
    }
  };

})();
