'use strict';
// Coeur du launcher : telechargements, installation de Minecraft / Java / NeoForge, construction de la commande de lancement.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { fileURLToPath } = require('url');
const { extractZip } = require('./zip');

const DATA = process.env.BMC6_DATA || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'BMC6Launcher');
const MC = path.join(DATA, 'minecraft'); // versions/, libraries/, assets/ (comme .minecraft)
const RUNTIME = path.join(DATA, 'runtime');
const INSTANCES = path.join(DATA, 'instances');
const CACHE = path.join(DATA, 'cache');

const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_RUNTIMES = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

/** Etat partage avec l'interface : tache en cours, progression, journal. */
const bus = { task: '', done: 0, total: 0, bytes: 0, logs: [], base: 0 };
function log(msg) {
  bus.logs.push(msg);
  if (bus.logs.length > 2000) {
    bus.logs.splice(0, 500);
    bus.base += 500;
  }
}
function task(name, total = 0) {
  bus.task = name;
  bus.done = 0;
  bus.total = total;
  log(`> ${name}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Telechargements ----------

function sha1File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function valid(dest, sha1, size) {
  try {
    const st = await fsp.stat(dest);
    if (size != null && st.size !== size) return false;
    return sha1 ? (await sha1File(dest)) === sha1 : true;
  } catch {
    return false;
  }
}

/** Une source locale (chemin Windows ou file:///) sert aux essais et aux packs heberges sur le disque. */
function localPath(url) {
  if (/^file:/i.test(url)) return fileURLToPath(url);
  if (/^[A-Za-z]:[\\/]/.test(url)) return url;
  return null;
}

/** Telecharge url vers dest (ignore si le fichier est deja valide). Renvoie true si telecharge. */
async function download(url, dest, { sha1, size, headers } = {}) {
  if (await valid(dest, sha1, size)) return false;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const local = localPath(url);
  if (local) {
    await fsp.copyFile(local, dest + '.part');
    bus.bytes += (await fsp.stat(dest + '.part')).size;
    if (sha1 && (await sha1File(dest + '.part')) !== sha1) throw new Error(`sha1 incorrect pour ${url}`);
    await fsp.rename(dest + '.part', dest);
    return true;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, headers ? { headers } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url.replace(/\?.*$/, '')}`);
      const tmp = dest + '.part';
      const body = Readable.fromWeb(res.body);
      body.on('data', d => { bus.bytes += d.length; }); // sert a afficher la vitesse de telechargement
      await pipeline(body, fs.createWriteStream(tmp));
      if (sha1 && (await sha1File(tmp)) !== sha1) throw new Error(`sha1 incorrect pour ${url}`);
      await fsp.rename(tmp, dest);
      return true;
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(500 * attempt);
    }
  }
}

async function getJson(url) {
  const local = localPath(url);
  if (local) return JSON.parse(await fsp.readFile(local, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  return res.json();
}

/** Execute fn sur chaque element avec n telechargements en parallele ; avance bus.done. */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      await fn(items[i++]);
      bus.done++;
    }
  }));
}

// ---------- Regles Mojang (os / features) ----------

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function ruleMatches(r, features) {
  if (r.os) {
    if (r.os.name && r.os.name !== 'windows') return false;
    if (r.os.arch && !['x86_64', 'amd64'].includes(r.os.arch)) return false;
    if (r.os.version && !new RegExp(r.os.version).test(os.release())) return false;
    if (r.os.versionRange) {
      const v = os.release();
      if (r.os.versionRange.min && cmpVersion(v, r.os.versionRange.min) < 0) return false;
      if (r.os.versionRange.max && cmpVersion(v, r.os.versionRange.max) > 0) return false;
    }
  }
  if (r.features) {
    for (const [k, want] of Object.entries(r.features)) if (!!features[k] !== want) return false;
  }
  return true;
}

function ruleOk(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let ok = false;
  for (const r of rules) if (ruleMatches(r, features)) ok = r.action === 'allow';
  return ok;
}

// ---------- Java (runtime fourni par Mojang) ----------

function javaExe(component, console = true) {
  return path.join(RUNTIME, component, 'bin', console ? 'java.exe' : 'javaw.exe');
}

