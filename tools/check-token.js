'use strict';
// Verifie qu'un jeton GitHub peut lire le pack (sans rien telecharger de lourd).
//   node tools/check-token.js <jeton>
const fs = require('fs');
const path = require('path');
const core = require('../src/core');

const token = process.argv[2] || process.env.BMC6_PACK_TOKEN;
const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pack.json'), 'utf8'));
if (!token || !pack.github) {
  console.error('Usage : node tools/check-token.js <jeton>   (pack.json doit contenir "github")');
  process.exit(1);
}
core.loadGithubManifest(pack.github.repo, pack.github.tag || 'pack', token)
  .then(r => console.log(`OK : le jeton lit le pack ${r.manifest.name} v${r.manifest.version} (${r.manifest.files.length} fichiers, ${r.ctx.assets.size} dans la release).`))
  .catch(e => {
    console.error('ECHEC : ' + e.message);
    process.exit(1);
  });
