// Tiny UI toolkit (no framework)
(function () {
  const Views = {};
  window.Views = Views;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'checked' || k === 'disabled' || k === 'value' || k === 'selected') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }

  function bytes(n) {
    if (!n || n < 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0).replace('.', ',') + ' ' + u[i];
  }
  function num(n) { return Number(n || 0).toLocaleString('it-IT'); }
  function date(d, withTime) {
    if (!d) return '—';
    const x = new Date(d);
    if (isNaN(x)) return '—';
    return withTime ? x.toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : x.toLocaleDateString('it-IT', { dateStyle: 'medium' });
  }
  function ago(d) {
    if (!d) return 'mai';
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return 'pochi secondi fa';
    if (s < 3600) return Math.floor(s / 60) + ' min fa';
    if (s < 86400) return Math.floor(s / 3600) + ' ore fa';
    const g = Math.floor(s / 86400);
    return g === 1 ? 'ieri' : g + ' giorni fa';
  }

  function toast(msg, type = 'ok', ms = 4500) {
    const t = h('div', { class: 'toast ' + type }, h('span', { class: 'toast-ic', html: Icons.get(type === 'err' ? 'alert' : type === 'warn' ? 'alert' : 'check') }), h('span', null, msg));
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
  }

  function modal({ title, body, actions = [], wide = false, onClose }) {
    const root = document.getElementById('modal-root');
    const close = () => { wrap.remove(); onClose && onClose(); };
    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) close(); } },
      h('div', { class: 'modal' + (wide ? ' wide' : '') },
        h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'icon-btn', onclick: close, html: Icons.get('x') })),
        h('div', { class: 'modal-body' }, body),
        actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', { class: 'btn ' + (a.kind || ''), onclick: async () => { const r = a.onClick ? await a.onClick() : true; if (r !== false) close(); } }, a.label))) : null));
    root.appendChild(wrap);
    return { close };
  }

  function confirmBox(title, text, okLabel = 'Conferma', kind = 'primary') {
    return new Promise((res) => {
      modal({ title, body: h('p', { class: 'muted' }, text), onClose: () => res(false), actions: [{ label: 'Annulla', kind: 'ghost', onClick: () => res(false) }, { label: okLabel, kind, onClick: () => res(true) }] });
    });
  }

  // progress listeners
  const progressSubs = new Set();
  function onProgress(fn) { progressSubs.add(fn); return () => progressSubs.delete(fn); }
  window.api && window.api.on('progress', (p) => progressSubs.forEach((f) => f(p)));

  /** Run a backend call with a busy panel bound to an element */
  async function run(mod, fn, args, panel) {
    let off = null;
    if (panel) {
      panel.set({ percent: 0, label: 'Avvio…' });
      off = onProgress((p) => { if (p.mod === mod && p.fn === fn) panel.set(p); });
    }
    try { return await window.api.call(mod, fn, args); }
    catch (e) { toast(cleanErr(e), 'err', 7000); throw e; }
    finally { off && off(); }
  }
  function cleanErr(e) { return String(e && e.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, ''); }

  function busyPanel(title) {
    const bar = h('div', { class: 'bar-fill' });
    const lbl = h('div', { class: 'busy-label' }, 'Avvio…');
    const pct = h('div', { class: 'busy-pct' }, '');
    const el = h('div', { class: 'busy' },
      h('div', { class: 'spinner' }),
      h('div', { class: 'busy-title' }, title),
      lbl, h('div', { class: 'bar' }, bar), pct);
    el.set = (p) => {
      if (p.label) lbl.textContent = p.label;
      if (typeof p.percent === 'number' && p.percent < 0) { bar.style.width = '100%'; bar.style.opacity = '.35'; pct.textContent = ''; }
      else if (typeof p.percent === 'number') { bar.style.opacity = '1'; bar.style.width = Math.max(2, Math.min(100, p.percent)) + '%'; pct.textContent = p.percent + '%'; }
    };
    return el;
  }

  function pageHeader(title, subtitle, right) {
    return h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null), right ? h('div', { class: 'page-head-right' }, right) : null);
  }

  function btn(label, onClick, kind = 'primary', icon) {
    return h('button', { class: 'btn ' + kind, onclick: onClick }, icon ? h('span', { class: 'btn-ic', html: Icons.get(icon) }) : null, label);
  }

  function toggle(checked, onChange, disabled) {
    const i = h('input', { type: 'checkbox', checked: !!checked, disabled: !!disabled, onchange: (e) => onChange(e.target.checked) });
    return h('label', { class: 'switch' }, i, h('span', { class: 'slider' }));
  }

  function checkbox(checked, onChange) {
    return h('input', { type: 'checkbox', class: 'chk', checked: !!checked, onchange: (e) => onChange(e.target.checked) });
  }

  function empty(icon, title, text, action) {
    return h('div', { class: 'empty' }, h('div', { class: 'empty-ic', html: Icons.get(icon) }), h('h3', null, title), text ? h('p', { class: 'muted' }, text) : null, action || null);
  }

  function tabs(items, active, onSelect) {
    return h('div', { class: 'tabs' }, items.map((t) => h('button', { class: 'tab' + (t.id === active ? ' active' : ''), onclick: () => onSelect(t.id) }, t.label, t.badge ? h('span', { class: 'badge' }, t.badge) : null)));
  }

  function ring(percent, label, sub, color) {
    const r = 54, c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(100, percent)) / 100);
    return h('div', { class: 'ring', html: `<svg viewBox="0 0 128 128"><circle cx="64" cy="64" r="${r}" class="ring-bg"/><circle cx="64" cy="64" r="${r}" class="ring-fg" style="stroke:${color || 'var(--accent)'};stroke-dasharray:${c};stroke-dashoffset:${off}"/></svg><div class="ring-txt"><b>${label}</b><span>${sub || ''}</span></div>` });
  }

  function chanceTag(c) {
    const map = { excellent: ['Ottima', 'ok'], average: ['Media', 'warn'], poor: ['Scarsa', 'err'], none: ['Nessuna', 'err'] };
    const [t, k] = map[c] || ['—', ''];
    return h('span', { class: 'tag ' + k }, t);
  }

  function impactTag(i) {
    const map = { high: ['Alto', 'err'], medium: ['Medio', 'warn'], low: ['Basso', 'ok'], none: ['Nessuno', ''] };
    const [t, k] = map[i] || ['—', ''];
    return h('span', { class: 'tag ' + k }, t);
  }

  function search(placeholder, onInput) {
    return h('div', { class: 'search' }, h('span', { html: Icons.get('search') }), h('input', { type: 'search', placeholder, oninput: (e) => onInput(e.target.value.toLowerCase()) }));
  }

  /** Simple sortable table. cols: [{key,label,render?,sort?,width?}] */
  function table(cols, rows, opts = {}) {
    let sortKey = opts.sortKey || null, dir = opts.sortDir || 1;
    const tbody = h('tbody');
    const thead = h('thead');
    const tableEl = h('table', { class: 'tbl' }, thead, tbody);
    function render() {
      thead.innerHTML = '';
      thead.appendChild(h('tr', null, cols.map((c) => h('th', { style: c.width ? { width: c.width } : null, class: c.sort !== false && c.key ? 'sortable' + (sortKey === c.key ? ' sorted' : '') : '', onclick: () => { if (c.sort === false || !c.key) return; if (sortKey === c.key) dir = -dir; else { sortKey = c.key; dir = 1; } render(); } }, typeof c.label === 'function' ? c.label() : c.label, sortKey === c.key ? (dir > 0 ? ' ▲' : ' ▼') : ''))));
      let rs = rows.slice();
      if (sortKey) {
        const col = cols.find((c) => c.key === sortKey);
        const val = col && col.sortValue ? col.sortValue : (r) => r[sortKey];
        rs.sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'it', { numeric: true })) * dir; });
      }
      tbody.innerHTML = '';
      const limit = opts.limit || 2000;
      for (const r of rs.slice(0, limit)) {
        tbody.appendChild(h('tr', { class: opts.rowClass ? opts.rowClass(r) : '', onclick: opts.onRow ? (e) => { if (e.target.closest('input,button,a,label')) return; opts.onRow(r); } : null }, cols.map((c) => h('td', { class: c.cls || '' }, c.render ? c.render(r) : (r[c.key] == null ? '' : String(r[c.key]))))));
      }
      if (rs.length > limit) tbody.appendChild(h('tr', null, h('td', { colspan: cols.length, class: 'muted center' }, `Mostrati ${limit} di ${num(rs.length)} elementi. Usa la ricerca o i filtri per restringere i risultati.`)));
    }
    render();
    tableEl.update = (newRows) => { rows = newRows; render(); };
    return h('div', { class: 'tbl-wrap' }, tableEl);
  }

  window.UI = { h, add, bytes, num, date, ago, toast, modal, confirmBox, run, busyPanel, pageHeader, btn, toggle, checkbox, empty, tabs, ring, chanceTag, impactTag, search, table, onProgress, cleanErr, Views };
})();