async function ensureJava(component) {
  const marker = path.join(RUNTIME, component, '.ok');
  if (fs.existsSync(marker) && fs.existsSync(javaExe(component))) return javaExe(component);
  task(`Java (${component})`);
  const all = await getJson(JAVA_RUNTIMES);
  const entry = all['windows-x64']?.[component]?.[0];
  if (!entry) throw new Error(`Runtime Java introuvable : ${component}`);
  const manifest = await getJson(entry.manifest.url);
  const root = path.join(RUNTIME, component);
  const files = Object.entries(manifest.files).filter(([, f]) => f.type === 'file');
  bus.total = files.length;
  for (const [name, f] of Object.entries(manifest.files)) if (f.type === 'directory') await fsp.mkdir(path.join(root, name), { recursive: true });
  await pool(files, 12, ([name, f]) => download(f.downloads.raw.url, path.join(root, name), { sha1: f.downloads.raw.sha1, size: f.downloads.raw.size }));
  await fsp.writeFile(marker, entry.version?.name || 'ok');
  return javaExe(component);
}

// ---------- Minecraft vanilla ----------

async function installMinecraft(id) {
  const vdir = path.join(MC, 'versions', id);
  task(`Minecraft ${id} : description de la version`);
  const man = await getJson(VERSION_MANIFEST);
  const entry = man.versions.find(v => v.id === id);
  if (!entry) throw new Error(`Version Minecraft inconnue : ${id}`);
  const info = await getJson(entry.url);
  await fsp.mkdir(vdir, { recursive: true });
  await fsp.writeFile(path.join(vdir, `${id}.json`), JSON.stringify(info));

  task('Minecraft : jeu', 1);
  await download(info.downloads.client.url, path.join(vdir, `${id}.jar`), { sha1: info.downloads.client.sha1, size: info.downloads.client.size });
  bus.done = 1;

  const libs = info.libraries.filter(l => ruleOk(l.rules)).map(l => l.downloads?.artifact).filter(Boolean);
  task('Minecraft : bibliotheques', libs.length);
  await pool(libs, 16, a => download(a.url, path.join(MC, 'libraries', a.path), { sha1: a.sha1, size: a.size }));

  const lc = info.logging?.client?.file;
  if (lc) await download(lc.url, path.join(MC, 'assets', 'log_configs', lc.id), { sha1: lc.sha1, size: lc.size });

  const idxPath = path.join(MC, 'assets', 'indexes', `${info.assetIndex.id}.json`);
  await download(info.assetIndex.url, idxPath, { sha1: info.assetIndex.sha1, size: info.assetIndex.size });
  const index = JSON.parse(await fsp.readFile(idxPath, 'utf8'));
  const objs = [...new Map(Object.values(index.objects).map(o => [o.hash, o])).values()];
  task('Minecraft : ressources (sons, langues...)', objs.length);
  await pool(objs, 24, o => download(
    `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`,
    path.join(MC, 'assets', 'objects', o.hash.slice(0, 2), o.hash), { size: o.size }));

  await ensureJava(info.javaVersion.component);
  return info;
}

// ---------- NeoForge ----------

async function installNeoForge(nfVersion) {
  const id = `neoforge-${nfVersion}`;
  const json = path.join(MC, 'versions', id, `${id}.json`);
  if (fs.existsSync(json)) return id;
  task(`NeoForge ${nfVersion}`);
  const installer = path.join(CACHE, `neoforge-${nfVersion}-installer.jar`);
  await download(`https://maven.neoforged.net/releases/net/neoforged/neoforge/${nfVersion}/neoforge-${nfVersion}-installer.jar`, installer);
  const profiles = path.join(MC, 'launcher_profiles.json');
  if (!fs.existsSync(profiles)) await fsp.writeFile(profiles, '{"profiles":{}}');
  // l'installeur a besoin de Java : meme runtime que le jeu
  const java = findAnyJava();
  await new Promise((resolve, reject) => {
    const p = spawn(java, ['-jar', installer, '--installClient', MC], { cwd: DATA });
    const onData = d => d.toString().split(/\r?\n/).filter(Boolean).forEach(l => { log(l); bus.done++; });
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`Installeur NeoForge : code ${code}`))));
    p.on('error', reject);
  });
  if (!fs.existsSync(json)) throw new Error('NeoForge : installation incomplete (fichier de version absent).');
  return id;
}

function findAnyJava() {
  if (fs.existsSync(RUNTIME)) {
    for (const c of fs.readdirSync(RUNTIME)) if (fs.existsSync(javaExe(c))) return javaExe(c);
  }
  throw new Error('Aucun Java installe.');
}

// ---------- Pack (mods et configs) ----------

