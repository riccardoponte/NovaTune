// Generates build/icon.ico and src/renderer/assets/icon.png procedurally (no external tools)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const hh = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay));
  return Math.hypot(pax - bax * hh, pay - bay * hh);
}

function draw(S) {
  const buf = Buffer.alloc(S * S * 4);
  const aa = 1.0;
  // pulse line (normalised coords 0..1)
  const pts = [[0.18, 0.56], [0.36, 0.56], [0.45, 0.33], [0.56, 0.74], [0.65, 0.47], [0.82, 0.47]];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5, py = y + 0.5;
      // background rounded square
      const d = sdRoundRect(px, py, S / 2, S / 2, S * 0.46, S * 0.46, S * 0.22);
      let a = clamp(0.5 - d / aa);
      if (a <= 0) continue;
      const t = clamp((px + py) / (2 * S));
      // gradient #3b82f6 -> #8b5cf6, with a soft top highlight
      let r = 0x3b + (0x8b - 0x3b) * t, g = 0x82 + (0x5c - 0x82) * t, b = 0xf6 + (0xf6 - 0xf6) * t;
      const hl = clamp(1 - py / (S * 0.55)) * 0.18;
      r += (255 - r) * hl; g += (255 - g) * hl; b += (255 - b) * hl;
      // ring
      const cx = S / 2, cy = S / 2;
      const ringD = Math.abs(Math.hypot(px - cx, py - cy) - S * 0.33) - S * 0.022;
      const ringA = clamp(0.5 - ringD / aa) * 0.35;
      r += (255 - r) * ringA; g += (255 - g) * ringA; b += (255 - b) * ringA;
      // pulse stroke
      let sd = 1e9;
      for (let i = 0; i < pts.length - 1; i++) sd = Math.min(sd, sdSegment(px / S, py / S, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) * S);
      const lw = S * 0.05;
      const la = clamp(0.5 - (sd - lw / 2) / aa);
      r += (255 - r) * la; g += (255 - g) * la; b += (255 - b) * la;
      const o = (y * S + x) * 4;
      buf[o] = Math.round(r); buf[o + 1] = Math.round(g); buf[o + 2] = Math.round(b); buf[o + 3] = Math.round(a * 255);
    }
  }
  return png(S, S, buf);
}

function ico(images) {
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;
  images.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size; dir[o + 1] = size >= 256 ? 0 : size; dir[o + 2] = 0; dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.mkdirSync(path.join(root, 'src', 'renderer', 'assets'), { recursive: true });
const sizes = [256, 128, 64, 48, 32, 24, 16];
const imgs = sizes.map((s) => ({ size: s, data: draw(s) }));
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(imgs));
fs.writeFileSync(path.join(root, 'build', 'icon.png'), imgs[0].data);
fs.writeFileSync(path.join(root, 'src', 'renderer', 'assets', 'icon.png'), imgs[0].data);
console.log('Icons generated.');
