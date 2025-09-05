#!/usr/bin/env node
// Lightweight concurrent runner without extra deps
const { spawn } = require('node:child_process');

function run(cmd, args, options = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
  child.on('exit', (code) => {
    if (code !== 0) process.exitCode = code;
  });
  return child;
}

const procs = [];

function cleanup() {
  for (const p of procs) {
    try { if (p && !p.killed) p.kill('SIGTERM'); } catch {}
  }
}
process.on('SIGINT', () => { cleanup(); process.exit(); });
process.on('SIGTERM', () => { cleanup(); process.exit(); });
process.on('exit', cleanup);

// API at :3001 (vercel dev)
procs.push(run('npm', ['run', 'dev:api']));
// Frontend Vite at :5173
procs.push(run('npm', ['run', 'dev'], { cwd: 'mgm-front' }));