/** Resout l'adresse d'un fichier du manifeste par rapport a l'adresse du manifeste. */
function resolveUrl(url, manifestUrl) {
  if (/^(https?:|file:)/i.test(url) || localPath(url)) return url;
  const local = localPath(manifestUrl);
  if (local) return path.join(path.dirname(local), url);
  return new URL(url, manifestUrl).href;
}

function safeJoin(dir, rel) {
  const p = path.resolve(dir, rel);
  if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error(`Chemin refuse dans le manifeste : ${rel}`);
  return p;
}

async function listFiles(dir) {
  const out = [];
  async function walk(d) {
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(p);
    }
  }
  await walk(dir);
  return out;
}

/**
 * Synchronise l'instance avec le manifeste : telecharge ce qui manque ou a change,
 * ne remplace pas les fichiers `overwrite: false` deja presents, et supprime des dossiers geres
 * (par defaut mods/) les fichiers qui ne sont plus dans le pack.
 */
async function syncPack(manifest, manifestUrl, dir, gh) {
  const files = manifest.files || [];
  task(`Pack ${manifest.name || ''} : fichiers`, files.length + (manifest.overrides ? 1 : 0));
  let fetched = 0;
  await pool(files, 8, async f => {
    const dest = safeJoin(dir, f.path);
    if (f.overwrite === false && fs.existsSync(dest)) return;
    const src = f.github ? ghSource(gh, f.github) : { url: resolveUrl(f.url, manifestUrl) };
    if (await download(src.url, dest, { sha1: f.sha1, size: f.size, headers: src.headers })) {
      fetched++;
      log(`Telecharge : ${f.path}`);
    }
  });
  if (manifest.overrides) await syncOverrides(manifest.overrides, manifestUrl, dir, gh);
  bus.done = bus.total;
  const keep = new Set(files.map(f => safeJoin(dir, f.path)));
  let removed = 0;
  for (const d of manifest.managedDirs || ['mods']) {
    for (const p of await listFiles(safeJoin(dir, d))) {
      if (!keep.has(p)) {
        await fsp.unlink(p);
        removed++;
        log(`Supprime (plus dans le pack) : ${path.relative(dir, p)}`);
      }
    }
  }
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, '.pack-version'), String(manifest.version || ''));
  return { files: files.length, removed, fetched };
}

// ---------- GitHub (depot prive du pack) ----------

function ghHeaders(token, accept) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept || 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'bmc6-launcher',
  };
}

async function ghJson(url, token) {
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (res.status === 401 || res.status === 403) throw new Error('Acces refuse au pack : le jeton est invalide ou expire.');
  if (res.status === 404) throw new Error('Pack introuvable (depot, version ou jeton incorrect).');
  if (!res.ok) throw new Error(`GitHub : HTTP ${res.status}`);
  return res.json();
}

/** Lit la release du depot et renvoie { manifest, ctx } ; ctx sert ensuite a telecharger les fichiers. */
async function loadGithubManifest(repo, tag, token) {
  if (!token) throw new Error('Jeton d\'acces au pack manquant (packToken).');
  const rel = await ghJson(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, token);
  const assets = new Map();
  for (let page = 1; ; page++) {
    const list = await ghJson(`https://api.github.com/repos/${repo}/releases/${rel.id}/assets?per_page=100&page=${page}`, token);
    for (const a of list) assets.set(a.name, a);
    if (list.length < 100) break;
  }
  const ctx = { repo, token, assets };
  const m = assets.get('pack-manifest.json');
  if (!m) throw new Error('La release ne contient pas pack-manifest.json.');
  const tmp = path.join(CACHE, 'pack-manifest.json');
  const src = ghSource(ctx, 'pack-manifest.json');
  fs.rmSync(tmp, { force: true });
  await download(src.url, tmp, { headers: src.headers });
  return { manifest: JSON.parse(fs.readFileSync(tmp, 'utf8')), ctx };
}

function ghSource(ctx, name) {
  const a = ctx && ctx.assets.get(name);
  if (!a) throw new Error(`Fichier absent de la release du pack : ${name}`);
  return { url: `https://api.github.com/repos/${ctx.repo}/releases/assets/${a.id}`, headers: ghHeaders(ctx.token, 'application/octet-stream') };
}

