'use strict';
// Etat du pack publie et difference avec l'instance locale ; ecrit UNE ligne JSON sur la sortie standard
// (utilise par l'application d'administration).
//   node tools/pack-status.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const core = require('../src/core');

const out = o => console.log(JSON.stringify(o));
const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pack.json'), 'utf8'));
try {
  Object.assign(pack, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pack.local.json'), 'utf8')));
} catch { /* absent */ }

(async () => {
  if (!pack.github) return out({ ok: false, error: 'pack.json ne contient pas "github".' });
  let token = process.env.BMC6_PACK_TOKEN || pack.packToken;
  if (!token) {
    const gh = fs.existsSync('C:\\Program Files\\GitHub CLI\\gh.exe') ? 'C:\\Program Files\\GitHub CLI\\gh.exe' : 'gh';
    try { token = execFileSync(gh, ['auth', 'token'], { encoding: 'utf8' }).trim(); } catch { /* pas connecte */ }
  }
  if (!token) return out({ ok: false, error: 'Aucun jeton pour lire le pack (packToken ou gh connecte).' });

  const { manifest } = await core.loadGithubManifest(pack.github.repo, pack.github.tag || 'pack', token);
  const published = new Map(manifest.files.filter(f => f.path.startsWith('mods/')).map(f => [f.path.slice(5), f.sha1]));
  const res = { ok: true, version: String(manifest.version || ''), minecraft: manifest.minecraft, neoforge: manifest.neoforge,
    server: manifest.server || '', localServer: pack.server || '', publishedMods: published.size, localMods: null, added: [], removed: [], changed: [], instance: pack.instance || '' };

  const modsDir = pack.instance ? path.join(pack.instance, 'mods') : null;
  if (modsDir && fs.existsSync(modsDir)) {
    const local = new Map();
    for (const f of fs.readdirSync(modsDir).filter(n => n.endsWith('.jar'))) {
      local.set(f, crypto.createHash('sha1').update(fs.readFileSync(path.join(modsDir, f))).digest('hex'));
    }
    res.localMods = local.size;
    for (const [n, h] of local) {
      if (!published.has(n)) res.added.push(n);
      else if (published.get(n) !== h) res.changed.push(n);
    }
    for (const n of published.keys()) if (!local.has(n)) res.removed.push(n);
  } else if (pack.instance) {
    res.error = 'Instance introuvable : ' + pack.instance;
  }
  out(res);
})().catch(e => out({ ok: false, error: e.message }));
