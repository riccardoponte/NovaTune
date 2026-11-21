// PowerShell bridge: runs Windows PowerShell 5.1 scripts (present on every Windows 10/11)
// Scripts communicate back with lines:  ##P {json}  (progress)   ##R {json}  (result)
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PS_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const PRELUDE = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
function Emit-Progress($obj) { [Console]::Out.WriteLine('##P ' + ($obj | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }
function Emit-Result($obj) { [Console]::Out.WriteLine('##R ' + (ConvertTo-Json -InputObject $obj -Compress -Depth 8)); [Console]::Out.Flush() }
function Get-FolderSize([string]$p) {
  try { $s = 0; $c = 0
    Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object { $s += $_.Length; $c++ }
    return @{ size = [int64]$s; count = $c } } catch { return @{ size = 0; count = 0 } }
}
`;

const running = new Set();

function psQuote(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
}

/**
 * Run a PowerShell script.
 * @param {string} script
 * @param {{onProgress?:Function, timeout?:number, args?:object}} opts  args become $A (hashtable via JSON)
 */
function run(script, opts = {}) {
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), 'novatune_' + crypto.randomBytes(6).toString('hex') + '.ps1');
    let body = PRELUDE;
    if (opts.args !== undefined) {
      const json = JSON.stringify(opts.args);
      body += `$A = ConvertFrom-Json ${psQuote(json)}\n`;
    }
    body += script;
    fs.writeFileSync(file, '\ufeff' + body, 'utf8');
    const child = spawn(PS_EXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
      windowsHide: true
    });
    running.add(child);
    let buf = '';
    let result;
    let stderr = '';
    let raw = '';
    let timer = null;
    if (opts.timeout) timer = setTimeout(() => { try { child.kill(); } catch (e) {} }, opts.timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (line.startsWith('##P ')) {
          if (opts.onProgress) { try { opts.onProgress(JSON.parse(line.slice(4))); } catch (e) {} }
        } else if (line.startsWith('##R ')) {
          try { result = JSON.parse(line.slice(4)); } catch (e) { result = null; }
        } else {
          raw += line + '\n';
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { running.delete(child); clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      running.delete(child);
      clearTimeout(timer);
      if (buf.startsWith('##R ')) { try { result = JSON.parse(buf.slice(4)); } catch (e) {} }
      try { fs.unlinkSync(file); } catch (e) {}
      resolve({ code, result, raw, stderr });
    });
  });
}

/** Run and return the ##R result (throws if missing). */
async function json(script, opts = {}) {
  const r = await run(script, opts);
  if (r.result === undefined) {
    const err = new Error('PowerShell: nessun risultato. ' + (r.stderr || r.raw).slice(0, 800));
    err.details = r;
    throw err;
  }
  return r.result;
}

/** Run an executable and capture output (no shell). */
function exec(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: opts.encoding || 'utf8', timeout: opts.timeout || 0 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '', stderr: stderr || '', error: err });
    });
  });
}

function killAll() {
  for (const c of running) { try { c.kill(); } catch (e) {} }
}

/** Normalise a value that PowerShell may serialise as a single object instead of an array */
function arr(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

module.exports = { run, json, exec, killAll, psQuote, arr, PS_EXE };