/** Archive "overrides" : configs, shaders... decompressee dans l'instance (sans ecraser, sauf si le pack le demande). */
async function syncOverrides(ov, manifestUrl, dir, gh) {
  const state = path.join(dir, '.overrides-sha1');
  const current = fs.existsSync(state) ? fs.readFileSync(state, 'utf8').trim() : '';
  if (current === ov.sha1) return;
  const zipPath = path.join(CACHE, `overrides-${ov.sha1}.zip`);
  const src = ov.github ? ghSource(gh, ov.github) : { url: resolveUrl(ov.url, manifestUrl) };
  task('Pack : configurations et ressources');
  await download(src.url, zipPath, { sha1: ov.sha1, size: ov.size, headers: src.headers });
  const n = extractZip(zipPath, dir, { overwrite: current !== '' && ov.overwrite === true });
  log(`Configurations : ${n} fichier(s) ecrits.`);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(state, ov.sha1);
}

function installedPackVersion(dir) {
  try {
    return fs.readFileSync(path.join(dir, '.pack-version'), 'utf8').trim();
  } catch {
    return '';
  }
}

// ---------- Lancement ----------

/** Lit une version et fusionne celle dont elle herite (loader -> vanilla). */
function loadVersion(id) {
  const v = JSON.parse(fs.readFileSync(path.join(MC, 'versions', id, `${id}.json`), 'utf8'));
  if (!v.inheritsFrom) return { ...v, jarId: id };
  const p = loadVersion(v.inheritsFrom);
  return {
    ...p, ...v,
    jarId: p.jarId,
    libraries: [...(v.libraries || []), ...(p.libraries || [])],
    arguments: {
      jvm: [...(p.arguments?.jvm || []), ...(v.arguments?.jvm || [])],
      game: [...(p.arguments?.game || []), ...(v.arguments?.game || [])],
      'default-user-jvm': p.arguments?.['default-user-jvm'] || [],
    },
    assetIndex: v.assetIndex || p.assetIndex,
    assets: v.assets || p.assets,
    downloads: v.downloads || p.downloads,
    javaVersion: v.javaVersion || p.javaVersion,
    logging: v.logging || p.logging,
  };
}

function expand(args, vars, features) {
  const out = [];
  const sub = s => s.replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  for (const a of args || []) {
    if (typeof a === 'string') out.push(sub(a));
    else if (ruleOk(a.rules, features)) for (const v of [].concat(a.value)) out.push(sub(v));
  }
  return out;
}

