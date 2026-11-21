# NovaTune PC Suite

**[Italiano](#italiano) · [English](#english)**

---

## Italiano

Applicazione desktop per Windows 10 (1809+) e Windows 11 (64 bit) che riunisce in un unico programma:

- ottimizzazione e pulizia del PC
- **Driver Updater**
- un **Uninstaller avanzato**, con rimozione dei residui

Interfaccia in italiano, tema scuro o chiaro. Il programma richiede i privilegi di amministratore.

### Installazione

Scarica l'installer dalla pagina [Releases](../../releases/latest) ed eseguilo (`NovaTune-PC-Suite-Setup-<versione>.exe`): puoi scegliere la cartella e vengono creati i collegamenti sul desktop e nel menu Start.
L'eseguibile non è firmato digitalmente: SmartScreen può mostrare un avviso («Ulteriori informazioni» › «Esegui comunque»).
La disinstallazione (da Impostazioni › App) rimuove anche le attività pianificate e le voci del menu contestuale create dall'app.

### Funzioni

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
| | Pulizia del registro | 10 categorie (DLL condivise, Apri con, software obsoleto, MUI cache, font, App Paths, esecuzione automatica…) |
| | Collegamenti interrotti | Desktop, menu Start, Avvio rapido, Invia a |
| Driver Updater | Aggiornamento driver | Inventario dispositivi, dispositivi con problemi, ricerca driver nel catalogo Windows Update, installazione con punto di ripristino e backup, avanzamento reale di download e installazione per ogni driver |
| | Backup e ripristino | Esportazione con `pnputil`, ripristino, controllo automatico pianificato con notifica |
| Uninstaller | Programmi | Elenco completo, installati di recente, grandi, usati raramente; disinstallazione singola o in blocco, silenziosa, con ricerca e rimozione dei residui (file, registro, servizi, attività) |
| | App di Windows | Rimozione delle app Store / preinstallate |
| | Estensioni browser | Chrome, Edge, Brave, Vivaldi, Opera, Firefox |
| | Disinstallazione forzata | Rimuove programmi danneggiati partendo da cartella o nome |
| | Software Updater | Aggiornamento dei programmi tramite Windows Package Manager (winget), con avanzamento per ogni programma (MB scaricati, velocità, tempo rimanente, fase) e annullamento; installazione di nuovi programmi |
| Strumenti | Distruggi dati | Rapido, casuale, DoD 5220.22-M, Gutmann; cancellazione spazio libero; voce nel menu contestuale |
| | Recupero file | Scansione rapida di NTFS, FAT32 ed exFAT (file eliminati con nome e cartella), scansione profonda per firma (foto, video, documenti, archivi anche dopo una formattazione), anteprima, albero delle cartelle, scansioni salvabili, recupero per cartella/tipo, Desktop e Cestino svuotato con i nomi originali, unità BitLocker |
| | Immagine disco | Copia settore per settore di un'unità (le aree illeggibili vengono riempite con zeri) e recupero da file immagine, anche con più partizioni |
| | Miniature di Windows | Estrae le anteprime di foto e video dalla cache delle miniature, anche di file eliminati |
| | Riparazione file | JPEG (anche con foto di riferimento), PNG, PDF, Word/Excel/PowerPoint, OpenDocument, ZIP |
| Altro | Centro annullamento | Ogni modifica (registro, collegamenti, avvio, sospensione, correzioni, residui) è annullabile; gestione punti di ripristino |
| | Statistiche, Impostazioni | Contatori, grafico spazio liberato, elementi ignorati, temi, conservazione backup |

### Da dove arrivano gli aggiornamenti

- **Driver:** dal catalogo ufficiale **Microsoft Windows Update**, tramite l'interfaccia Windows Update Agent integrata in Windows. Sono driver inviati a Microsoft dai produttori e firmati da Microsoft.
- **Programmi:** da **Windows Package Manager (winget)**. Il catalogo ufficiale (`winget-pkgs`, gestito da Microsoft) indica l'installer originale del produttore e la sua impronta SHA-256; il file viene scaricato dal sito del produttore e verificato prima dell'installazione.

NovaTune non distribuisce software di terze parti.

### Sviluppo

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

---

## English

Desktop application for Windows 10 (1809+) and Windows 11 (64-bit) that brings together in a single program:

- PC optimization and cleanup
- a **Driver Updater**
- an **advanced Uninstaller** that removes leftovers

The user interface is in Italian, with dark and light themes. The program requires administrator privileges.

### Installation

Download the installer from the [Releases](../../releases/latest) page and run it (`NovaTune-PC-Suite-Setup-<version>.exe`). You can choose the install folder; desktop and Start menu shortcuts are created.
The executable is not digitally signed, so SmartScreen may show a warning ("More info" › "Run anyway").
Uninstalling (Settings › Apps) also removes the scheduled tasks and context-menu entries created by the app.

### Features

| Area | Feature | How it works |
|---|---|---|
| Maintenance | One-click scan and cleanup, optionally scheduled (daily/weekly/monthly) | Disk + browser + shortcuts + registry cleanup; scheduling via Windows Task Scheduler |
| Speed up | Sleep Mode | Groups startup entries, services and scheduled tasks by program and disables/re-enables them |
| | Startup programs | Enable/disable like Task Manager (StartupApproved), delete entries with backup |
| | Running processes | CPU/memory per process, end processes |
| | Disk optimization | Fragmentation analysis, HDD defragmentation, SSD TRIM, error check/repair, SMART health |
| Free up space | Disk cleanup | 17 categories (temp, caches, logs, dumps, Windows Update, Windows.old, Recycle Bin, restore points, app caches…) |
| | Browser data | Chrome, Edge, Brave, Vivaldi, Opera, Opera GX, Chromium, Firefox: cache, history, downloads, cookies, sessions, form data, site data |
| | Large and duplicate files | Search folders/drives; duplicates verified with SHA-1 hashes |
| Fix problems | Windows problems | 28 security, Windows and privacy checks (UAC, firewall, antivirus, AutoEndTasks, shutdown timeouts, Windows Update, shares, Remote Desktop, telemetry…) |
| | Registry cleaner | 10 categories (shared DLLs, Open With, obsolete software, MUI cache, fonts, App Paths, autorun…) |
| | Broken shortcuts | Desktop, Start menu, Quick Launch, Send To |
| Driver Updater | Driver updates | Device inventory, devices with problems, driver search in the Windows Update catalog, installation with restore point and backup, real per-driver download/install progress |
| | Backup and restore | Export with `pnputil`, restore, scheduled automatic check with notification |
| Uninstaller | Programs | Full list, recently installed, large, rarely used; single or batch uninstall, silent mode, leftover scan and removal (files, registry, services, tasks) |
| | Windows apps | Remove Store / preinstalled apps |
| | Browser extensions | Chrome, Edge, Brave, Vivaldi, Opera, Firefox |
| | Forced uninstall | Removes broken programs starting from their folder or name |
| | Software Updater | Updates programs through Windows Package Manager (winget) with per-program progress (MB downloaded, speed, time left, phase) and cancel; installs new ones |
| Tools | Data shredder | Quick, random, DoD 5220.22-M, Gutmann; free-space wipe; Explorer context-menu entry |
| | File recovery | Quick scan of NTFS, FAT32 and exFAT (deleted files with name and folder), deep scan by signature (photos, videos, documents, archives, even after a format), preview, folder tree, savable scans, recovery by folder/type, Desktop and emptied Recycle Bin with original names, BitLocker drives |
| | Disk image | Sector-by-sector copy of a drive (unreadable areas filled with zeros) and recovery from image files, including multi-partition disks |
| | Windows thumbnails | Extracts photo/video thumbnails from the Windows thumbnail cache, even of deleted files |
| | File repair | JPEG (optionally with a reference photo), PNG, PDF, Word/Excel/PowerPoint, OpenDocument, ZIP |
| Other | Undo Center | Every change (registry, shortcuts, startup, sleep, fixes, leftovers) can be undone; restore point management |
| | Statistics, Settings | Counters, space-freed chart, ignored items, themes, backup retention |

### Where updates come from

- **Drivers:** from the official **Microsoft Windows Update** catalog, through the Windows Update Agent API built into Windows. These drivers are submitted to Microsoft by hardware manufacturers and signed by Microsoft.
- **Programs:** from **Windows Package Manager (winget)**. The official catalog (`winget-pkgs`, maintained by Microsoft) points to each vendor's original installer and its SHA-256 hash; the file is downloaded from the vendor and verified before installation.

NovaTune does not distribute any third-party software.

### Development

Requirements: Node.js 20+.

```powershell
npm install
npm start          # run in development mode
npm run dist       # build dist\NovaTune-PC-Suite-Setup-<version>.exe
```

Structure:

- `src/main` – Electron main process; `modules/` holds one module per feature, `ps.js` runs PowerShell 5.1 scripts (available on every Windows 10/11)
- `src/renderer` – user interface (framework-free HTML/CSS/JS), one view per section in `views/`
- `scripts/make-icon.js` – generates the icon; `build/` – NSIS installer resources
- User data: `%APPDATA%\NovaTune PC Suite` (settings, statistics, Undo Center backups)
