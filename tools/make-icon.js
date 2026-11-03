'use strict';
// Genere app/icon.ico (icone du launcher : carre arrondi degrade avec un triangle "lecture"), sans dependance.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 256, SS = 3; // taille et sur-echantillonnage (anticrenelage)
const px = Buffer.alloc(N * N * 4);

function inRoundedSquare(x, y) {
  const r = 52, m = 8, a = m + r, b = N - m - r;
  const cx = Math.min(Math.max(x, a), b), cy = Math.min(Math.max(y, a), b);
  return x >= m && x <= N - m && y >= m && y <= N - m && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inTriangle(x, y) {
  const p = [[98, 78], [98, 178], [186, 128]];
  const s = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
  const q = [x, y], d1 = s(q, p[0], p[1]), d2 = s(q, p[1], p[2]), d3 = s(q, p[2], p[0]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let cov = 0, tri = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
        if (inRoundedSquare(fx, fy)) {
          cov++;
          if (inTriangle(fx, fy)) tri++;
        }
      }
    }
    const t = (x + y) / (2 * N); // degrade bleu -> violet
    const base = [91 + (138 - 91) * t, 140 + (91 - 140) * t, 255];
    const k = tri / Math.max(cov, 1);
    const i = (y * N + x) * 4;
    px[i] = Math.round(base[0] * (1 - k) + 255 * k);
    px[i + 1] = Math.round(base[1] * (1 - k) + 255 * k);
    px[i + 2] = Math.round(base[2] * (1 - k) + 255 * k);
    px[i + 3] = Math.round(255 * cov / (SS * SS));
  }
}

// PNG (RGBA 8 bits)
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);

// ICO contenant le PNG 256x256
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = 0; head[7] = 0; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
fs.mkdirSync(path.join(__dirname, '..', 'app'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'app', 'icon.ico'), Buffer.concat([head, png]));
fs.writeFileSync(path.join(__dirname, '..', 'ui', 'icon.png'), png);
console.log('Icone creee : app/icon.ico, ui/icon.png');