/** Construit {java, args, cwd} pour lancer `versionId` avec le joueur donne. */
function buildLaunch({ versionId, gameDir, player, ramMb, server }) {
  const v = loadVersion(versionId);
  const features = {};
  const seen = new Set();
  const cp = [];
  for (const l of v.libraries) {
    if (!ruleOk(l.rules)) continue;
    const a = l.downloads?.artifact;
    if (!a) continue;
    const [g, n, , cls] = l.name.split(':');
    const key = `${g}:${n}:${cls || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cp.push(path.join(MC, 'libraries', a.path));
  }
  cp.push(path.join(MC, 'versions', v.jarId, `${v.jarId}.jar`));

  const natives = path.join(DATA, 'natives', versionId);
  fs.mkdirSync(natives, { recursive: true });
  fs.mkdirSync(gameDir, { recursive: true });
  const vars = {
    auth_player_name: player.name, version_name: versionId, game_directory: gameDir,
    assets_root: path.join(MC, 'assets'), assets_index_name: v.assetIndex.id,
    auth_uuid: player.uuid, auth_access_token: player.token, clientid: '', auth_xuid: player.xuid || '',
    user_type: player.type || 'msa', version_type: v.type || 'release',
    launcher_name: 'BMC6Launcher', launcher_version: '1.0',
    classpath: cp.join(';'), classpath_separator: ';', library_directory: path.join(MC, 'libraries'),
    natives_directory: natives, path: path.join(MC, 'assets', 'log_configs', v.logging?.client?.file?.id || ''),
  };

  const memory = [`-Xms${Math.min(ramMb, 2048)}M`, `-Xmx${ramMb}M`];
  const tuning = expand(v.arguments['default-user-jvm'], vars, features).filter(a => !/^-Xm[sx]/.test(a));
  const jvm = [...memory, ...tuning, ...expand(v.arguments.jvm, vars, features)];
  if (v.logging?.client?.argument) jvm.push(...expand([v.logging.client.argument], vars, features));
  const game = expand(v.arguments.game, vars, features);
  if (server) game.push('--quickPlayMultiplayer', server);
  const java = javaExe(v.javaVersion.component, false);
  return { java, args: [...jvm, v.mainClass, ...game], cwd: gameDir };
}

/** Le jeu ecrit ses logs en XML log4j sur la sortie standard : on les transforme en lignes "NIVEAU: message". */
function xmlLogParser(emit) {
  let cur = null, inMsg = false, buf = '';
  return line => {
    const m = /<log4j:Event [^>]*level="(\w+)"/.exec(line);
    if (m) {
      cur = { level: m[1], msg: '' };
      inMsg = false;
      return;
    }
    if (!cur) {
      if (line.trim()) emit(line);
      return;
    }
    if (line.includes('<log4j:Message>')) {
      inMsg = true;
      buf = '';
    }
    if (inMsg) {
      buf += (buf ? '\n' : '') + line;
      if (line.includes('</log4j:Message>')) {
        inMsg = false;
        cur.msg = buf.replace(/^[\s\S]*?<!\[CDATA\[/, '').replace(/\]\]><\/log4j:Message>[\s\S]*$/, '');
      }
    }
    if (line.includes('</log4j:Event>')) {
      emit(`${cur.level}: ${cur.msg.split('\n')[0]}`);
      cur = null;
    }
  };
}

function launch(opts, onLine) {
  const { java, args, cwd } = buildLaunch(opts);
  const child = spawn(java, args, { cwd });
  const parse = xmlLogParser(onLine);
  const feed = d => d.toString().split(/\r?\n/).filter(Boolean).forEach(parse);
  child.stdout.on('data', feed);
  child.stderr.on('data', feed);
  return child;
}

function isInstalled(versionId, mcVersion) {
  try {
    const v = loadVersion(versionId);
    return fs.existsSync(javaExe(v.javaVersion.component)) && fs.existsSync(path.join(MC, 'versions', mcVersion, `${mcVersion}.jar`));
  } catch {
    return false;
  }
}

// ---------- Memoire conseillee, statut du serveur ----------

/** RAM conseillee pour le jeu (Mo) : 8 a 12 Go sur un PC qui les a (14 Go de RAM ou plus), sinon environ 60 % de ce qui reste apres 4 Go pour Windows. */
function recommendedRamMb() {
  const totalMb = Math.floor(os.totalmem() / 1048576);
  const share = Math.floor(((totalMb - 4096) * 0.6) / 512) * 512;
  return Math.min(12288, Math.max(totalMb >= 14336 ? 8192 : 4096, share));
}

const varint = n => {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
};

/** Interroge un serveur Minecraft (protocole "server list ping") : { online, players, max } ; online=false si injoignable. */
function pingServer(address, timeoutMs = 4000) {
  const net = require('net');
  const m = /^(.*?)(?::(\d+))?$/.exec(address);
  const host = m[1], port = Number(m[2] || 25565);
  return new Promise(resolve => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0), settled = false;
    const done = v => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => done({ online: false }));
    sock.on('error', () => done({ online: false }));
    sock.on('connect', () => {
      const h = Buffer.from(host);
      const port2 = Buffer.alloc(2);
      port2.writeUInt16BE(port);
      const hs = Buffer.concat([varint(0), varint(767), varint(h.length), h, port2, varint(1)]);
      sock.write(Buffer.concat([varint(hs.length), hs, varint(1), varint(0)]));
    });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      // reponse : longueur, id (0), longueur du texte, JSON
      try {
        let i = 0;
        const read = () => {
          let v = 0, shift = 0, b;
          do {
            if (i >= buf.length) throw new RangeError('incomplet');
            b = buf[i++];
            v |= (b & 0x7f) << shift;
            shift += 7;
          } while (b & 0x80);
          return v;
        };
        const len = read();
        if (buf.length - i < len) return;
        read(); // id du paquet
        const n = read();
        if (buf.length - i < n) return;
        const j = JSON.parse(buf.subarray(i, i + n).toString('utf8'));
        done({ online: true, players: j.players?.online ?? 0, max: j.players?.max ?? 0 });
      } catch (e) {
        if (!(e instanceof RangeError)) done({ online: false });
      }
    });
  });
}

module.exports = { RUNTIME, recommendedRamMb, pingServer, DATA, MC, INSTANCES, CACHE, bus, log, task, download, getJson, pool, installMinecraft, installNeoForge, ensureJava, buildLaunch, launch, isInstalled, sha1File, syncPack, installedPackVersion, resolveUrl, loadGithubManifest };
