(function () {
  const { h, bytes, btn } = UI;
  const MEDIA = { SSD: 'SSD', HDD: 'Disco rigido (HDD)', SD: 'Scheda SD', Flash: 'Unità flash', Unspecified: 'Sconosciuto', Unknown: 'Sconosciuto' };

  UI.Views.disks = {
    render(root) {
      const body = h('div');
      root.appendChild(UI.pageHeader('Ottimizzazione dischi', 'Deframmenta i dischi rigidi, ottimizza gli SSD con TRIM e controlla gli errori del file system e lo stato di salute delle unità.', btn('Aggiorna', () => load(), 'ghost', 'refresh')));
      root.appendChild(body);
      let disks = [];
      async function load() {
        body.innerHTML = ''; body.appendChild(UI.busyPanel('Rilevamento delle unità…'));
        try { disks = await api.call('disks', 'list'); } catch (e) { body.innerHTML = ''; UI.toast(UI.cleanErr(e), 'err'); return; }
        render();
      }
      function render() {
        body.innerHTML = '';
        if (!disks.length) { body.appendChild(UI.empty('disk', 'Nessuna unità trovata', '')); return; }
        body.appendChild(h('div', { class: 'grid g2' }, disks.map(card)));
        body.appendChild(h('div', { class: 'notice mt', html: Icons.get('info') + '<div>Gli <b>SSD</b> non vanno deframmentati: NovaTune esegue il comando <b>TRIM</b>, che mantiene le prestazioni senza usurare l\'unità. I <b>dischi rigidi</b> vengono deframmentati per ridurre i tempi di accesso.</div>' }));
      }
      function card(d) {
        const used = d.size - d.free, pct = Math.round((used / d.size) * 100);
        const isSSD = d.media === 'SSD';
        const status = h('div', { class: 'mt' });
        const health = d.health === 'Healthy' ? h('span', { class: 'tag ok' }, 'Integro') : d.health ? h('span', { class: 'tag err' }, d.health) : null;
        const rel = d.reliability;
        const el = h('div', { class: 'card' },
          h('div', { class: 'row' }, h('div', { class: 'card-ic ' + (isSSD ? 'violet' : 'teal'), style: { margin: 0 }, html: Icons.get(d.driveType === 'Removable' ? 'usb' : 'disk') }),
            h('div', { class: 'grow', style: { flex: 1 } }, h('h3', { style: { margin: 0 } }, `${d.label || 'Disco locale'} (${d.letter}:)`), h('div', { class: 'muted', style: { fontSize: '13px' } }, `${MEDIA[d.media] || d.media} · ${d.fs} · ${d.model || ''}`)), health),
          h('div', { class: 'row between mt' }, h('span', null, `${bytes(used)} usati`), h('span', { class: 'muted' }, `${bytes(d.free)} liberi di ${bytes(d.size)}`)),
          h('div', { class: 'meter mt ' + (pct > 90 ? 'err' : pct > 80 ? 'warn' : '') }, h('div', { style: { width: pct + '%' } })),
          h('div', { class: 'kv mt' },
            h('div', null, isSSD ? 'Ultima ottimizzazione' : 'Frammentazione'), h('div', null, isSSD ? UI.date(d.lastOptimized, true) : (d.fragmentation != null ? d.fragmentation + '%' : 'Non analizzato')),
            !isSSD ? h('div', null, 'Ultima deframmentazione') : null, !isSSD ? h('div', null, UI.date(d.lastOptimized, true)) : null,
            rel && rel.temperature ? h('div', null, 'Temperatura') : null, rel && rel.temperature ? h('div', null, rel.temperature + ' °C') : null,
            rel && rel.wear != null ? h('div', null, 'Usura') : null, rel && rel.wear != null ? h('div', null, rel.wear + '%') : null,
            rel && rel.powerOnHours ? h('div', null, 'Ore di accensione') : null, rel && rel.powerOnHours ? h('div', null, UI.num(rel.powerOnHours)) : null),
          status,
          h('div', { class: 'row mt wrap' },
            !isSSD ? btn('Analizza', async () => {
              status.innerHTML = ''; const p = UI.busyPanel('Analisi della frammentazione…'); status.appendChild(p);
              const r = await UI.run('disks', 'analyze', { letter: d.letter }, p).catch(() => null);
              status.innerHTML = '';
              if (r && r.ok) { d.fragmentation = r.totalPercent; UI.toast(`Unità ${d.letter}: frammentazione ${r.totalPercent}%`); render(); }
              else UI.toast('Analisi non riuscita (sono necessari i privilegi di amministratore)', 'err');
            }, 'ghost sm', 'search') : null,
            btn(isSSD ? 'Ottimizza (TRIM)' : 'Deframmenta', async () => {
              status.innerHTML = ''; const p = UI.busyPanel(isSSD ? 'Ottimizzazione SSD in corso…' : 'Deframmentazione in corso… (può richiedere molto tempo)'); status.appendChild(p);
              const r = await UI.run('disks', 'optimize', { letter: d.letter, media: d.media }, p).catch(() => null);
              status.innerHTML = '';
              if (r && r.ok) { UI.toast(`Unità ${d.letter}: ottimizzazione completata`); load(); } else UI.toast('Ottimizzazione non riuscita' + (r ? ` (codice ${r.code})` : ''), 'err');
            }, 'primary sm', 'zap'),
            btn('Controlla errori', async () => {
              status.innerHTML = ''; const p = UI.busyPanel('Controllo del file system…'); status.appendChild(p);
              const r = await UI.run('disks', 'checkErrors', { letter: d.letter }, p).catch(() => null);
              status.innerHTML = '';
              if (!r || !r.ok) { UI.toast('Controllo non riuscito: ' + (r && r.error || ''), 'err'); return; }
              if (/NoErrorsFound/i.test(r.result)) { status.appendChild(h('div', { class: 'notice', html: Icons.get('check') + '<div>Nessun errore trovato sull\'unità.</div>' })); return; }
              status.appendChild(h('div', { class: 'notice warn' }, h('span', { html: Icons.get('alert') }), h('div', null, h('div', null, 'Sono stati rilevati errori sul file system (' + r.result + ').'), btn('Correggi errori', async () => {
                const f = await UI.run('disks', 'fixErrors', { letter: d.letter });
                status.innerHTML = '';
                if (f.ok && f.reboot) status.appendChild(h('div', { class: 'notice warn', html: Icons.get('alert') + '<div>La riparazione verrà eseguita al prossimo riavvio del PC.</div>' }));
                else if (f.ok) UI.toast('Errori corretti');
                else UI.toast('Correzione non riuscita: ' + f.error, 'err');
              }, 'primary sm'))));
            }, 'ghost sm', 'shield')));
        return el;
      }
      load();
    }
  };
})();
