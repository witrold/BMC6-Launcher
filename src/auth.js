'use strict';
// Connexion Microsoft -> Xbox Live -> XSTS -> Minecraft Services (par le navigateur, ou par code en secours).
// Necessite un identifiant d'application Azure approuve par Mojang (pack.json : msClientId).
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const core = require('./core');

const FILE = path.join(core.DATA, 'account.json');
const MS = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(url, body, form = false) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', Accept: 'application/json' },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

const XERR = {
  2148916233: 'Ce compte Microsoft n\'a pas de profil Xbox. Connecte-toi une fois sur xbox.com pour en creer un.',
  2148916235: 'Xbox Live n\'est pas disponible dans ton pays.',
  2148916236: 'Ce compte demande une verification d\'age (xbox.com).',
  2148916237: 'Ce compte demande une verification d\'age (xbox.com).',
  2148916238: 'Ce compte est celui d\'un enfant : un adulte doit l\'ajouter a une famille Microsoft.',
};

/** Demande un code a saisir sur microsoft.com/link. */
async function startDeviceLogin(clientId) {
  const r = await post(`${MS}/devicecode`, { client_id: clientId, scope: SCOPE }, true);
  if (!r.ok) throw new Error(r.data.error_description || `devicecode : HTTP ${r.status}`);
  return r.data; // { user_code, device_code, verification_uri, expires_in, interval }
}

/** Attend que l'utilisateur valide le code ; renvoie les jetons Microsoft. */
async function pollDeviceLogin(clientId, dev) {
  let interval = (dev.interval || 5) * 1000;
  const until = Date.now() + dev.expires_in * 1000;
  while (Date.now() < until) {
    await sleep(interval);
    const r = await post(`${MS}/token`, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: dev.device_code,
    }, true);
    if (r.ok) return r.data;
    if (r.data.error === 'authorization_pending') continue;
    if (r.data.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    throw new Error(r.data.error_description || r.data.error || `token : HTTP ${r.status}`);
  }
  throw new Error('Code expire : recommence la connexion.');
}

/**
 * Connexion par le navigateur (code d'autorisation + PKCE) : la page Microsoft s'ouvre, puis renvoie vers un petit serveur
 * local temporaire. Necessite l'adresse de redirection http://localhost dans l'application Azure ("Application mobile et de bureau").
 * Renvoie { url, result, cancel } : result donne les jetons Microsoft.
 */
async function startBrowserLogin(clientId) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  let finish, fail;
  const result = new Promise((res, rej) => { finish = res; fail = rej; });
  result.catch(() => { /* l'appelant gere l'erreur ; ceci evite un plantage si une annulation arrive avant */ });
  const servers = [];
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    for (const s of servers) {
      try {
        s.close();
        if (s.closeAllConnections) s.closeAllConnections();
      } catch { /* deja ferme */ }
    }
  };
  const page = (ok, msg) => `<!doctype html><meta charset="utf-8"><title>BMC6 Launcher</title>` +
    `<body style="font-family:Segoe UI,sans-serif;background:#0a0c10;color:#e8eaee;display:grid;place-items:center;height:100vh;margin:0">` +
    `<div style="text-align:center"><h1>${ok ? 'Connexion réussie' : 'Connexion impossible'}</h1><p>${msg}</p></div>`;
  let redirect = '';
  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const reply = (code, ok, msg) => {
      res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
      res.end(page(ok, msg));
    };
    if (u.pathname !== '/' || u.searchParams.get('state') !== state) return reply(400, false, 'Réponse inattendue.');
    if (u.searchParams.get('error')) {
      reply(200, false, 'Retourne dans le launcher pour voir le détail.');
      close();
      return fail(new Error(u.searchParams.get('error_description') || u.searchParams.get('error')));
    }
    const code = u.searchParams.get('code');
    if (!code) return reply(400, false, 'Réponse inattendue.');
    const r = await post(`${MS}/token`, {
      grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier, scope: SCOPE,
    }, true);
    if (!r.ok) {
      reply(200, false, 'Retourne dans le launcher pour voir le détail.');
      close();
      return fail(new Error(r.data.error_description || r.data.error || `token : HTTP ${r.status}`));
    }
    reply(200, true, 'Tu peux fermer cet onglet et retourner dans le launcher.');
    close();
    finish(r.data);
  };
  // "localhost" peut pointer vers IPv4 ou IPv6 selon le navigateur : on ecoute sur les deux, uniquement en local
  const s4 = http.createServer(handler);
  await new Promise((res, rej) => { s4.once('error', rej); s4.listen(0, '127.0.0.1', res); });
  servers.push(s4);
  const port = s4.address().port;
  const s6 = http.createServer(handler);
  await new Promise(res => { s6.once('error', res); s6.listen(port, '::1', res); }); // IPv6 absent : tant pis
  if (s6.listening) servers.push(s6);
  redirect = `http://localhost:${port}`;
  timer = setTimeout(() => { close(); fail(new Error('Connexion non terminée : recommence.')); }, 5 * 60 * 1000);
  timer.unref();
  const url = `${MS}/authorize?` + new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirect, response_mode: 'query', scope: SCOPE,
    state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return { url, result, cancel: () => { close(); fail(new Error('annulé')); } };
}

