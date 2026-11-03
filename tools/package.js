'use strict';
// Cree le dossier + le zip a donner aux amis (Node portable inclus : rien a installer).
//   node tools/package.js [--manifest-url URL] [--client-id ID] [--server ip:port]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const flag = name => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'BMC6Launcher');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const d of ['src', 'ui']) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });
fs.copyFileSync(process.execPath, path.join(out, 'node.exe'));

const pack = JSON.parse(fs.readFileSync(path.join(root, 'pack.json'), 'utf8'));
if (flag('manifest-url')) pack.manifestUrl = flag('manifest-url');
if (flag('client-id')) pack.msClientId = flag('client-id');
// jeton de lecture du depot prive : seulement dans le zip, jamais dans le depot (--pack-token, ou pack.local.json ignore par git)
try {
  Object.assign(pack, JSON.parse(fs.readFileSync(path.join(root, 'pack.local.json'), 'utf8')));
} catch { /* pas de pack.local.json */ }
if (flag('pack-token')) pack.packToken = flag('pack-token');
if (flag('server')) pack.server = flag('server');
fs.writeFileSync(path.join(out, 'pack.json'), JSON.stringify(pack, null, 2));

execFileSync(process.execPath, [path.join(__dirname, 'build-exe.js'), out], { stdio: 'inherit' });
fs.writeFileSync(path.join(out, 'LISEZ-MOI.txt'),
  'BMC6 Launcher\r\n\r\n1. Dezippe ce dossier ou tu veux (pas dans Program Files).\r\n2. Double-clique sur "BMC6 Launcher.exe".\r\n' +
  '   (Windows peut afficher "Windows a protege votre PC" : clique sur "Informations complementaires" puis "Executer quand meme".)\r\n' +
  '3. Dans la fenetre : connecte-toi avec ton compte Microsoft, clique sur Installer (premier lancement : plusieurs Go a telecharger), puis Jouer.\r\n\r\n' +
  'Les fichiers du jeu sont stockes dans %APPDATA%\\BMC6Launcher. Rien n\'est installe ailleurs.\r\n');

const zip = path.join(root, 'dist', 'BMC6Launcher.zip');
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -Force`], { stdio: 'inherit' });
console.log(`Dossier : ${out}`);
console.log(`Zip     : ${zip} (${(fs.statSync(zip).size / 1048576).toFixed(0)} Mo)`);
console.log(`Pack    : depot=${pack.github ? pack.github.repo : '(aucun)'} jeton=${pack.packToken ? 'oui' : 'NON'} msClientId=${pack.msClientId ? 'oui' : '(aucun)'} server=${pack.server || '(aucun)'}`);
if (pack.github && !pack.packToken) console.log('ATTENTION : sans --pack-token, le launcher ne pourra pas lire le depot prive.');
