'use strict';
// Compile "BMC6 Launcher.exe" avec le compilateur C# fourni par Windows (rien a installer).
//   node tools/build-exe.js [dossier-de-sortie]   (par defaut : la racine du projet)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || root);
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!fs.existsSync(csc)) throw new Error('Compilateur C# introuvable : ' + csc);

const icon = path.join(root, 'app', 'icon.ico');
if (!fs.existsSync(icon)) execFileSync(process.execPath, [path.join(__dirname, 'make-icon.js')], { stdio: 'inherit' });

const exe = path.join(out, 'BMC6 Launcher.exe');
execFileSync(csc, ['/nologo', '/codepage:65001', '/target:winexe', `/out:${exe}`, `/win32icon:${icon}`, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Net.Http.dll', '/r:System.Web.Extensions.dll', path.join(root, 'app', 'Launcher.cs')], { stdio: 'inherit' });
console.log('Cree : ' + exe);
