// Bundles Presage's renderer SDK for the window. The bundle is built on your computer from the package you installed (not committed).
const path = require('path');
const root = path.join(__dirname, '..');
require('esbuild').build({
  entryPoints: [path.join(__dirname, 'presage-entry.js')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outfile: path.join(root, 'renderer', 'presage.bundle.js'),
  nodePaths: [path.join(root, 'node_modules')],
  logLevel: 'info',
}).catch(() => process.exit(1));
