// Simple JSON persistence in %APPDATA%\NovaTune PC Suite
const fs = require('fs');
const path = require('path');

let baseDir = null;
const cache = {};

function init(dir) {
  baseDir = dir;
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'backups'), { recursive: true });
}

function dir(...p) { return path.join(baseDir, ...p); }

function load(name, def) {
  if (cache[name]) return cache[name];
  const f = dir(name + '.json');
  let v = def;
  try { v = Object.assign(Array.isArray(def) ? [] : {}, def, JSON.parse(fs.readFileSync(f, 'utf8'))); }
  catch (e) { v = JSON.parse(JSON.stringify(def)); }
  if (Array.isArray(def)) { try { v = JSON.parse(fs.readFileSync(f, 'utf8')); if (!Array.isArray(v)) v = []; } catch (e) { v = []; } }
  cache[name] = v;
  return v;
}

function save(name, value) {
  if (value !== undefined) cache[name] = value;
  const f = dir(name + '.json');
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache[name], null, 2), 'utf8');
  fs.renameSync(tmp, f);
}

const DEFAULT_SETTINGS = {
  theme: 'dark',
  autoMaintenance: { enabled: false, frequency: 'weekly', day: 1, time: '12:00' },
  autoMaintenanceItems: { junk: true, browser: true, shortcuts: true, registry: true },
  junkLevel: 'full',              // basic | full | custom
  junkCategories: null,           // custom selection
  browserLevel: 'basic',
  browserCategories: null,
  keepCookies: true,
  shredAlgorithm: 'dod',          // quick | random | dod | gutmann
  shredPasses: 1,
  undoRetentionDays: 30,          // 7 | 14 | 30 | 0 (never delete)
  createRestorePoint: true,
  contextMenuShredder: false,
  ignored: { junk: [], browser: [], shortcuts: [], registry: [], fixes: [], drivers: [], software: [] },
  driverScanSchedule: 'off',
  softwareAutoUpdate: false,
  uninstallerDeepScan: true,
  minimizeToTray: false,
  startWithWindows: false
};

const DEFAULT_STATS = {
  maintenanceRuns: 0,
  spaceFreed: 0,
  junkItems: 0,
  browserItems: 0,
  registryItems: 0,
  shortcutsRemoved: 0,
  programsUninstalled: 0,
  leftoversRemoved: 0,
  programsUpdated: 0,
  driversUpdated: 0,
  filesShredded: 0,
  filesRecovered: 0,
  defragRuns: 0,
  problemsFixed: 0,
  programsSleeping: 0,
  history: []   // {date, type, items, bytes}
};

function settings() { return load('settings', DEFAULT_SETTINGS); }
function stats() { return load('stats', DEFAULT_STATS); }

function addStat(key, n = 1, historyEntry) {
  const s = stats();
  s[key] = (s[key] || 0) + n;
  if (historyEntry) {
    s.history.push(Object.assign({ date: new Date().toISOString() }, historyEntry));
    if (s.history.length > 500) s.history.splice(0, s.history.length - 500);
  }
  save('stats');
}

module.exports = { init, dir, load, save, settings, stats, addStat, DEFAULT_SETTINGS };
