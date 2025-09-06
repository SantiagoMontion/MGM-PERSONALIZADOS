const fs = require('fs');
const path = require('path');

function walk(dir, res = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, res); else res.push(p);
  }
  return res;
}

const files = walk(process.cwd()).filter(f => /(^|\\|\/)vercel\.json$/.test(f));
let out = '';
for (const f of files) {
  try {
    const json = JSON.parse(fs.readFileSync(f, 'utf8'));
    if ('builds' in json || 'routes' in json) out += f + '\n';
  } catch (_) {}
}
if (out) process.stdout.write(out);