async function refreshMicrosoft(clientId, refreshToken) {
  const r = await post(`${MS}/token`, { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, scope: SCOPE }, true);
  if (!r.ok) throw new Error(r.data.error_description || 'Session expiree : reconnecte-toi.');
  return r.data;
}

/** Jeton Microsoft -> Xbox Live -> XSTS -> jeton Minecraft + profil. */
async function minecraftLogin(msAccessToken) {
  const xbl = await post('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  if (!xbl.ok) throw new Error(`Xbox Live : HTTP ${xbl.status}`);
  const xsts = await post('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.data.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  });
  if (!xsts.ok) throw new Error(XERR[xsts.data.XErr] || `XSTS : HTTP ${xsts.status}`);
  const uhs = xsts.data.DisplayClaims.xui[0].uhs;
  const mc = await post('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.data.Token}`,
  });
  if (!mc.ok) {
    const msg = mc.data.errorMessage || mc.data.error || '';
    if (mc.status === 403 || /app registration/i.test(msg)) {
      throw new Error('Mojang refuse cette application (Invalid app registration) : son identifiant doit etre approuve par Mojang.');
    }
    throw new Error(`Minecraft Services : ${msg || 'HTTP ' + mc.status}`);
  }
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: `Bearer ${mc.data.access_token}` } });
  if (res.status === 404) throw new Error('Ce compte Microsoft ne possede pas Minecraft Java.');
  if (!res.ok) throw new Error(`Profil Minecraft : HTTP ${res.status}`);
  const profile = await res.json();
  return { mcToken: mc.data.access_token, mcExpires: Date.now() + (mc.data.expires_in || 86400) * 1000, profile: { id: profile.id, name: profile.name } };
}

function loadAccount() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveAccount(acc) {
  fs.mkdirSync(core.DATA, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(acc, null, 2));
}

function logout() {
  try {
    fs.unlinkSync(FILE);
  } catch { /* deja deconnecte */ }
}

/** Finalise une connexion : jetons Microsoft -> compte enregistre. */
async function completeLogin(ms) {
  const mc = await minecraftLogin(ms.access_token);
  const acc = { refreshToken: ms.refresh_token, ...mc };
  saveAccount(acc);
  return acc;
}

/** Joueur pret a lancer le jeu ; renouvelle le jeton si necessaire. */
async function getPlayer(clientId) {
  let acc = loadAccount();
  if (!acc) return null;
  if (!acc.mcToken || acc.mcExpires - Date.now() < 5 * 60 * 1000) {
    const ms = await refreshMicrosoft(clientId, acc.refreshToken);
    acc = await completeLogin({ access_token: ms.access_token, refresh_token: ms.refresh_token || acc.refreshToken });
  }
  return { name: acc.profile.name, uuid: acc.profile.id, token: acc.mcToken, type: 'msa', xuid: '' };
}

module.exports = { startBrowserLogin, startDeviceLogin, pollDeviceLogin, completeLogin, getPlayer, loadAccount, logout };
