#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const envPort = process.env.DEV_API_PORT || process.env.API_PORT || process.env.PORT || '3001';
const listen = envPort.includes(':') ? envPort : `0.0.0.0:${envPort}`;

const require = createRequire(import.meta.url);

let command = process.execPath;
let args = [];

try {
  const vercelBin = require.resolve('vercel/dist/index.js');
  args = [vercelBin, 'dev', '--listen', listen];
} catch (error) {
  const npmExec = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  command = npmExec;
  args = ['vercel', 'dev', '--listen', listen];
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32' && command !== process.execPath,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
