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

const re = /(now-php|vercel-php|"use"\s*:\s*"now-)/i;
for (const f of walk(process.cwd())) {
  try {
    const s = fs.readFileSync(f, 'utf8');
    if (re.test(s)) process.stdout.write(f + '\n');
  } catch (_) {}
}
