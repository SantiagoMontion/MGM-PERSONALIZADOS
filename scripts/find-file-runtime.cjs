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

const runtimeRe = /export\s+const\s+config\s*=\s*\{[^}]*runtime/;
const apiDir = path.join(process.cwd(), 'api');
if (fs.existsSync(apiDir)) {
  for (const f of walk(apiDir)) {
    if (!/\.(js|ts)$/.test(f)) continue;
    try {
      const s = fs.readFileSync(f, 'utf8');
      if (runtimeRe.test(s)) process.stdout.write(f + '\n');
    } catch (_) {}
  }
}
