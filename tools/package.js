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
if (flag('server')) pack.server = flag('server');
fs.writeFileSync(path.join(out, 'pack.json'), JSON.stringify(pack, null, 2));

fs.writeFileSync(path.join(out, 'Lancer BMC6.bat'), '@echo off\r\ntitle BMC6 Launcher\r\ncd /d "%~dp0"\r\nnode.exe src\\main.js\r\npause\r\n');
fs.writeFileSync(path.join(out, 'LISEZ-MOI.txt'),
  'BMC6 Launcher\r\n\r\n1. Dezippe ce dossier ou tu veux (pas dans Program Files).\r\n2. Double-clique sur "Lancer BMC6.bat".\r\n' +
  '3. Dans la page qui s\'ouvre : connecte-toi, clique sur Installer (premier lancement : plusieurs Go a telecharger), puis Jouer.\r\n\r\n' +
  'Les fichiers du jeu sont stockes dans %APPDATA%\\BMC6Launcher. Rien n\'est installe ailleurs.\r\n');

const zip = path.join(root, 'dist', 'BMC6Launcher.zip');
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -Force`], { stdio: 'inherit' });
console.log(`Dossier : ${out}`);
console.log(`Zip     : ${zip} (${(fs.statSync(zip).size / 1048576).toFixed(0)} Mo)`);
console.log(`Pack    : manifestUrl=${pack.manifestUrl || '(aucune)'} msClientId=${pack.msClientId ? 'oui' : '(aucun)'} server=${pack.server || '(aucun)'}`);
