(function () {
  const { h, btn, toggle } = UI;
  UI.Views.settings = {
    render(root, params) {
      let tab = params.tab || 'general';
      const tabsSlot = h('div'), body = h('div');
      root.appendChild(UI.pageHeader('Impostazioni', 'Personalizza il funzionamento di NovaTune PC Suite.'));
      root.appendChild(tabsSlot); root.appendChild(body);
      const S = () => App.settings;
      const set = async (patch) => { App.settings = await api.setSettings(patch); };
      function drawTabs() { tabsSlot.innerHTML = ''; tabsSlot.appendChild(UI.tabs([{ id: 'general', label: 'Generale' }, { id: 'maintenance', label: 'Manutenzione automatica' }, { id: 'cleaning', label: 'Pulizia' }, { id: 'drivers', label: 'Driver e software' }, { id: 'tools', label: 'Strumenti' }, { id: 'ignored', label: 'Elementi ignorati' }, { id: 'about', label: 'Informazioni' }], tab, (t) => { tab = t; drawTabs(); render(); })); }
      const row = (title, desc, control) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, title), desc ? h('div', { class: 'd' }, desc) : null), control);
      const select = (value, options, onChange) => h('select', { class: 'input', onchange: (e) => onChange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
      function render() {
        body.innerHTML = '';
        const s = S();
        if (tab === 'general') {
          body.appendChild(h('div', { class: 'list' },
            row('Tema', 'Aspetto dell\'interfaccia', select(s.theme, [['dark', 'Scuro'], ['light', 'Chiaro'], ['system', 'Come il sistema']], async (v) => { await set({ theme: v }); App.applyTheme(v); })),
            row('Avvia con Windows', 'Avvia NovaTune ridotto nell\'area di notifica all\'accesso', toggle(s.startWithWindows, (v) => set({ startWithWindows: v }))),
            row('Riduci nell\'area di notifica alla chiusura', 'Chiudendo la finestra, NovaTune resta attivo nell\'area di notifica', toggle(s.minimizeToTray, (v) => set({ minimizeToTray: v }))),
            row('Crea punti di ripristino', 'Crea automaticamente un punto di ripristino di Windows prima di aggiornare driver e disinstallare programmi', toggle(s.createRestorePoint, (v) => set({ createRestorePoint: v }))),
            row('Conservazione dei backup', 'Per quanto tempo il Centro annullamento conserva i backup', select(s.undoRetentionDays, [[7, '1 settimana'], [14, '2 settimane'], [30, '1 mese'], [0, 'Per sempre']], (v) => set({ undoRetentionDays: +v })))));
          body.appendChild(h('div', { class: 'row mt' }, btn('Ripristina impostazioni predefinite', async () => { if (await UI.confirmBox('Ripristinare le impostazioni?', 'Tutte le impostazioni torneranno ai valori predefiniti.', 'Ripristina')) { App.settings = await api.resetSettings(); App.applyTheme(App.settings.theme); render(); } }, 'ghost')));
        } else if (tab === 'maintenance') {
          const am = Object.assign({}, s.autoMaintenance);
          const it = Object.assign({}, s.autoMaintenanceItems);
          const days = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
          body.appendChild(h('div', { class: 'list' },
            row('Manutenzione automatica', 'Esegue la manutenzione in background tramite l\'Utilità di pianificazione di Windows', toggle(am.enabled, async (v) => { am.enabled = v; await set({ autoMaintenance: am }); render(); })),
            row('Frequenza', '', select(am.frequency, [['daily', 'Ogni giorno'], ['weekly', 'Ogni settimana'], ['monthly', 'Ogni mese']], async (v) => { am.frequency = v; await set({ autoMaintenance: am }); render(); })),
            am.frequency !== 'daily' ? row('Giorno', '', select(am.day, days.map((d, i) => [i, d]), (v) => { am.day = +v; set({ autoMaintenance: am }); })) : null,
            row('Ora', 'Se il PC è spento a quell\'ora, la manutenzione verrà eseguita appena possibile', h('input', { type: 'time', class: 'input', value: am.time, onchange: (e) => { am.time = e.target.value; set({ autoMaintenance: am }); } }))));
          body.appendChild(h('h3', { class: 'mt2' }, 'Elementi inclusi nella manutenzione'));
          body.appendChild(h('div', { class: 'list mt' },
            [['junk', 'File inutili di sistema e delle app'], ['browser', 'Dati del browser'], ['shortcuts', 'Collegamenti interrotti'], ['registry', 'Problemi del registro']].map(([k, l]) => row(l, '', toggle(it[k], (v) => { it[k] = v; set({ autoMaintenanceItems: it }); })))));
        } else if (tab === 'cleaning') {
          body.appendChild(h('div', { class: 'list' },
            row('Livello di pulizia del disco', 'Quali categorie di file inutili selezionare automaticamente', select(s.junkLevel, [['basic', 'Pulizia di base'], ['full', 'Pulizia completa'], ['custom', 'Personalizzata']], (v) => set({ junkLevel: v }))),
            row('Livello di pulizia del browser', '', select(s.browserLevel, [['basic', 'Solo cache'], ['full', 'Cache, cronologia e download'], ['custom', 'Personalizzata']], (v) => set({ browserLevel: v }))),
            row('Mantieni i cookie', 'Non eliminare i cookie durante la pulizia completa, così resti connesso ai siti', toggle(s.keepCookies, (v) => set({ keepCookies: v })))));
        } else if (tab === 'drivers') {
          body.appendChild(h('div', { class: 'list' },
            row('Controllo automatico dei driver', 'Ricerca periodicamente driver aggiornati e mostra una notifica', select(s.driverScanSchedule, [['off', 'Disattivato'], ['daily', 'Ogni giorno'], ['weekly', 'Ogni settimana']], (v) => set({ driverScanSchedule: v }))),
            row('Cartella di backup dei driver', 'Documenti\\NovaTune Driver Backup', btn('Apri', async () => { const l = await api.call('drivers', 'listBackups'); api.open(l[0] ? l[0].dir.replace(/\\[^\\]+$/, '') : ''); }, 'ghost sm')),
            row('Ricerca approfondita dei residui', 'Dopo ogni disinstallazione cerca file, cartelle, chiavi di registro, servizi e attività residui', toggle(s.uninstallerDeepScan, (v) => set({ uninstallerDeepScan: v })))));
        } else if (tab === 'tools') {
          body.appendChild(h('div', { class: 'list' },
            row('Metodo predefinito di distruzione', '', select(s.shredAlgorithm, [['quick', 'Rapido (1 passaggio)'], ['random', 'Dati casuali'], ['dod', 'DoD 5220.22-M (3 passaggi)'], ['gutmann', 'Gutmann (35 passaggi)']], (v) => set({ shredAlgorithm: v }))),
            row('Passaggi per "Dati casuali"', '', select(s.shredPasses, [[1, '1'], [3, '3'], [7, '7']], (v) => set({ shredPasses: +v }))),
            row('Menu contestuale di Esplora file', 'Aggiunge "Distruggi definitivamente con NovaTune" al clic destro su file e cartelle', toggle(s.contextMenuShredder, (v) => set({ contextMenuShredder: v })))));
        } else if (tab === 'ignored') {
          const ig = s.ignored;
          const names = { junk: 'Pulizia disco', browser: 'Browser', shortcuts: 'Collegamenti', registry: 'Registro', fixes: 'Problemi di Windows', drivers: 'Driver', software: 'Software' };
          const all = Object.entries(ig).flatMap(([k, arr]) => (arr || []).map((v) => ({ k, v })));
          if (!all.length) { body.appendChild(UI.empty('check', 'Nessun elemento ignorato', 'Gli elementi che scegli di ignorare durante le scansioni compariranno qui.')); return; }
          body.appendChild(h('div', { class: 'list' }, all.map(({ k, v }) => h('div', { class: 'item' }, h('span', { class: 'tag' }, names[k] || k), h('div', { class: 'grow d mono sel', style: { color: 'var(--text)' } }, v), btn('Rimuovi', async () => { await UI.ignore(k, v, false); render(); }, 'ghost sm')))));
        } else if (tab === 'about') {
          body.appendChild(h('div', { class: 'card' }, h('div', { class: 'row' }, h('img', { src: 'assets/icon.png', style: { width: '64px', height: '64px' } }), h('div', null, h('h2', { style: { margin: 0 } }, 'NovaTune PC Suite'), h('div', { class: 'muted' }, 'Versione ' + App.info.version))),
            h('p', { class: 'muted mt' }, 'Ottimizzazione del PC, aggiornamento driver e disinstallazione avanzata per Windows 10 e Windows 11.'),
            h('div', { class: 'kv mt' }, h('div', null, 'Dati dell\'applicazione'), h('div', { class: 'mono sel' }, App.info.userData), h('div', null, 'Privilegi'), h('div', null, App.isAdmin ? 'Amministratore' : 'Utente standard')),
            h('div', { class: 'row mt' }, btn('Apri cartella dati', () => api.open(App.info.userData), 'ghost sm', 'folder'))));
        }
      }
      drawTabs(); render();
    }
  };
})();
