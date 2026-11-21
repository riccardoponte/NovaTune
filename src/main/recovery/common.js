// Helpers shared by the recovery scanners

const TYPES = {
  image: /\.(jpe?g|jfif|png|gif|bmp|tiff?|webp|heic|heif|avif|raw|cr2|cr3|nef|arw|dng|orf|rw2|raf|psd|svg|ico)$/i,
  document: /\.(docx?|xlsx?|pptx?|pdf|txt|rtf|odt|ods|odp|csv|md|xml|json|html?|eml|msg|pub|one|epub)$/i,
  video: /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpe?g|3gp|ts|mts|m2ts)$/i,
  music: /\.(mp3|wav|flac|aac|ogg|wma|m4a|opus|aiff?)$/i,
  archive: /\.(zip|rar|7z|tar|gz|bz2|xz|iso|cab)$/i
};

function typeOf(name) {
  for (const [k, re] of Object.entries(TYPES)) if (re.test(name)) return k;
  return 'other';
}

/** DOS date/time (FAT) -> ms */
function dosTime(date, time) {
  if (!date) return 0;
  const y = 1980 + (date >> 9), m = (date >> 5) & 15, d = date & 31;
  const h = time >> 11, mi = (time >> 5) & 63, s = (time & 31) * 2;
  const t = new Date(y, m - 1, d, h, mi, s).getTime();
  return isNaN(t) ? 0 : t;
}

/** Fraction of the clusters of a file that are allocated again (0 = untouched, 1 = fully overwritten) */
function allocatedFraction(isAllocated, clusters) {
  let total = 0, used = 0;
  for (const [first, count] of clusters) {
    const step = Math.max(1, Math.floor(count / 64)); // sample long runs
    for (let c = first; c < first + count; c += step) { total++; if (isAllocated(c)) used++; }
  }
  return total ? used / total : 0;
}

function chanceFrom(fraction, hasData) {
  if (!hasData) return 'none';
  if (fraction > 0.99) return 'poor';
  if (fraction > 0) return 'average';
  return 'excellent';
}

const yieldLoop = () => new Promise((r) => setImmediate(r));

module.exports = { TYPES, typeOf, dosTime, allocatedFraction, chanceFrom, yieldLoop };
