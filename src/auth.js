'use strict';
// Connexion Microsoft -> Xbox Live -> XSTS -> Minecraft Services (flux "device code").
// Necessite un identifiant d'application Azure approuve par Mojang (pack.json : msClientId).
const fs = require('fs');
const path = require('path');
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

module.exports = { startDeviceLogin, pollDeviceLogin, completeLogin, getPlayer, loadAccount, logout };
