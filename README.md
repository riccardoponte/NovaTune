# NovaTune PC Suite

Applicazione desktop per Windows 10 (1809+) e Windows 11 (64 bit) che riunisce in un unico programma:

- le funzioni di ottimizzazione di **AVG TuneUp**
- **Driver Updater**
- un **Uninstaller avanzato** (stile IObit Uninstaller)

Interfaccia in italiano, tema scuro/chiaro. Il programma richiede i privilegi di amministratore, come gli originali.

## Installazione

Scarica l'installer dalla pagina [Releases](../../releases/latest) ed eseguilo (`NovaTune-PC-Suite-Setup-1.0.0.exe`): puoi scegliere la cartella e vengono creati i collegamenti sul desktop e nel menu Start.
La disinstallazione (da Impostazioni › App) rimuove anche le attività pianificate e le voci del menu contestuale create dall'app.

## Funzioni

| Area | Funzione | Come funziona |
|---|---|---|
| Manutenzione | Analisi e pulizia con un clic, anche pianificata (giornaliera/settimanale/mensile) | Pulizia disco + browser + collegamenti + registro; pianificazione tramite Utilità di pianificazione |
| Velocizza | Modalità sospensione | Raggruppa per programma avvio automatico, servizi e attività pianificate e li disattiva/riattiva |
| | Programmi all'avvio | Attiva/disattiva come Gestione attività (StartupApproved), elimina voci con backup |
| | Processi attivi | CPU/memoria per processo, chiusura dei processi |
| | Ottimizzazione dischi | Analisi frammentazione, deframmentazione HDD, TRIM per SSD, controllo/correzione errori, salute SMART |
| Libera spazio | Pulizia disco | 17 categorie (temp, cache, log, dump, Windows Update, Windows.old, cestino, punti di ripristino, cache app…) |
| | Dati del browser | Chrome, Edge, Brave, Vivaldi, Opera, Opera GX, Chromium, Firefox: cache, cronologia, download, cookie, sessioni, moduli, dati dei siti |
| | File grandi e duplicati | Ricerca su cartelle/unità, duplicati verificati con hash SHA-1 |
| Risolvi problemi | Problemi di Windows | 28 controlli su sicurezza, Windows e privacy (UAC, firewall, antivirus, AutoEndTasks, tempi di arresto, Windows Update, condivisioni, Desktop remoto, telemetria…) |
| | Pulizia del registro | 10 categorie come TuneUp (DLL condivise, Apri con, software obsoleto, MUI cache, font, App Paths, esecuzione automatica…) |
| | Collegamenti interrotti | Desktop, menu Start, Avvio rapido, Invia a |
| Driver Updater | Aggiornamento driver | Inventario dispositivi, dispositivi con problemi, ricerca driver nel catalogo Windows Update, installazione con punto di ripristino e backup |
| | Backup e ripristino | Esportazione con `pnputil`, ripristino, controllo automatico pianificato con notifica |
| Uninstaller | Programmi | Elenco completo, installati di recente, grandi, usati raramente; disinstallazione singola o in blocco, silenziosa, con ricerca e rimozione dei residui (file, registro, servizi, attività) |
| | App di Windows | Rimozione delle app Store / preinstallate |
| | Estensioni browser | Chrome, Edge, Brave, Vivaldi, Opera, Firefox |
| | Disinstallazione forzata | Rimuove programmi danneggiati partendo da cartella o nome |
| | Software Updater | Aggiornamento dei programmi tramite Windows Package Manager (winget) e installazione di nuovi programmi |
| Strumenti | Distruggi dati | Rapido, casuale, DoD 5220.22-M, Gutmann; cancellazione spazio libero; voce nel menu contestuale |
| | Recupero file | Lettura diretta della MFT NTFS, stima della probabilità di recupero, recupero dal Cestino |
| Altro | Centro annullamento | Ogni modifica (registro, collegamenti, avvio, sospensione, correzioni, residui) è annullabile; gestione punti di ripristino |
| | Statistiche, Impostazioni | Contatori, grafico spazio liberato, elementi ignorati, temi, conservazione backup |

Non replicata: **Cloud Cleaner** di TuneUp (richiede chiavi API registrate presso Google/Microsoft/Dropbox).

## Sviluppo

Requisiti: Node.js 20+.

```powershell
npm install
npm start          # avvia in modalità sviluppo
npm run dist       # crea dist\NovaTune-PC-Suite-Setup-<versione>.exe
```

Struttura:

- `src/main` – processo principale Electron; `modules/` contiene un modulo per funzione, `ps.js` esegue script PowerShell 5.1 (presente su ogni Windows 10/11)
- `src/renderer` – interfaccia (HTML/CSS/JS senza framework), una vista per sezione in `views/`
- `scripts/make-icon.js` – genera l'icona; `build/` – risorse dell'installer NSIS
- Dati utente: `%APPDATA%\NovaTune PC Suite` (impostazioni, statistiche, backup del Centro annullamento)
