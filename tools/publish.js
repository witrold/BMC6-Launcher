'use strict';
// Publie le pack depuis une instance Minecraft vers une release GitHub (depot prive, via l'outil `gh`).
//   node tools/publish.js <dossier-instance> [--github owner/repo] [--tag pack] [--version X] [--server ip:port]
//                         [--overwrite-config] [--dry-run]
// - mods : un fichier par mod dans la release (nomme par son sha1), envoyes seulement s'ils manquent.
// - configs, shaders, packs de textures : un seul zip "overrides".
// - fichiers dont l'auteur interdit la redistribution (CurseForge) : jamais envoyes ; le manifeste pointe vers
//   le meme fichier, identique au sha1 pres, chez Modrinth.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { writeZip } = require('../src/zip');

const flag = name => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const has = name => process.argv.includes('--' + name);
const instance = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pack.json'), 'utf8'));
const repo = flag('github') || (pack.github && pack.github.repo);
const tag = flag('tag') || (pack.github && pack.github.tag) || 'pack';
const dry = has('dry-run');
if (!instance || !repo) {
  console.error('Usage : node tools/publish.js <dossier-instance> [--github owner/repo] [--tag pack] [--version X] [--server ip:port] [--overwrite-config] [--dry-run]');
  process.exit(1);
}

