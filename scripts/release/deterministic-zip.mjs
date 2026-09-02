/**
 * Deterministic ZIP writer (no external deps).
 * Fixed entry order, fixed DOS timestamps, deflateRaw level 9 (or STORE if smaller).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Fixed epoch: 2026-09-02 00:00:00 UTC → DOS date/time */
const FIXED_DOS_TIME = dosTime(0, 0, 0);
const FIXED_DOS_DATE = dosDate(2026, 9, 2);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(h, m, s) {
  return ((h & 0x1f) << 11) | ((m & 0x3f) << 5) | ((Math.floor(s / 2) & 0x1f));
}

function dosDate(year, month, day) {
  return (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function walkFilesSorted(dir, base = dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFilesSorted(full, base));
    else files.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return files;
}

/**
 * Create a reproducible ZIP of bundleDir.
 * Entries are named `${archiveRoot}/relative/path`.
 */
export function createDeterministicZip(bundleDir, outputPath, archiveRoot) {
  const relFiles = walkFilesSorted(bundleDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const rel of relFiles) {
    const data = fs.readFileSync(path.join(bundleDir, rel));
    const name = Buffer.from(`${archiveRoot}/${rel}`, 'utf8');
    const checksum = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;

    const localHeader = Buffer.concat([
      u32(ZIP_LOCAL),
      u16(20),
      u16(0),
      u16(method),
      u16(FIXED_DOS_TIME),
      u16(FIXED_DOS_DATE),
      u32(checksum),
      u32(payload.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
    ]);

    const localOffset = offset;
    localParts.push(localHeader, payload);
    offset += localHeader.length + payload.length;

    const central = Buffer.concat([
      u32(ZIP_CENTRAL),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(FIXED_DOS_TIME),
      u16(FIXED_DOS_DATE),
      u32(checksum),
      u32(payload.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(localOffset),
      name,
    ]);
    centralParts.push(central);
  }

  const centralDir = Buffer.concat(centralParts);
  const centralOffset = offset;
  const end = Buffer.concat([
    u32(ZIP_END),
    u16(0),
    u16(0),
    u16(relFiles.length),
    u16(relFiles.length),
    u32(centralDir.length),
    u32(centralOffset),
    u16(0),
  ]);

  const zipBuf = Buffer.concat([...localParts, centralDir, end]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
  fs.writeFileSync(outputPath, zipBuf);

  return {
    entry_count: relFiles.length,
    entries: relFiles.map((rel) => `${archiveRoot}/${rel}`),
    size: zipBuf.length,
  };
}

export { walkFilesSorted };
