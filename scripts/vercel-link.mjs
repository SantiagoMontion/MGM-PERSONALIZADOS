#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const proj = String(process.env.VERCEL_PROJECT_NAME || 'mgm-api').toLowerCase();

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  return res.status || 0;
}

// Link project non-interactively
run('npx', ['vercel@latest', 'link', '--yes', '--project', proj]);

// Pull development env
run('npx', ['vercel@latest', 'pull', '--yes', '--environment=development']);

console.log(`[vercel-link] done for project: ${proj}`);