const GH = process.env.GH || (fs.existsSync('C:\\Program Files\\GitHub CLI\\gh.exe') ? 'C:\\Program Files\\GitHub CLI\\gh.exe' : 'gh');
const gh = (...a) => execFileSync(GH, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sha1Of = buf => crypto.createHash('sha1').update(buf).digest('hex');
const UA = { 'User-Agent': 'bmc6-launcher/1.0 (github.com/witrold/BMC6-Launcher)' };

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
const rel = p => path.relative(instance, p).split(path.sep).join('/');

(async () => {
  // versions du jeu et de NeoForge, et fichiers dont la redistribution est interdite
  let mc = pack.minecraft, nf = pack.neoforge;
  const restricted = new Map(); // nom de fichier -> nom du projet
  try {
    const mi = JSON.parse(fs.readFileSync(path.join(instance, 'minecraftinstance.json'), 'utf8'));
    mc = mi.gameVersion || mc;
    nf = mi.baseModLoader?.forgeVersion || nf;
    for (const a of mi.installedAddons || []) {
      if (a.allowModDistribution === false) restricted.set(a.installedFile?.fileName, a.name);
    }
  } catch { /* instance sans minecraftinstance.json */ }

  const files = [];        // entrees du manifeste
  const uploads = new Map(); // nom d'asset -> fichier local
  const overrides = [];    // entrees du zip de configs
  let skipped = 0;

  // --- mods ---
  for (const p of walk(path.join(instance, 'mods')).filter(f => f.endsWith('.jar'))) {
    const buf = fs.readFileSync(p);
    const sha1 = sha1Of(buf);
    const name = path.basename(p);
    if (restricted.has(name)) {
      const m = await modrinthFile(sha1, restricted.get(name));
      if (m) files.push({ path: rel(p), sha1, size: buf.length, url: m });
      else skipped++;
    } else {
      uploads.set(sha1, p);
      files.push({ path: rel(p), sha1, size: buf.length, github: sha1 });
    }
  }

  // --- configs, shaders, packs de textures (zip unique) ---
  for (const dir of ['config', 'defaultconfigs', 'shaderpacks', 'resourcepacks', 'fancymenu_data', 'kubejs']) {
    for (const p of walk(path.join(instance, dir))) {
      const r = rel(p);
      if (/\.(bak|disabled|old)$/i.test(r) || /^shaderpacks\/Outdated/i.test(r)) continue;
      const name = path.basename(p);
      if (dir === 'resourcepacks' && restricted.has(name)) {
        const buf = fs.readFileSync(p);
        const m = await modrinthFile(sha1Of(buf), restricted.get(name));
        if (m) files.push({ path: r, sha1: sha1Of(buf), size: buf.length, url: m });
        else skipped++;
        continue;
      }
      overrides.push({ name: r, file: p });
    }
  }

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'bmc6-publish-'));
  const tmpZip = path.join(stage, 'overrides.zip');
  writeZip(overrides, tmpZip);
  const zipBuf = fs.readFileSync(tmpZip);
  const zipSha = sha1Of(zipBuf);
  const zipName = `overrides-${zipSha.slice(0, 12)}.zip`;
  uploads.set(zipName, tmpZip);

  const manifest = {
    name: pack.name,
    version: flag('version') || new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''),
    minecraft: mc,
    neoforge: nf,
    ...(flag('server') ? { server: flag('server') } : {}),
    managedDirs: ['mods'],
    files,
    overrides: { github: zipName, sha1: zipSha, size: zipBuf.length, overwrite: has('overwrite-config') },
  };
  const manifestPath = path.join(stage, 'pack-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));

  const mods = files.filter(f => f.path.startsWith('mods/'));
  console.log(`Pack ${manifest.name} ${manifest.version} : Minecraft ${mc}, NeoForge ${nf}`);
  console.log(`${mods.length} mods (${mods.filter(f => f.github).length} dans GitHub, ${mods.filter(f => f.url).length} depuis Modrinth), ` +
    `${files.length - mods.length} pack(s) de textures via Modrinth, ${overrides.length} fichiers de configuration dans le zip (${(zipBuf.length / 1048576).toFixed(0)} Mo)`);
  if (skipped) console.log(`ATTENTION : ${skipped} fichier(s) restreint(s) sans equivalent identique sur Modrinth : non inclus.`);
  if (dry) {
    console.log('(essai : rien n\'a ete envoye)');
    return;
  }

  // --- envoi : creer la release si besoin, puis envoyer ce qui manque ---
  try {
    gh('release', 'view', tag, '--repo', repo, '--json', 'id');
  } catch {
    const create = () => gh('release', 'create', tag, '--repo', repo, '--title', `Pack ${pack.name}`, '--notes', 'Fichiers du pack. Ne pas modifier a la main : publies par tools/publish.js.');
    try {
      create();
    } catch (e) {
      // GitHub refuse une release dans un depot sans aucun commit : on y ajoute un README
      if (!String(e.stderr || e.message).includes('Repository is empty')) throw e;
      const readme = Buffer.from(`# ${repo.split('/')[1]}\n\nFichiers du pack ${pack.name} (voir les releases). Depot prive.\n`).toString('base64');
      gh('api', '-X', 'PUT', `repos/${repo}/contents/README.md`, '-f', 'message=Initial commit', '-f', `content=${readme}`);
      create();
    }
    console.log(`Release "${tag}" creee.`);
  }
  const existing = new Set(JSON.parse(gh('release', 'view', tag, '--repo', repo, '--json', 'assets')).assets.map(a => a.name));
  const toSend = [...uploads].filter(([name]) => !existing.has(name));
  console.log(`${toSend.length} fichier(s) a envoyer (${uploads.size - toSend.length} deja presents).`);
  const dirStage = path.join(stage, 'up');
  fs.mkdirSync(dirStage);
  const staged = toSend.map(([name, file]) => {
    const dest = path.join(dirStage, name);
    try {
      fs.linkSync(file, dest);
    } catch {
      fs.copyFileSync(file, dest);
    }
    return dest;
  });
  for (let i = 0; i < staged.length; i += 20) {
    const batch = staged.slice(i, i + 20);
    gh('release', 'upload', tag, '--repo', repo, ...batch);
    console.log(`  envoyes : ${Math.min(i + 20, staged.length)} / ${staged.length}`);
  }
  gh('release', 'upload', tag, '--repo', repo, '--clobber', manifestPath);
  console.log(`Publie : https://github.com/${repo}/releases/tag/${tag}`);
  fs.rmSync(stage, { recursive: true, force: true });
})().catch(e => {
  console.error('ERREUR : ' + (e.stderr ? e.stderr.toString() : e.message));
  process.exit(1);
});

/** Adresse du meme fichier (meme sha1) chez Modrinth, ou null. */
async function modrinthFile(sha1, label) {
  try {
    const r = await fetch(`https://api.modrinth.com/v2/version_file/${sha1}?algorithm=sha1`, { headers: UA });
    if (!r.ok) {
      console.log(`  ${label} : pas d'equivalent identique sur Modrinth (HTTP ${r.status})`);
      return null;
    }
    const v = await r.json();
    const f = v.files.find(x => x.hashes.sha1 === sha1);
    return f ? f.url : null;
  } catch (e) {
    console.log(`  ${label} : Modrinth injoignable (${e.message})`);
    return null;
  }
}
