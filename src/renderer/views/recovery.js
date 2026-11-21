(function () {
  const { h, bytes, num, btn, checkbox } = UI;
  const TYPES = { all: 'Tutti i tipi', image: 'Immagini', document: 'Documenti', video: 'Video', music: 'Audio', archive: 'Archivi', other: 'Altro' };

  // ------------------------------------------------------------ shared preview
  function hexDump(hex) {
    const lines = [];
    for (let i = 0; i < hex.length; i += 32) {
      const chunk = hex.slice(i, i + 32);
      const ascii = chunk.match(/../g).map((x) => { const c = parseInt(x, 16); return c >= 32 && c < 127 ? String.fromCharCode(c) : '.'; }).join('');
      lines.push(String((i / 2).toString(16)).padStart(6, '0') + '  ' + chunk.match(/../g).join(' ').padEnd(48) + '  ' + ascii);
    }
    return lines.join('\n');
  }

  UI.showPreview = function (p) {
    let urls = [];
    const blob = (data, mime) => { const u = URL.createObjectURL(new Blob([data], { type: mime })); urls.push(u); return u; };
    let content;
    if (p.kind === 'image') content = h('img', { src: blob(p.data, p.mime), style: { maxWidth: '100%', maxHeight: '62vh', display: 'block', margin: '0 auto', background: 'repeating-conic-gradient(#8882 0 25%, transparent 0 50%) 50% / 20px 20px' }, onerror: (e) => { e.target.replaceWith(h('div', { class: 'notice warn', html: Icons.get('alert') + '<div>L\'immagine non può essere visualizzata: il file è danneggiato o sovrascritto. Prova la sezione <b>Riparazione file</b> dopo averlo recuperato.</div>' })); } });
    else if (p.kind === 'video') content = h('video', { src: blob(p.data, p.mime), controls: true, style: { width: '100%', maxHeight: '62vh' } });
    else if (p.kind === 'audio') content = h('audio', { src: blob(p.data, p.mime), controls: true, style: { width: '100%' } });
    else if (p.kind === 'pdf') {
      api.openPdf(p.data, p.name);
      content = h('div', { class: 'center', style: { padding: '30px' } }, h('div', { class: 'card-ic', style: { margin: '0 auto 12px' }, html: Icons.get('file') }), h('p', null, 'Il documento PDF è stato aperto in una finestra di anteprima.'), btn('Apri di nuovo', () => api.openPdf(p.data, p.name), 'ghost sm'));
    }
    else if (p.kind === 'text') content = h('div', null, p.thumb ? h('img', { src: blob(p.thumb, p.thumbMime), style: { maxHeight: '180px', display: 'block', marginBottom: '10px', borderRadius: '6px' } }) : null, h('pre', { class: 'log', style: { maxHeight: '55vh' } }, p.text || '(nessun testo)'));
    else if (p.kind === 'zip') content = h('div', null, p.thumb ? h('img', { src: blob(p.thumb, p.thumbMime), style: { maxHeight: '180px', display: 'block', marginBottom: '10px' } }) : null, h('p', { class: 'muted' }, `Archivio con ${p.entries.length} elementi:`), h('pre', { class: 'log' }, p.entries.map((e) => e.name + (e.size != null ? `  (${bytes(e.size)})` : '')).join('\n')));
    else if (p.kind === 'hex') content = h('div', null, h('p', { class: 'muted' }, 'Anteprima non disponibile per questo formato. Primi 512 byte del file:'), h('pre', { class: 'log mono' }, hexDump(p.hex)));
    else content = h('p', { class: 'muted' }, p.reason || 'Anteprima non disponibile per questo formato.');
    UI.modal({ title: p.name || 'Anteprima', wide: true, body: h('div', null, content, h('p', { class: 'faint', style: { marginTop: '10px' } }, `${bytes(p.size)}${p.truncated ? ' · anteprima parziale del file' : ''}`)), onClose: () => urls.forEach((u) => URL.revokeObjectURL(u)) });
  };

  // ------------------------------------------------------------ view
  UI.Views.recovery = {
    render(root, params) {
      let tab = params.tab || 'recover';
      const tabsSlot = h('div'), body = h('div');
      root.appendChild(UI.pageHeader('Recupero file', 'Recupera file eliminati, persi dopo una formattazione o da unità danneggiate: dischi, schede SD, chiavette USB e immagini disco. Smetti di usare l\'unità il prima possibile per aumentare le probabilità di recupero.'));
      root.appendChild(tabsSlot); root.appendChild(body);
      function drawTabs() { tabsSlot.innerHTML = ''; tabsSlot.appendChild(UI.tabs([{ id: 'recover', label: 'Recupera dati' }, { id: 'images', label: 'Immagine disco' }, { id: 'thumbs', label: 'Miniature di Windows' }, { id: 'bin', label: 'Cestino' }], tab, (t) => { tab = t; drawTabs(); show(); })); }
      function show() { body.innerHTML = ''; ({ recover: recoverTab, images: imagesTab, thumbs: thumbsTab, bin: binTab })[tab](); }
      let mode = App.cache.recMode || 'quick';

      // ---------------------------------------------- source selection
      async function recoverTab() {
        if (App.cache.recovery) return results();
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'radio-row mb' },
          [['quick', 'Scansione rapida', 'Trova in pochi minuti i file eliminati di recente, con nome e cartella originali.'], ['deep', 'Scansione profonda', 'Cerca anche i file per firma (foto, video, documenti, archivi): per dischi formattati, schede SD o file non trovati con la rapida. Richiede più tempo.']]
            .map(([id, t, d]) => h('div', { class: 'radio-card' + (mode === id ? ' on' : ''), onclick: () => { mode = App.cache.recMode = id; recoverTab(); } }, h('b', null, t), h('span', { class: 'muted' }, d)))));
        const drivesEl = h('div', { class: 'grid g3' }, h('div', { class: 'muted' }, 'Lettura delle unità…'));
        body.appendChild(h('h3', null, 'Unità'));
        body.appendChild(drivesEl);
        const sf = await api.call('recovery', 'specialFolders').catch(() => ({}));
        body.appendChild(h('h3', { class: 'mt2' }, 'Posizioni'));
        body.appendChild(h('div', { class: 'grid g4' },
          locCard('folder', 'Desktop', 'File eliminati dal desktop', () => scanFolder(sf.desktop, 'Desktop')),
          locCard('trash', 'Cestino svuotato', 'File eliminati dopo aver svuotato il Cestino', () => scanRecycle()),
          locCard('file', 'Documenti', 'File eliminati dalla cartella Documenti', () => scanFolder(sf.documents, 'Documenti')),
          locCard('search', 'Seleziona cartella', 'Cerca solo in una cartella specifica', async () => { const r = await api.openDialog({ properties: ['openDirectory'] }); if (r[0]) scanFolder(r[0], r[0]); })));
        body.appendChild(h('h3', { class: 'mt2' }, 'Altre origini'));
        const saved = await api.call('recovery', 'listScans').catch(() => []);
        body.appendChild(h('div', { class: 'grid g2' },
          h('div', { class: 'card click', onclick: fromImage }, h('div', { class: 'row' }, h('div', { class: 'card-ic violet', style: { margin: 0 }, html: Icons.get('disk') }), h('div', null, h('h3', { style: { margin: 0 } }, 'Recupera da un\'immagine disco'), h('div', { class: 'muted' }, 'File .img, .dd, .raw o .bin creati da NovaTune o da altri programmi')))),
          h('div', { class: 'card' }, h('h3', null, 'Scansioni salvate'), saved.length ? h('div', { class: 'list', style: { maxHeight: '220px', overflow: 'auto' } }, saved.map((s) => h('div', { class: 'item' },
            h('div', { class: 'grow' }, h('div', { class: 't' }, `${s.label} · ${s.mode === 'deep' ? 'profonda' : 'rapida'}`), h('div', { class: 'd' }, `${UI.date(s.date, true)} · ${bytes(s.size)}`)),
            btn('Apri', async () => { const p = UI.busyPanel('Caricamento della scansione…'); body.innerHTML = ''; body.appendChild(p); App.cache.recovery = await UI.run('recovery', 'loadScan', { file: s.file }).catch(() => null); recoverTab(); }, 'primary sm'),
            h('button', { class: 'icon-btn', html: Icons.get('trash'), title: 'Elimina', onclick: async () => { await api.call('recovery', 'deleteScan', { file: s.file }); recoverTab(); } })))) : h('p', { class: 'muted' }, 'Le scansioni salvate ti permettono di riprendere il recupero senza ripetere la scansione.'))));
        body.appendChild(h('div', { class: 'notice mt', html: Icons.get('info') + '<div>Il recupero legge direttamente l\'unità e richiede i privilegi di amministratore. Salva i file recuperati su un\'<b>unità diversa</b> per non sovrascrivere altri dati eliminati.</div>' }));
        const drives = await api.call('recovery', 'drives').catch(() => []);
        drivesEl.innerHTML = '';
        drives.forEach((d) => drivesEl.appendChild(h('div', { class: 'card click', onclick: () => d.locked ? unlock(d) : startScan({ letter: d.letter, mode }, `${d.label || 'Disco locale'} (${d.letter}:)`) },
          h('div', { class: 'row' }, h('div', { class: 'card-ic ' + (d.removable ? 'warn' : 'teal'), style: { margin: 0 }, html: Icons.get(d.locked ? 'lock' : d.removable ? 'usb' : 'disk') }),
            h('div', { style: { minWidth: 0 } }, h('h3', { style: { margin: 0 } }, `${d.label || (d.removable ? 'Unità rimovibile' : 'Disco locale')} (${d.letter}:)`),
              h('div', { class: 'muted' }, d.locked ? 'Unità BitLocker bloccata · clic per sbloccare' : `${d.fs || 'RAW'} · ${bytes(d.free)} liberi di ${bytes(d.size)}`))),
          h('div', { class: 'row mt' }, d.removable ? h('span', { class: 'tag warn' }, 'Rimovibile') : null, d.bitlocker ? h('span', { class: 'tag ' + (d.locked ? 'err' : 'ok') }, d.locked ? 'BitLocker: bloccata' : 'BitLocker: sbloccata') : null, !d.fs && !d.locked ? h('span', { class: 'tag err' }, 'File system non riconosciuto') : null))));
      }
      function locCard(icon, t, d, fn) { return h('div', { class: 'card click', onclick: fn }, h('div', { class: 'card-ic', html: Icons.get(icon) }), h('h3', null, t), h('div', { class: 'muted', style: { fontSize: '13px' } }, d)); }

      function scanFolder(folder, label) {
        if (!folder) return;
        startScan({ letter: folder[0], mode: 'quick', folders: [folder], scope: label }, `${label} (${folder[0].toUpperCase()}:)`);
      }
      function scanRecycle() {
        const l = (App.cache.sysDrive || 'C');
        startScan({ letter: l, mode: 'quick', folders: ['Cestino svuotato', l + ':\\$Recycle.Bin'], scope: 'Cestino svuotato' }, 'Cestino svuotato');
      }

      async function fromImage() {
        const f = await api.openDialog({ title: 'Seleziona un\'immagine disco', properties: ['openFile'], filters: [{ name: 'Immagini disco', extensions: ['img', 'dd', 'raw', 'bin', 'ima', 'vhd'] }, { name: 'Tutti i file', extensions: ['*'] }] });
        if (!f[0]) return;
        const parts = await UI.run('recovery', 'imagePartitions', { image: f[0] }).catch(() => null);
        if (!parts) return;
        let chosen = parts.find((p) => p.fs !== 'Sconosciuto') || parts[0];
        if (parts.length > 1) {
          const ok = await new Promise((res) => UI.modal({ title: 'Scegli la partizione', body: h('div', { class: 'list' }, parts.map((p) => h('label', { class: 'item' }, h('input', { type: 'radio', name: 'part', checked: p === chosen, onchange: () => { chosen = p; } }), h('div', { class: 'grow' }, h('div', { class: 't' }, p.label), h('div', { class: 'd' }, `${p.fs} · ${bytes(p.size)}`))))), onClose: () => res(false), actions: [{ label: 'Annulla', kind: 'ghost', onClick: () => res(false) }, { label: 'Scansiona', kind: 'primary', onClick: () => res(true) }] }));
          if (!ok) return;
        }
        startScan({ image: f[0], partitionOffset: chosen.offset, mode }, f[0].split('\\').pop());
      }

      async function unlock(d) {
        let pw = '', key = '', useKey = false;
        const res = await new Promise((resolve) => UI.modal({
          title: `Sblocca l'unità ${d.letter}: (BitLocker)`,
          body: h('div', null,
            h('p', { class: 'muted' }, 'Per analizzare un\'unità crittografata con BitLocker devi prima sbloccarla con la password o con la chiave di ripristino di 48 cifre.'),
            h('label', { class: 'row mb' }, h('input', { type: 'radio', name: 'bl', checked: true, onchange: () => { useKey = false; } }), 'Password'),
            h('input', { class: 'input mb', type: 'password', style: { width: '100%' }, placeholder: 'Password BitLocker', oninput: (e) => { pw = e.target.value; } }),
            h('label', { class: 'row mb' }, h('input', { type: 'radio', name: 'bl', onchange: () => { useKey = true; } }), 'Chiave di ripristino'),
            h('input', { class: 'input mb mono', style: { width: '100%' }, placeholder: '000000-000000-000000-000000-000000-000000-000000-000000', oninput: (e) => { key = e.target.value.trim(); } }),
            h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Non trovi la chiave? Se il PC usa un account Microsoft, la chiave è salvata nel tuo account: ', h('a', { class: 'link', onclick: () => api.open('https://account.microsoft.com/devices/recoverykey') }, 'apri la pagina delle chiavi di ripristino'), '.')),
          onClose: () => resolve(null),
          actions: [{ label: 'Annulla', kind: 'ghost', onClick: () => resolve(null) }, { label: 'Sblocca', kind: 'primary', onClick: () => resolve(true) }]
        }));
        if (!res) return;
        const r = await UI.run('recovery', 'unlockBitlocker', { letter: d.letter, password: useKey ? '' : pw, recoveryKey: useKey ? key : '' }).catch(() => null);
        if (r && r.ok) { UI.toast(`Unità ${d.letter}: sbloccata`); recoverTab(); } else if (r) UI.toast(r.error, 'err', 7000);
      }

      async function startScan(opts, label) {
        tabsSlot.style.display = 'none';
        body.innerHTML = '';
        const p = UI.busyPanel(`${opts.mode === 'deep' ? 'Scansione profonda' : 'Scansione'} di ${label}…`);
        body.appendChild(p);
        body.appendChild(h('div', { class: 'center' }, btn('Interrompi e mostra i risultati', () => api.call('recovery', 'cancel'), 'ghost sm')));
        const r = await UI.run('recovery', 'scan', opts, p).catch(() => null);
        tabsSlot.style.display = '';
        if (!r) return recoverTab();
        App.cache.recovery = r;
        r.items.forEach((x) => { x.sel = false; });
        results();
      }

      // ---------------------------------------------- results
      function buildTree(items) {
        const rootNode = { name: '', path: '', count: 0, children: new Map() };
        for (const it of items) {
          const parts = it.folder.split('\\').filter(Boolean);
          let node = rootNode; let p = '';
          node.count++;
          for (const part of parts) {
            p = p ? p + '\\' + part : part;
            if (!node.children.has(part)) node.children.set(part, { name: part, path: p, count: 0, children: new Map() });
            node = node.children.get(part);
            node.count++;
          }
        }
        return rootNode;
      }

      function results() {
        const scan = App.cache.recovery;
        body.innerHTML = '';
        scan.items.forEach((x) => { if (x.sel == null) x.sel = false; });
        let q = '', type = 'all', chance = 'recoverable', minSize = 0, folder = '';
        const counts = {};
        scan.items.forEach((x) => { counts[x.type] = (counts[x.type] || 0) + 1; });
        body.appendChild(h('div', { class: 'card mb' }, h('div', { class: 'row wrap' },
          h('div', { class: 'grow', style: { flex: 1 } }, h('h3', { style: { margin: 0 } }, `${num(scan.count)} file trovati · ${scan.scope || scan.label}`), h('div', { class: 'muted' }, `${scan.fs || ''} · scansione ${scan.mode === 'deep' ? 'profonda' : 'rapida'} · ${UI.date(scan.date, true)}${scan.cancelled ? ' · interrotta' : ''}`)),
          scan.mode !== 'deep' && !scan.scope ? btn('Scansione profonda', () => { mode = App.cache.recMode = 'deep'; startScan(Object.assign({}, scan.source, { mode: 'deep' }), scan.label); }, 'ghost sm', 'search') : null,
          btn('Salva scansione', async () => { const r = await UI.run('recovery', 'saveScan'); UI.toast('Scansione salvata: potrai riaprirla in seguito'); }, 'ghost sm', 'download'),
          btn('Nuova scansione', () => { App.cache.recovery = null; recoverTab(); }, 'ghost sm', 'refresh'))));
        const treeEl = h('div', { class: 'list', style: { width: '290px', flex: 'none', maxHeight: 'calc(100vh - 330px)', overflow: 'auto' } });
        const right = h('div', { style: { flex: 1, minWidth: 0 } });
        body.appendChild(h('div', { class: 'row', style: { alignItems: 'flex-start' } }, treeEl, right));
        const tree = buildTree(scan.items);
        const expanded = new Set();
        function drawTree() {
          treeEl.innerHTML = '';
          const rowFor = (node, depth) => {
            const has = node.children.size > 0;
            const open = expanded.has(node.path);
            const el = h('div', { class: 'item', style: { padding: '6px 10px 6px ' + (10 + depth * 14) + 'px', cursor: 'pointer', background: folder === node.path ? 'var(--panel2)' : '' }, onclick: () => { folder = node.path; drawTree(); draw(); } },
              h('span', { style: { width: '14px', color: 'var(--faint)' }, onclick: (e) => { e.stopPropagation(); open ? expanded.delete(node.path) : expanded.add(node.path); drawTree(); } }, has ? (open ? '▾' : '▸') : ''),
              h('span', { html: Icons.get(node.path ? 'folder' : 'disk') }),
              h('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px' } }, node.path ? node.name : 'Tutti i file'),
              h('span', { class: 'faint', style: { fontSize: '12px' } }, num(node.count)));
            treeEl.appendChild(el);
            if (open || !node.path) [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => rowFor(c, node.path ? depth + 1 : 0));
          };
          rowFor(tree, 0);
        }
        right.appendChild(h('div', { class: 'row mb wrap' },
          UI.search('Cerca per nome…', (v) => { q = v; draw(); }),
          h('select', { class: 'input', onchange: (e) => { type = e.target.value; draw(); } }, Object.entries(TYPES).map(([k, v]) => h('option', { value: k }, `${v}${k === 'all' ? '' : ' (' + num(counts[k] || 0) + ')'}`))),
          h('select', { class: 'input', onchange: (e) => { chance = e.target.value; draw(); } }, [['recoverable', 'Recuperabili'], ['excellent', 'Solo probabilità ottima'], ['all', 'Tutti']].map(([k, v]) => h('option', { value: k }, v))),
          h('select', { class: 'input', onchange: (e) => { minSize = +e.target.value; draw(); } }, [[0, 'Qualsiasi dimensione'], [1, 'Escludi file vuoti'], [102400, '> 100 KB'], [1048576, '> 1 MB'], [104857600, '> 100 MB']].map(([k, v]) => h('option', { value: k }, v)))));
        const slot = h('div'); right.appendChild(slot);
        const selInfo = h('span', { class: 'muted' });
        let rows = [];
        const updSel = () => { const s = scan.items.filter((x) => x.sel); selInfo.textContent = s.length ? `${num(s.length)} selezionati · ${bytes(s.reduce((a, x) => a + x.size, 0))}` : 'Seleziona i file da recuperare'; };
        function draw() {
          slot.innerHTML = '';
          rows = scan.items.filter((x) => (type === 'all' || x.type === type) && (chance === 'all' || (chance === 'excellent' ? x.chance === 'excellent' : x.chance !== 'none')) && x.size >= minSize && (!folder || x.folder === folder || x.folder.startsWith(folder + '\\')) && (!q || x.name.toLowerCase().includes(q)));
          if (!rows.length) { slot.appendChild(UI.empty('search', 'Nessun file corrisponde ai filtri', 'Modifica i filtri oppure prova la scansione profonda.')); return; }
          slot.appendChild(UI.table([
            { label: () => checkbox(false, (v) => { rows.forEach((x) => { x.sel = v; }); draw(); updSel(); }), sort: false, width: '36px', render: (x) => checkbox(x.sel, (v) => { x.sel = v; updSel(); }) },
            { key: 'name', label: 'Nome', render: (x) => h('div', { style: { minWidth: 0 } }, h('div', { class: 't' }, x.name), h('div', { class: 'faint mono ellip', title: x.folder }, x.folder)) },
            { key: 'size', label: 'Dimensione', cls: 'nowrap', render: (x) => bytes(x.size) },
            { key: 'mtime', label: 'Modificato', cls: 'nowrap', render: (x) => (x.mtime ? UI.date(x.mtime) : '—') },
            { key: 'chance', label: 'Recupero', sortValue: (x) => ({ excellent: 0, average: 1, poor: 2, none: 3 }[x.chance]), render: (x) => UI.chanceTag(x.chance) },
            { label: '', sort: false, render: (x) => h('button', { class: 'icon-btn', title: 'Anteprima', html: Icons.get('eye'), onclick: () => preview(x) }) }
          ], rows, { sortKey: 'mtime', sortDir: -1, limit: 1500, onRow: (x) => preview(x) }));
        }
        drawTree(); draw();
        body.appendChild(h('div', { class: 'sticky-foot' }, selInfo, h('div', { class: 'spacer' }), btn('Recupera…', recover, 'primary lg', 'lifebuoy')));
        updSel();
      }

      async function preview(x) {
        const m = UI.modal({ title: x.name, body: UI.busyPanel('Lettura del file dall\'unità…') });
        const p = await api.call('recovery', 'preview', { i: x.i }).catch((e) => ({ kind: 'none', reason: UI.cleanErr(e), name: x.name, size: x.size }));
        m.close();
        UI.showPreview(p);
      }

      async function recover() {
        const scan = App.cache.recovery;
        const idx = scan.items.filter((x) => x.sel).map((x) => x.i);
        if (!idx.length) { UI.toast('Seleziona almeno un file', 'warn'); return; }
        let saveMode = 'path';
        const ok = await new Promise((res) => UI.modal({ title: `Recupera ${num(idx.length)} file`, body: h('div', null,
          h('p', { class: 'muted' }, 'Come vuoi organizzare i file recuperati?'),
          h('div', { class: 'list' }, [['path', 'Mantieni le cartelle originali', 'Ricrea la struttura delle cartelle in cui si trovavano'], ['type', 'Raggruppa per tipo', 'Immagini, Documenti, Video, Audio, Archivi…'], ['flat', 'Tutti in un\'unica cartella', '']].map(([k, t, d]) => h('label', { class: 'item' }, h('input', { type: 'radio', name: 'sm', checked: k === saveMode, onchange: () => { saveMode = k; } }), h('div', { class: 'grow' }, h('div', { class: 't' }, t), d ? h('div', { class: 'd' }, d) : null))))),
          onClose: () => res(false), actions: [{ label: 'Annulla', kind: 'ghost', onClick: () => res(false) }, { label: 'Scegli la destinazione…', kind: 'primary', onClick: () => res(true) }] }));
        if (!ok) return;
        const dest = await api.openDialog({ title: 'Scegli dove salvare i file recuperati', properties: ['openDirectory', 'createDirectory'] });
        if (!dest[0]) return;
        const args = { indexes: idx, destination: dest[0], mode: saveMode };
        const panelWrap = UI.modal({ title: 'Recupero in corso', body: h('div', null) });
        const p = UI.busyPanel('Recupero dei file…');
        document.querySelector('.modal-wrap:last-child .modal-body').appendChild(p);
        let r = await UI.run('recovery', 'recover', args, p).catch(() => null);
        if (r && r.needConfirm) {
          panelWrap.close();
          const msg = { same: ['Stessa unità', 'Stai salvando i file sulla stessa unità da cui li recuperi: potresti sovrascrivere altri file eliminati e renderli irrecuperabili. Continuare comunque?'], space: ['Spazio insufficiente', `Servono ${bytes(r.need)} ma l'unità di destinazione ne ha solo ${bytes(r.free)} liberi: verrà recuperata solo una parte dei file. Continuare?`], fat32: ['Destinazione FAT32', 'L\'unità di destinazione è FAT32 e non può contenere file più grandi di 4 GB: questi file non verranno recuperati. Continuare?'] }[r.needConfirm];
          if (!(await UI.confirmBox(msg[0], msg[1], 'Continua', 'danger'))) return;
          const w2 = UI.modal({ title: 'Recupero in corso', body: h('div', null) });
          const p2 = UI.busyPanel('Recupero dei file…');
          document.querySelector('.modal-wrap:last-child .modal-body').appendChild(p2);
          r = await UI.run('recovery', 'recover', Object.assign(args, { force: true }), p2).catch(() => null);
          w2.close();
        } else panelWrap.close();
        if (!r) return;
        UI.modal({ title: 'Recupero completato', body: h('div', null,
          h('p', null, `${num(r.recovered)} file recuperati (${bytes(r.bytes)}) in ${r.destination}.`),
          r.renamed ? h('p', { class: 'muted' }, `${r.renamed} file con nomi troppo lunghi sono stati rinominati.`) : null,
          r.failed.length ? h('p', { class: 'muted' }, `${r.failed.length} non recuperati: ${r.failed.slice(0, 5).map((f) => f.name + ' (' + f.error + ')').join(', ')}`) : null,
          h('p', { class: 'muted' }, 'Se un file recuperato non si apre, prova la sezione Riparazione file.')),
          actions: [{ label: 'Ripara file', kind: 'ghost', onClick: () => App.go('repair') }, { label: 'Apri cartella', kind: 'primary', onClick: () => api.open(r.destination) }] });
      }

      // ---------------------------------------------- disk image
      async function imagesTab() {
        body.innerHTML = '';
        const drives = (await api.call('recovery', 'drives').catch(() => [])).filter((d) => !d.locked);
        let letter = (drives.find((d) => d.removable) || drives[0] || {}).letter;
        body.appendChild(h('div', { class: 'grid g2' },
          h('div', { class: 'card' }, h('div', { class: 'card-ic violet', html: Icons.get('backup') }), h('h3', null, 'Crea un\'immagine disco'),
            h('p', { class: 'muted' }, 'Copia settore per settore di un\'unità in un file. Utile se il disco o la scheda SD dà errori: lavori sulla copia senza stressare ulteriormente il dispositivo. Le aree illeggibili vengono riempite con zeri.'),
            h('div', { class: 'row mt' }, h('select', { class: 'input', style: { flex: 1 }, onchange: (e) => { letter = e.target.value; } }, drives.map((d) => h('option', { value: d.letter, selected: d.letter === letter }, `${d.letter}: ${d.label || ''} · ${d.fs || 'RAW'} · ${bytes(d.size)}`))),
              btn('Crea immagine…', () => createImage(letter), 'primary', 'download'))),
          h('div', { class: 'card' }, h('div', { class: 'card-ic teal', html: Icons.get('search') }), h('h3', null, 'Recupera da un\'immagine'),
            h('p', { class: 'muted' }, 'Analizza un file immagine (.img, .dd, .raw, .bin) creato con NovaTune o con altri programmi, anche se contiene un intero disco con più partizioni.'),
            h('div', { class: 'row mt' }, btn('Apri immagine…', () => { tab = 'recover'; drawTabs(); body.innerHTML = ''; fromImage(); }, 'primary', 'folder')))));
      }

      async function createImage(letter) {
        if (!letter) return;
        const file = await api.saveDialog({ title: 'Salva l\'immagine disco', defaultPath: `Immagine_${letter}_${new Date().toISOString().slice(0, 10)}.img`, filters: [{ name: 'Immagine disco', extensions: ['img'] }] });
        if (!file) return;
        body.innerHTML = '';
        const p = UI.busyPanel(`Creazione dell'immagine dell'unità ${letter}:…`);
        const extra = h('div', { class: 'center muted' });
        body.appendChild(p); body.appendChild(extra);
        body.appendChild(h('div', { class: 'center mt' }, btn('Interrompi', () => api.call('recovery', 'cancel'), 'ghost sm')));
        const off = UI.onProgress((x) => { if (x.mod === 'recovery' && x.fn === 'createImage' && x.speed) extra.textContent = `${bytes(x.speed)}/s · ${Math.ceil((x.eta || 0) / 60)} min rimanenti${x.bad ? ' · ' + num(x.bad) + ' settori illeggibili' : ''}`; });
        const r = await UI.run('recovery', 'createImage', { letter, destination: file }, p).catch(() => null);
        off();
        body.innerHTML = '';
        if (!r) return imagesTab();
        body.appendChild(UI.doneCard(r.cancelled ? 'Creazione interrotta' : 'Immagine creata', `${file} · ${bytes(r.size)}${r.bad ? ' · ' + num(r.bad) + ' settori illeggibili riempiti con zeri' : ''}${r.cancelled ? ' · contiene solo i dati copiati fino all\'interruzione' : ''}`));
        body.appendChild(h('div', { class: 'row mt', style: { justifyContent: 'center' } }, btn('Scansiona l\'immagine', () => { tab = 'recover'; drawTabs(); startScan({ image: file, partitionOffset: 0, mode }, file.split('\\').pop()); }, 'primary'), btn('Apri cartella', () => api.showInFolder(file), 'ghost')));
      }

      // ---------------------------------------------- thumbnails
      async function thumbsTab() {
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'notice mb', html: Icons.get('info') + '<div>Windows conserva le <b>anteprime</b> di foto e video nella cache delle miniature. Spesso restano anche dopo che il file originale è stato eliminato: è un modo per recuperare almeno una versione ridotta di foto perse definitivamente.</div>' }));
        const p = UI.busyPanel('Lettura della cache delle miniature…');
        body.appendChild(p);
        const r = await UI.run('recovery', 'thumbcache', {}, p).catch(() => null);
        p.remove();
        if (!r) return;
        if (!r.items.length) { body.appendChild(UI.empty('eye', 'Nessuna miniatura trovata', r.errors.length ? 'File della cache non leggibili: ' + r.errors.join(', ') : 'La cache delle miniature è vuota.')); return; }
        let minW = 0;
        const sel = new Set();
        const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' } });
        const info = h('span', { class: 'muted' });
        const upd = () => { info.textContent = sel.size ? `${sel.size} selezionate` : `${r.items.length} miniature trovate`; };
        function draw() {
          grid.innerHTML = '';
          r.items.filter((t) => t.w >= minW || !t.w).forEach((t) => {
            const cb = checkbox(sel.has(t.id), (v) => { v ? sel.add(t.id) : sel.delete(t.id); upd(); });
            grid.appendChild(h('div', { class: 'card', style: { padding: '8px' } },
              h('div', { style: { height: '120px', display: 'grid', placeItems: 'center', background: 'var(--bg)', borderRadius: '8px', overflow: 'hidden', cursor: 'zoom-in' }, onclick: () => UI.modal({ title: 'Miniatura', wide: true, body: h('img', { src: t.preview, style: { maxWidth: '100%', display: 'block', margin: '0 auto' } }) }) }, h('img', { src: t.preview, loading: 'lazy', style: { maxWidth: '100%', maxHeight: '120px' } })),
              h('div', { class: 'row mt', style: { gap: '6px' } }, cb, h('span', { class: 'faint', style: { fontSize: '11px' } }, `${t.w ? t.w + '×' + t.h : t.kind.toUpperCase()} · ${bytes(t.size)}`))));
          });
        }
        body.appendChild(h('div', { class: 'row mb' }, h('b', null, 'Dimensione minima:'), h('select', { class: 'input', onchange: (e) => { minW = +e.target.value; draw(); } }, [[0, 'Tutte'], [96, '96 px'], [256, '256 px'], [768, '768 px']].map(([v, l]) => h('option', { value: v }, l)))));
        body.appendChild(grid);
        body.appendChild(h('div', { class: 'sticky-foot' }, info, h('div', { class: 'spacer' }), btn('Esporta selezionate', () => exp([...sel]), 'ghost'), btn('Esporta tutte', () => exp(null), 'primary', 'download')));
        async function exp(ids) {
          if (ids && !ids.length) { UI.toast('Seleziona almeno una miniatura', 'warn'); return; }
          const d = await api.openDialog({ title: 'Cartella di destinazione', properties: ['openDirectory', 'createDirectory'] });
          if (!d[0]) return;
          const x = await UI.run('recovery', 'exportThumbs', { ids, destination: d[0] });
          UI.toast(`${x.exported} miniature esportate`);
          api.open(d[0]);
        }
        draw(); upd();
      }

      // ---------------------------------------------- recycle bin
      async function binTab() {
        body.innerHTML = ''; body.appendChild(UI.busyPanel('Lettura del Cestino…'));
        const items = await api.call('recovery', 'recycleBin');
        body.innerHTML = '';
        if (!items.length) { body.appendChild(UI.empty('trash', 'Il Cestino è vuoto', 'Per i file eliminati dopo aver svuotato il Cestino usa "Recupera dati" › "Cestino svuotato".')); return; }
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
          binTab();
        }, 'primary', 'undo')));
      }

      if (!App.cache.sysDrive) api.call('system', 'info').then((i) => { App.cache.sysinfo = i; App.cache.sysDrive = (i.sysDrive || 'C:')[0]; }).catch(() => {});
      else if (App.cache.sysinfo) App.cache.sysDrive = (App.cache.sysinfo.sysDrive || 'C:')[0];
      drawTabs(); show();
    }
  };

  // ============================================================ File repair
  UI.Views.repair = {
    render(root) {
      const files = App.cache.repairFiles || (App.cache.repairFiles = []);
      let dest = '';
      const body = h('div');
      root.appendChild(UI.pageHeader('Riparazione file', 'Ripara foto, documenti e archivi danneggiati o che non si aprono, ad esempio dopo un recupero. I file originali non vengono modificati: le copie riparate vengono salvate a parte.'));
      root.appendChild(body);
      const add = (paths) => { for (const p of paths) if (!files.some((f) => f.path === p)) files.push({ path: p, ref: null }); render(); };
      function render() {
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'grid g4 mb' },
          [['eye', 'Foto', 'JPEG (anche con intestazione danneggiata, usando una foto di riferimento) e PNG'], ['file', 'Documenti', 'Word, Excel, PowerPoint (.docx .xlsx .pptx) e OpenDocument'], ['lock', 'PDF', 'Ricostruzione della tabella dei riferimenti dei PDF che non si aprono'], ['box', 'Archivi', 'ZIP, EPUB, JAR: recupera tutti gli elementi ancora leggibili']]
            .map(([ic, t, d]) => h('div', { class: 'card' }, h('div', { class: 'card-ic teal', html: Icons.get(ic) }), h('h3', null, t), h('div', { class: 'muted', style: { fontSize: '13px' } }, d)))));
        const drop = h('div', { class: 'drop', ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'), ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); add([...e.dataTransfer.files].map((f) => api.filePath(f)).filter(Boolean)); } },
          h('div', { html: Icons.get('upload'), style: { marginBottom: '8px' } }), 'Trascina qui i file danneggiati',
          h('div', { class: 'row mt', style: { justifyContent: 'center' } }, btn('Aggiungi file…', async () => add(await api.openDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'File supportati', extensions: ['jpg', 'jpeg', 'jfif', 'png', 'pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'zip', 'epub', 'jar'] }, { name: 'Tutti i file', extensions: ['*'] }] })), 'ghost sm', 'file')));
        body.appendChild(drop);
        if (files.length) {
          body.appendChild(h('div', { class: 'list mt' }, h('div', { class: 'list-head' }, 'File da riparare', h('span', { class: 'badge' }, files.length), h('span', { class: 'spacer' }), h('button', { class: 'btn ghost sm', onclick: () => { files.length = 0; render(); } }, 'Svuota elenco')),
            files.map((f, i) => {
              const isJpg = /\.(jpe?g|jfif)$/i.test(f.path);
              return h('div', { class: 'item' }, h('span', { html: Icons.get('file') }),
                h('div', { class: 'grow' }, h('div', { class: 't' }, f.path.split('\\').pop()), h('div', { class: 'd mono' }, f.path),
                  isJpg ? h('div', { class: 'd' }, f.ref ? `Foto di riferimento: ${f.ref.split('\\').pop()}` : 'Facoltativo: aggiungi una foto sana dello stesso dispositivo per la riparazione avanzata dell\'intestazione') : null,
                  f.result ? h('div', { class: 'd', style: { color: f.result.ok ? 'var(--ok)' : 'var(--err)' } }, f.result.ok ? '✓ ' + (f.result.notes || []).join(' · ') : '✗ ' + f.result.error) : null),
                isJpg ? btn(f.ref ? 'Cambia riferimento' : 'Foto di riferimento…', async () => { const r = await api.openDialog({ properties: ['openFile'], filters: [{ name: 'JPEG', extensions: ['jpg', 'jpeg'] }] }); if (r[0]) { f.ref = r[0]; render(); } }, 'ghost sm') : null,
                h('button', { class: 'icon-btn', title: 'Anteprima originale', html: Icons.get('eye'), onclick: () => prev(f.path) }),
                f.result && f.result.ok ? btn('Apri riparato', () => prev(f.result.output), 'primary sm') : null,
                f.result && f.result.ok ? h('button', { class: 'icon-btn', title: 'Mostra nella cartella', html: Icons.get('folder'), onclick: () => api.showInFolder(f.result.output) }) : null,
                h('button', { class: 'icon-btn', html: Icons.get('x'), onclick: () => { files.splice(i, 1); render(); } }));
            })));
          body.appendChild(h('div', { class: 'row mt' }, h('b', null, 'Salva in:'), h('span', { class: 'muted' }, dest || 'una cartella "Riparati" accanto a ogni file'), btn('Cambia…', async () => { const r = await api.openDialog({ properties: ['openDirectory', 'createDirectory'] }); if (r[0]) { dest = r[0]; render(); } }, 'ghost sm', 'folder')));
          body.appendChild(h('div', { class: 'row mt' }, btn('Ripara', run, 'primary lg', 'wand')));
        }
      }
      async function prev(p) {
        const r = await api.call('repair', 'previewFile', { path: p }).catch((e) => ({ kind: 'none', reason: UI.cleanErr(e) }));
        UI.showPreview(r);
      }
      async function run() {
        const p = UI.busyPanel('Riparazione in corso…');
        body.prepend(p);
        const r = await UI.run('repair', 'repairFiles', { files: files.map((f) => ({ path: f.path, ref: f.ref })), destination: dest || null }, p).catch(() => null);
        p.remove();
        if (!r) return;
        r.results.forEach((res) => { const f = files.find((x) => x.path === res.path); if (f) f.result = res; });
        const ok = r.results.filter((x) => x.ok).length;
        UI.toast(`${ok} di ${r.results.length} file riparati`, ok === r.results.length ? 'ok' : 'warn');
        render();
      }
      render();
    }
  };
})();
