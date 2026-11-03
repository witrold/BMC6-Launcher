'use strict';
// Lecture et ecriture de fichiers zip (deflate), sans dependance. Suffisant pour les "overrides" du pack (< 4 Go, < 65 000 fichiers).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries : [{ name: 'config/x.toml', file: 'C:\\chemin\\x.toml' }] -> ecrit outFile. */
function writeZip(entries, outFile) {
  const fd = fs.openSync(outFile, 'w');
  const central = [];
  let offset = 0;
  const write = buf => {
    fs.writeSync(fd, buf);
    offset += buf.length;
  };
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const e of entries) {
    const data = fs.readFileSync(e.file);
    let comp = zlib.deflateRawSync(data, { level: 6 });
    let method = 8;
    if (comp.length >= data.length) {
      comp = data;
      method = 0;
    }
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    central.push({ name, crc, method, csize: comp.length, usize: data.length, offset });
    write(h); write(name); write(comp);
  }
  const start = offset;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(c.method, 10);
    h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14); h.writeUInt32LE(c.crc, 16);
    h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.usize, 24); h.writeUInt16LE(c.name.length, 28);
    h.writeUInt32LE(c.offset, 42);
    write(h); write(c.name);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - start, 12); end.writeUInt32LE(start, 16);
  write(end);
  fs.closeSync(fd);
}

/** Extrait zipFile dans destDir. overwrite=false : les fichiers deja presents sont conserves. Renvoie le nombre de fichiers ecrits. */
function extractZip(zipFile, destDir, { overwrite = false } = {}) {
  const buf = fs.readFileSync(zipFile);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Zip invalide : ' + path.basename(zipFile));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const root = path.resolve(destDir);
  let written = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Zip corrompu (repertoire central).');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep)) throw new Error('Chemin refuse dans le zip : ' + name);
    if (!overwrite && fs.existsSync(target)) continue;
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written++;
  }
  return written;
}

module.exports = { writeZip, extractZip };
