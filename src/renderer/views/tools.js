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

  // ---------------- File recovery ----------------
  const TYPES = { all: 'Tutti', image: 'Immagini', document: 'Documenti', video: 'Video', music: 'Musica', archive: 'Archivi', other: 'Altro' };
  UI.Views.recovery = {
    render(root) {
      let tab = 'deep';
      const tabsSlot = h('div'), body = h('div');
      root.appendChild(UI.pageHeader('Recupero file', 'Recupera i file eliminati per errore, anche dopo aver svuotato il Cestino. Smetti di usare l\'unità il prima possibile per aumentare le probabilità di recupero.'));
      root.appendChild(tabsSlot); root.appendChild(body);
      let scanRes = App.cache.recovery || null;
      function drawTabs() { tabsSlot.innerHTML = ''; tabsSlot.appendChild(UI.tabs([{ id: 'deep', label: 'Scansione approfondita (NTFS)' }, { id: 'bin', label: 'Cestino' }], tab, (t) => { tab = t; drawTabs(); tab === 'bin' ? bin() : (scanRes ? results() : intro()); })); }
      async function intro() {
        body.innerHTML = '';
        const drives = await api.call('recovery', 'drives');
        body.appendChild(h('h3', null, 'Seleziona l\'unità in cui si trovavano i file'));
        body.appendChild(h('div', { class: 'grid g3 mt' }, drives.map((d) => h('div', { class: 'card click', onclick: () => d.fs === 'NTFS' ? scan(d.letter) : UI.toast('Il recupero approfondito supporta solo unità NTFS (questa è ' + d.fs + ')', 'warn') },
          h('div', { class: 'row' }, h('div', { class: 'card-ic ' + (d.removable ? 'warn' : 'teal'), style: { margin: 0 }, html: Icons.get(d.removable ? 'usb' : 'disk') }), h('div', null, h('h3', { style: { margin: 0 } }, `${d.label || 'Disco locale'} (${d.letter}:)`), h('div', { class: 'muted' }, `${d.fs || '—'} · ${bytes(d.free)} liberi di ${bytes(d.size)}`)))))));
        body.appendChild(h('div', { class: 'notice mt', html: Icons.get('info') + '<div>La scansione legge direttamente la Master File Table dell\'unità e richiede i privilegi di amministratore. Salva i file recuperati su un\'<b>unità diversa</b> per non sovrascrivere altri dati eliminati.</div>' }));
      }
      async function scan(letter) {
        body.innerHTML = ''; const p = UI.busyPanel(`Scansione dell'unità ${letter}: in corso…`); body.appendChild(p);
        body.appendChild(h('div', { class: 'center' }, btn('Interrompi', () => api.call('recovery', 'cancel'), 'ghost sm')));
        const r = await UI.run('recovery', 'scan', { letter }, p).catch(() => null);
        if (!r) return intro();
        r.items.forEach((x) => { x.sel = false; });
        scanRes = App.cache.recovery = r;
        results();
      }
      function results() {
        body.innerHTML = '';
        let q = '', type = 'all', chance = 'recoverable', minSize = 0;
        const counts = {};
        scanRes.items.forEach((x) => { counts[x.type] = (counts[x.type] || 0) + 1; });
        body.appendChild(h('div', { class: 'row mb wrap' },
          h('b', null, `${num(scanRes.count)} file eliminati trovati su ${scanRes.letter}:`),
          UI.search('Cerca per nome o cartella…', (v) => { q = v; draw(); }),
          h('select', { class: 'input', onchange: (e) => { type = e.target.value; draw(); } }, Object.entries(TYPES).map(([k, v]) => h('option', { value: k }, `${v}${k === 'all' ? '' : ' (' + (counts[k] || 0) + ')'}`))),
          h('select', { class: 'input', onchange: (e) => { chance = e.target.value; draw(); } }, [['recoverable', 'Recuperabili'], ['excellent', 'Solo probabilità ottima'], ['all', 'Tutti']].map(([k, v]) => h('option', { value: k }, v))),
          h('select', { class: 'input', onchange: (e) => { minSize = +e.target.value; draw(); } }, [[0, 'Qualsiasi dimensione'], [1, 'Escludi file vuoti'], [102400, '> 100 KB'], [1048576, '> 1 MB'], [104857600, '> 100 MB']].map(([k, v]) => h('option', { value: k }, v))),
          h('div', { class: 'spacer' }), btn('Nuova scansione', () => { scanRes = App.cache.recovery = null; intro(); }, 'ghost sm')));
        const slot = h('div'); body.appendChild(slot);
        let rows = [];
        function draw() {
          slot.innerHTML = '';
          rows = scanRes.items.filter((x) => (type === 'all' || x.type === type) && (chance === 'all' || (chance === 'excellent' ? x.chance === 'excellent' : x.chance !== 'none')) && x.size >= minSize && (!q || (x.name + x.folder).toLowerCase().includes(q)));
          slot.appendChild(UI.table([
            { label: '', sort: false, width: '36px', render: (x) => checkbox(x.sel, (v) => { x.sel = v; }) },
            { key: 'name', label: 'Nome', render: (x) => h('div', null, h('div', { class: 't' }, x.name), h('div', { class: 'faint mono ellip', title: x.folder }, x.folder)) },
            { key: 'size', label: 'Dimensione', cls: 'nowrap', render: (x) => bytes(x.size) },
            { key: 'mtime', label: 'Modificato', cls: 'nowrap', render: (x) => UI.date(x.mtime) },
            { key: 'chance', label: 'Probabilità di recupero', sortValue: (x) => ({ excellent: 0, average: 1, poor: 2, none: 3 }[x.chance]), render: (x) => UI.chanceTag(x.chance) }
          ], rows, { sortKey: 'mtime', sortDir: -1, limit: 1500 }));
        }
        draw();
        body.appendChild(h('div', { class: 'sticky-foot' }, btn('Seleziona tutti i visibili', () => { rows.forEach((x) => { x.sel = true; }); draw(); }, 'ghost sm'), h('div', { class: 'spacer' }), btn('Recupera selezionati…', recover, 'primary', 'lifebuoy')));
      }
      async function recover() {
        const idx = scanRes.items.filter((x) => x.sel).map((x) => x.i);
        if (!idx.length) { UI.toast('Seleziona almeno un file', 'warn'); return; }
        const dest = await api.openDialog({ title: 'Scegli dove salvare i file recuperati', properties: ['openDirectory', 'createDirectory'] });
        if (!dest[0]) return;
        let keep = true;
        let r = await UI.run('recovery', 'recover', { indexes: idx, destination: dest[0], keepStructure: keep });
        if (r.needConfirmSameDrive) {
          if (!(await UI.confirmBox('Stessa unità', 'Stai salvando i file sulla stessa unità da cui li recuperi: potresti sovrascrivere altri file eliminati. Continuare comunque?', 'Continua', 'danger'))) return;
          r = await UI.run('recovery', 'recover', { indexes: idx, destination: dest[0], keepStructure: keep, allowSameDrive: true });
        }
        UI.modal({ title: 'Recupero completato', body: h('div', null, h('p', null, `${num(r.recovered)} file recuperati in ${r.destination}.`), r.failed.length ? h('p', { class: 'muted' }, `${r.failed.length} non recuperati: ${r.failed.slice(0, 5).map((f) => f.name + ' (' + f.error + ')').join(', ')}`) : null), actions: [{ label: 'Apri cartella', kind: 'primary', onClick: () => api.open(r.destination) }] });
      }
      async function bin() {
        body.innerHTML = ''; body.appendChild(UI.busyPanel('Lettura del Cestino…'));
        const items = await api.call('recovery', 'recycleBin');
        body.innerHTML = '';
        if (!items.length) { body.appendChild(UI.empty('trash', 'Il Cestino è vuoto', 'Usa la scansione approfondita per cercare file eliminati definitivamente.')); return; }
        items.forEach((x) => { x.sel = false; });
        body.appendChild(UI.table([
          { label: '', sort: false, width: '36px', render: (x) => checkbox(x.sel, (v) => { x.sel = v; }) },
          { key: 'name', label: 'Nome' }, { key: 'from', label: 'Posizione originale', cls: 'mono ellip' },
          { key: 'size', label: 'Dimensione', cls: 'nowrap', render: (x) => bytes(x.size) }, { key: 'deleted', label: 'Eliminato', cls: 'nowrap', render: (x) => UI.date(x.deleted, true) }
        ], items, { sortKey: 'deleted', sortDir: -1 }));
        body.appendChild(h('div', { class: 'sticky-foot' }, h('div', { class: 'spacer' }), btn('Ripristina selezionati', async () => {
          const paths = items.filter((x) => x.sel).map((x) => x.path);
          if (!paths.length) return;
          const r = await UI.run('recovery', 'restoreFromRecycleBin', { paths });
          UI.toast(`${r.restored} file ripristinati nella posizione originale`);
          bin();
        }, 'primary', 'undo')));
      }
      drawTabs();
      scanRes ? results() : intro();
    }
  };
})();
