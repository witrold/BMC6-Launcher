'use strict';
// Enregistre l'adresse actuelle du serveur (ton IP publique + le port) dans pack.local.json (ignore par git),
// pour qu'elle soit publiee avec le pack et que le launcher des amis la connaisse.
//   node tools/set-server.js [port]        (port par defaut : 25565)
const fs = require('fs');
const path = require('path');

const local = path.join(__dirname, '..', 'pack.local.json');
const port = Number(process.argv[2] || 25565);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Port invalide.');
  process.exit(1);
}

(async () => {
  const res = await fetch('https://api.ipify.org');
  const ip = (await res.text()).trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error('Reponse inattendue du service d\'adresse IP : ' + ip.slice(0, 40));
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(local, 'utf8'));
  } catch { /* nouveau fichier */ }
  const before = cfg.server;
  cfg.server = `${ip}:${port}`;
  fs.writeFileSync(local, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`Adresse du serveur : ${cfg.server}` + (before && before !== cfg.server ? `  (avant : ${before})` : before ? '  (inchangee)' : ''));
  console.log('Elle sera publiee avec le pack au prochain "Publier le pack BMC6".');
})().catch(e => {
  console.error('ECHEC : ' + e.message);
  process.exit(1);
});
