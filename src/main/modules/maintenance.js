// One-click maintenance: junk + browser data + broken shortcuts + registry
const store = require('../store');
const junk = require('./junk');
const browser = require('./browser');
const shortcuts = require('./shortcuts');
const registry = require('./registry');

let last = null;

async function scan(opts = {}, ctx = {}) {
  const items = store.settings().autoMaintenanceItems;
  const res = {};
  const step = (name, base) => (p) => ctx.progress && ctx.progress({ percent: Math.round(base + (p.percent || 0) / 4), label: `${name}: ${p.label || ''}` });
  if (items.junk) res.junk = await junk.scan({}, { progress: step('Pulizia disco', 0) });
  if (items.browser) res.browser = await browser.scan({}, { progress: step('Dati del browser', 25) });
  if (items.shortcuts) { ctx.progress && ctx.progress({ percent: 50, label: 'Collegamenti interrotti…' }); res.shortcuts = await shortcuts.scan({}, {}); }
  if (items.registry) res.registry = await registry.scan({}, { progress: step('Registro', 75) });
  last = { date: new Date().toISOString(), res };
  const summary = {
    date: last.date,
    junk: res.junk ? { size: res.junk.totalSize, count: res.junk.totalCount } : null,
    browser: res.browser ? { size: res.browser.totalSize, count: res.browser.totalCount, running: res.browser.browsers.filter((b) => b.running && b.size).map((b) => b.name) } : null,
    shortcuts: res.shortcuts ? { count: res.shortcuts.count } : null,
    registry: res.registry ? { count: res.registry.count } : null
  };
  const meta = store.load('maintenance', {});
  meta.lastScan = summary;
  store.save('maintenance');
  return summary;
}

async function clean(opts = {}, ctx = {}) {
  const items = store.settings().autoMaintenanceItems;
  const out = {};
  if (items.junk) { ctx.progress && ctx.progress({ percent: 10, label: 'Pulizia dei file inutili…' }); out.junk = await junk.clean({}, {}); }
  if (items.browser) { ctx.progress && ctx.progress({ percent: 40, label: 'Pulizia dei dati del browser…' }); out.browser = await browser.clean({ closeRunning: !!opts.closeBrowsers }, {}); }
  if (items.shortcuts) { ctx.progress && ctx.progress({ percent: 65, label: 'Rimozione dei collegamenti interrotti…' }); out.shortcuts = await shortcuts.clean({}); }
  if (items.registry) { ctx.progress && ctx.progress({ percent: 80, label: 'Pulizia del registro…' }); out.registry = await registry.clean({}); }
  const freed = (out.junk ? out.junk.freed : 0) + (out.browser ? out.browser.freed : 0);
  const meta = store.load('maintenance', {});
  meta.lastRun = { date: new Date().toISOString(), freed, junk: out.junk && out.junk.deleted, browser: out.browser && out.browser.items, shortcuts: out.shortcuts && out.shortcuts.removed, registry: out.registry && out.registry.removed };
  meta.lastScan = null;
  store.save('maintenance');
  store.addStat('maintenanceRuns', 1);
  return meta.lastRun;
}

function status() { return store.load('maintenance', {}); }

module.exports = { scan, clean, status };
