'use strict';
// Serveur local du launcher : API + interface web. Lancement : launcher.bat (ou `node src/main.js`).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const core = require('./core');
const auth = require('./auth');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8780);
const TOKEN = process.env.BMC6_TOKEN || crypto.randomUUID(); // l'application native fournit son propre jeton
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'pack.json'), 'utf8'));
// pack.local.json (ignore par git) : reglages et secrets propres a ce PC, par exemple le jeton du depot prive
try {
  Object.assign(pack, JSON.parse(fs.readFileSync(path.join(ROOT, 'pack.local.json'), 'utf8')));
} catch { /* absent : normal */ }
if (process.env.PACK_MANIFEST) pack.manifestUrl = process.env.PACK_MANIFEST;
if (process.env.MS_CLIENT_ID) pack.msClientId = process.env.MS_CLIENT_ID;
if (process.env.BMC6_PACK_TOKEN) pack.packToken = process.env.BMC6_PACK_TOKEN; // essais : le jeton normal est dans pack.json du zip des amis
const CONFIG = path.join(core.DATA, 'config.json');

let phase = 'idle'; // idle | installing | playing
let error = '';
let game = null;
let manifest = null; // pack distant (mods, configs, versions) ; null si pas d'adresse ou injoignable
let manifestError = '';

/** Reglages effectifs : pack.json, surcharges par le manifeste distant. */
const eff = () => ({ ...pack, ...(manifest || {}) });
const versionId = () => `neoforge-${eff().neoforge}`;
const instanceDir = () => path.join(core.INSTANCES, pack.name);

let ghCtx = null; // acces a la release GitHub du pack (depot prive)
const hasRemotePack = () => !!(pack.github || pack.manifestUrl);

async function refreshManifest() {
  if (!hasRemotePack()) return;
  try {
    if (pack.github) {
      const r = await core.loadGithubManifest(pack.github.repo, pack.github.tag || 'pack', pack.packToken);
      manifest = r.manifest;
      ghCtx = r.ctx;
    } else {
      manifest = await core.getJson(pack.manifestUrl);
    }
    manifestError = '';
  } catch (e) {
    manifestError = `Impossible de lire le pack en ligne : ${e.message}`;
  }
}

function loadConfig() {
  const def = { ramMb: 8192, autoJoin: false };
  try {
    return { ...def, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) };
  } catch {
    return def;
  }
}

