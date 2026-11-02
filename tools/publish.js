'use strict';
// Genere un pack a partir d'une instance Minecraft (par exemple l'instance CurseForge de BMC6).
//   node tools/publish.js <dossier-instance> <dossier-sortie> [url-de-base] [--version X] [--server ip:port] [--overwrite-config]
// Sortie : <sortie>/pack-manifest.json et <sortie>/files/<sha1> (a mettre en ligne tel quel).
// Sans url-de-base, les adresses des fichiers sont relatives au manifeste.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const flag = name => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const has = name => process.argv.includes('--' + name);
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && ['--version', '--server'].includes(all[i - 1])));
const [instance, out, baseUrl] = positional;
if (!instance || !out) {
  console.error('Usage : node tools/publish.js <dossier-instance> <dossier-sortie> [url-de-base] [--version X] [--server ip:port] [--overwrite-config]');
  process.exit(1);
}

const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pack.json'), 'utf8'));
let mc = pack.minecraft, nf = pack.neoforge;
try {
  const mi = JSON.parse(fs.readFileSync(path.join(instance, 'minecraftinstance.json'), 'utf8'));
  mc = mi.gameVersion || mc;
  nf = mi.baseModLoader?.forgeVersion || nf;
} catch { /* instance sans minecraftinstance.json : on garde pack.json */ }

const cfgOverwrite = has('overwrite-config');
// [dossier, ecraser a chaque mise a jour ?, filtre]
const PLAN = [
  ['mods', true, f => f.endsWith('.jar')],
  ['config', cfgOverwrite, () => true],
  ['defaultconfigs', cfgOverwrite, () => true],
  ['resourcepacks', true, () => true],
  ['shaderpacks', true, () => true],
  ['fancymenu_data', cfgOverwrite, () => true],
  ['kubejs', cfgOverwrite, () => true],
];

function walk(dir) {
  const res = [];
  if (!fs.existsSync(dir)) return res;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) res.push(...walk(p));
    else res.push(p);
  }
  return res;
}

fs.mkdirSync(path.join(out, 'files'), { recursive: true });
const files = [];
let total = 0;
for (const [dir, overwrite, filter] of PLAN) {
  for (const p of walk(path.join(instance, dir))) {
    const rel = path.relative(instance, p).split(path.sep).join('/');
    if (!filter(rel) || /\.(bak|disabled|old)$/i.test(rel)) continue;
    const buf = fs.readFileSync(p);
    const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
    const dest = path.join(out, 'files', sha1);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
    const entry = { path: rel, sha1, size: buf.length, url: baseUrl ? `${baseUrl.replace(/\/$/, '')}/${sha1}` : `files/${sha1}` };
    if (!overwrite) entry.overwrite = false;
    files.push(entry);
    total += buf.length;
  }
}

const manifest = {
  name: pack.name,
  version: flag('version') || new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''),
  minecraft: mc,
  neoforge: nf,
  ...(flag('server') ? { server: flag('server') } : {}),
  managedDirs: ['mods'],
  files,
};
fs.writeFileSync(path.join(out, 'pack-manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`Pack ${manifest.name} ${manifest.version} : Minecraft ${mc}, NeoForge ${nf}`);
console.log(`${files.length} fichiers, ${(total / 1048576).toFixed(0)} Mo -> ${path.resolve(out)}`);
console.log(`${files.filter(f => f.path.startsWith('mods/')).length} mods`);
