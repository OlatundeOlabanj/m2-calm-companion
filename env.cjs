// Reads a named key from the environment or the .env file next to the app. Never logs or returns anything else.
const fs = require('fs');
const path = require('path');

function readEnvKey(dir, name = 'PRESAGE_API_KEY') {
  if (process.env[name]) return process.env[name].trim();
  try {
    const text = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(new RegExp('^\\s*' + name + '\\s*=\\s*(.*)\\s*$'));
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  } catch (e) { /* no .env file */ }
  return '';
}
module.exports = { readEnvKey };