function saveConfig(body) {
  const cfg = loadConfig();
  const p = new URLSearchParams(body);
  const ram = Number(p.get('ramMb'));
  if (!Number.isInteger(ram) || ram < 2048 || ram > 32768) return 'RAM : entre 2048 et 32768 Mo.';
  cfg.ramMb = ram;
  cfg.autoJoin = p.get('autoJoin') === 'true';
  fs.mkdirSync(core.DATA, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
  return null;
}

async function install() {
  if (phase !== 'idle') return 'Une operation est deja en cours.';
  phase = 'installing';
  error = '';
  (async () => {
    try {
      await refreshManifest();
      if (hasRemotePack() && !manifest) throw new Error(manifestError);
      const p = eff();
      await core.installMinecraft(p.minecraft);
      await core.installNeoForge(p.neoforge);
      if (manifest) {
        const r = await core.syncPack(manifest, pack.manifestUrl, instanceDir(), ghCtx);
        core.log(`Pack synchronise : ${r.files} fichiers, ${r.removed} supprime(s).`);
      }
      core.task('Installation terminee');
    } catch (e) {
      error = e.message;
      core.log(`ERREUR : ${e.stack || e.message}`);
    } finally {
      phase = 'idle';
    }
  })();
  return null;
}

/** Connexion Microsoft en cours (code a saisir) : { status: waiting|done|error, code, uri, name, msg }. */
let login = null;

async function startLogin() {
  if (!pack.msClientId) return 'Connexion Microsoft non configuree (msClientId absent de pack.json).';
  if (login && login.status === 'waiting') return null;
  try {
    const dev = await auth.startDeviceLogin(pack.msClientId);
    login = { status: 'waiting', code: dev.user_code, uri: dev.verification_uri };
    (async () => {
      try {
        const ms = await auth.pollDeviceLogin(pack.msClientId, dev);
        const acc = await auth.completeLogin(ms);
        login = { status: 'done', name: acc.profile.name };
      } catch (e) {
        login = { status: 'error', msg: e.message };
      }
    })();
    return null;
  } catch (e) {
    login = { status: 'error', msg: e.message };
    return e.message;
  }
}

async function play() {
  if (phase !== 'idle') return 'Une operation est deja en cours.';
  const p = eff();
  if (!isReady()) return 'Installe le jeu d\'abord.';
  const cfg = loadConfig();
  // Connexion Microsoft obligatoire : pas de compte hors-ligne, le jeu n'est lance qu'avec un compte qui possede Minecraft Java.
  if (!pack.msClientId) return 'Connexion Microsoft non configuree (msClientId absent de pack.json).';
  let player;
  try {
    player = await auth.getPlayer(pack.msClientId);
  } catch (e) {
    return e.message;
  }
  if (!player) return 'Connecte-toi avec ton compte Microsoft d\'abord.';
  try {
    game = core.launch({ versionId: versionId(), gameDir: instanceDir(), player, ramMb: cfg.ramMb, server: cfg.autoJoin ? p.server || null : null },
      l => core.log(`[jeu] ${l}`));
  } catch (e) {
    return e.message;
  }
  phase = 'playing';
  core.log(`Lancement de ${pack.name} avec le pseudo ${player.name}`);
  game.on('exit', code => {
    core.log(`[jeu] ferme (code ${code})`);
    game = null;
    phase = 'idle';
  });
  return null;
}

/** Jeu installe, et pack a jour avec le dernier manifeste connu. */
function isReady() {
  const p = eff();
  if (!core.isInstalled(`neoforge-${p.neoforge}`, p.minecraft)) return false;
  return !manifest || core.installedPackVersion(instanceDir()) !== '';
}

function state(since) {
  const bus = core.bus;
  const from = Math.max(since, bus.base);
  const next = bus.base + bus.logs.length;
  const p = eff();
  const installedVersion = core.installedPackVersion(instanceDir());
  return {
    phase, error: error || manifestError,
    installed: isReady(),
    updateAvailable: !!manifest && installedVersion !== String(manifest.version || ''),
    task: bus.task, done: bus.done, total: bus.total,
    config: loadConfig(),
    msConfigured: !!pack.msClientId,
    account: (() => { const a = auth.loadAccount(); return a ? a.profile.name : ''; })(),
    login,
    pack: { name: pack.name, minecraft: p.minecraft, neoforge: p.neoforge, server: p.server || '', version: manifest ? String(manifest.version || '') : '', installedVersion },
    next, lines: bus.logs.slice(Math.min(from, next) - bus.base),
  };
}

const result = err => JSON.stringify({ ok: !err, msg: err || '' });

const server = http.createServer(async (req, res) => {
  const send = (code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  try {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return send(403, 'text/plain', 'forbidden');
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === '/') {
      const html = fs.readFileSync(path.join(ROOT, 'ui', 'index.html'), 'utf8').replace('__TOKEN__', TOKEN);
      return send(200, 'text/html; charset=utf-8', html);
    }
    // sans jeton : etat minimal (utilise par BMC6 Launcher.exe pour savoir quand arreter le serveur) et icone
    if (url.pathname === '/health') return send(200, 'application/json', JSON.stringify({ phase }));
    if (url.pathname === '/icon.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(fs.readFileSync(path.join(ROOT, 'ui', 'icon.png')));
    }
    if (req.headers['x-token'] !== TOKEN) return send(403, 'text/plain', 'forbidden');
    let body = '';
    for await (const c of req) body += c;
    const json = o => send(200, 'application/json; charset=utf-8', JSON.stringify(o));
    switch (url.pathname) {
      case '/api/state': return json(state(Number(url.searchParams.get('since')) || 0));
      case '/api/install': return send(200, 'application/json', result(await install()));
      case '/api/play': return send(200, 'application/json', result(await play()));
      case '/api/login': return send(200, 'application/json', result(await startLogin()));
      case '/api/logout': auth.logout(); login = null; return send(200, 'application/json', result(null));
      case '/api/kill': if (game) game.kill(); return send(200, 'application/json', result(null));
      case '/api/config': return send(200, 'application/json', result(saveConfig(body)));
      default: return send(404, 'text/plain', 'not found');
    }
  } catch (e) {
    send(500, 'application/json', result(String(e)));
  }
});

server.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} deja utilise : le launcher tourne peut-etre deja.` : e);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`BMC6 Launcher : ${url}  (Ctrl+C pour quitter)`);
  console.log(`Donnees : ${core.DATA}`);
  refreshManifest();
  setInterval(refreshManifest, 10 * 60 * 1000).unref();
  if (!process.env.NO_BROWSER) exec(`start "" "${url}"`);
});
