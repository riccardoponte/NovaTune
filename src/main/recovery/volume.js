// Raw access to a volume: a drive letter (\\.\X:) or a disk image file (.img/.dd/.raw/.bin).
// All offsets are relative to the start of the file system (partition), "base" is added internally.
const fs = require('fs');

const SECTOR = 512;

class Volume {
  /**
   * @param {{letter?:string, image?:string, partitionOffset?:number}} src
   */
  constructor(src) {
    this.src = src;
    this.isImage = !!src.image;
    this.path = src.image || (src.physical != null ? `\\\\.\\PhysicalDrive${src.physical}` : `\\\\.\\${String(src.letter).toUpperCase()}:`);
    this.label = src.image || `${String(src.letter).toUpperCase()}:`;
    this.fd = fs.openSync(this.path, 'r');
    this.base = src.partitionOffset || 0;
    this.sectorSize = SECTOR;
    this.size = 0;
    if (this.isImage) this.size = fs.fstatSync(this.fd).size - this.base;
  }

  close() { if (this.fd != null) { try { fs.closeSync(this.fd); } catch (e) {} this.fd = null; } }

  /**
   * Opens a volume, falling back to the physical disk when Windows refuses direct reads of the
   * volume (this happens with the system drive on some Windows 11 builds / storage drivers).
   */
  static async open(src) {
    const v = new Volume(src);
    if (v.isImage) return v;
    try { v.read(0, 512); return v; } catch (e) {
      if (!['ENOTSUP', 'EPERM', 'EACCES', 'EIO', 'EINVAL', 'UNKNOWN'].includes(e.code)) throw e;
    }
    v.close();
    const ps = require('../ps');
    const p = await ps.json(`$p = Get-Partition -DriveLetter $A.l -ErrorAction Stop; Emit-Result @{ disk = [int]$p.DiskNumber; offset = [int64]$p.Offset; size = [int64]$p.Size }`, { args: { l: src.letter } });
    if (!p || p.disk == null) throw new Error(`Impossibile leggere l'unità ${src.letter}: in modo diretto`);
    const pv = new Volume({ letter: src.letter, physical: p.disk, partitionOffset: p.offset });
    pv.size = p.size;
    const head = pv.read(0, 512);
    if (head.toString('latin1', 3, 11) === '-FVE-FS-') { pv.close(); throw new Error(`L'unità ${src.letter}: è crittografata con BitLocker e Windows non consente di leggerla direttamente. Il recupero non è possibile su questa unità.`); }
    pv.viaPhysical = true;
    return pv;
  }

  _align(offset, length) {
    const ss = this.sectorSize || SECTOR;
    const abs = this.base + offset;
    const start = Math.floor(abs / ss) * ss;
    const end = Math.ceil((abs + length) / ss) * ss;
    return { start, end, skip: abs - start };
  }

  /** Synchronous read (used for small metadata reads). Returns a Buffer of `length` bytes (zero-filled past the end). */
  read(offset, length) {
    const { start, end, skip } = this._align(offset, length);
    const buf = Buffer.alloc(end - start);
    let got = 0;
    while (got < buf.length) {
      let n = 0;
      try { n = fs.readSync(this.fd, buf, got, buf.length - got, start + got); } catch (e) { if (got === 0) throw e; break; }
      if (n <= 0) break;
      got += n;
    }
    return buf.subarray(skip, skip + length);
  }

  /** Asynchronous read. Bad sectors are returned as zeros when `tolerant` is set. */
  readAsync(offset, length, tolerant) {
    const { start, end, skip } = this._align(offset, length);
    const buf = Buffer.alloc(end - start);
    return new Promise((resolve, reject) => {
      let got = 0;
      const step = () => {
        if (got >= buf.length) return resolve(buf.subarray(skip, skip + length));
        fs.read(this.fd, buf, got, buf.length - got, start + got, (err, n) => {
          if (err) {
            if (!tolerant) return reject(err);
            // skip one sector and continue (leaves zeros)
            got += this.sectorSize;
            return step();
          }
          if (n <= 0) return resolve(buf.subarray(skip, skip + length));
          got += n;
          step();
        });
      };
      step();
    });
  }
}

/** For disk images: find the file system inside (whole-disk images have an MBR/GPT partition table). */
function detectPartitions(imagePath) {
  const fd = fs.openSync(imagePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const s0 = Buffer.alloc(1024);
    fs.readSync(fd, s0, 0, 1024, 0);
    const fsType = (b) => {
      if (b.toString('ascii', 3, 11) === 'NTFS    ') return 'NTFS';
      if (b.toString('ascii', 3, 11) === 'EXFAT   ') return 'exFAT';
      if (b.toString('ascii', 82, 87) === 'FAT32') return 'FAT32';
      if (b.toString('ascii', 54, 59) === 'FAT16' || b.toString('ascii', 54, 59) === 'FAT12') return 'FAT16';
      return null;
    };
    const direct = fsType(s0);
    if (direct) return [{ offset: 0, size, fs: direct, label: 'Volume' }];
    const parts = [];
    if (s0[510] === 0x55 && s0[511] === 0xAA) {
      const isGpt = s0[450] === 0xEE;
      if (isGpt) {
        const hdr = Buffer.alloc(512); fs.readSync(fd, hdr, 0, 512, 512);
        if (hdr.toString('ascii', 0, 8) === 'EFI PART') {
          const lba = Number(hdr.readBigUInt64LE(72)), count = hdr.readUInt32LE(80), esz = hdr.readUInt32LE(84);
          const tbl = Buffer.alloc(Math.min(count, 128) * esz); fs.readSync(fd, tbl, 0, tbl.length, lba * 512);
          for (let i = 0; i < Math.min(count, 128); i++) {
            const e = tbl.subarray(i * esz, (i + 1) * esz);
            const first = Number(e.readBigUInt64LE(32)), last = Number(e.readBigUInt64LE(40));
            if (!first) continue;
            const name = e.toString('utf16le', 56, 128).replace(/\0.*$/, '');
            parts.push({ offset: first * 512, size: (last - first + 1) * 512, label: name || `Partizione ${i + 1}` });
          }
        }
      } else {
        for (let i = 0; i < 4; i++) {
          const e = s0.subarray(446 + i * 16, 462 + i * 16);
          const type = e[4], lba = e.readUInt32LE(8), cnt = e.readUInt32LE(12);
          if (!type || !cnt) continue;
          parts.push({ offset: lba * 512, size: cnt * 512, label: `Partizione ${i + 1}` });
        }
      }
    }
    for (const p of parts) {
      const b = Buffer.alloc(1024);
      try { fs.readSync(fd, b, 0, 1024, p.offset); p.fs = fsType(b) || 'Sconosciuto'; } catch (e) { p.fs = 'Sconosciuto'; }
    }
    if (!parts.length) parts.push({ offset: 0, size, fs: 'Sconosciuto', label: 'Immagine' });
    return parts;
  } finally { fs.closeSync(fd); }
}

/** Identify the file system at the start of the volume */
function detectFs(vol) {
  const b = vol.read(0, 512);
  if (b.toString('ascii', 3, 11) === 'NTFS    ') return 'NTFS';
  if (b.toString('ascii', 3, 11) === 'EXFAT   ') return 'exFAT';
  if (b.toString('ascii', 82, 87) === 'FAT32') return 'FAT32';
  if (/FAT1[26]/.test(b.toString('ascii', 54, 59))) return 'FAT16';
  return 'RAW';
}

module.exports = { Volume, detectPartitions, detectFs };
