#!/usr/bin/env node
import { spawn } from 'node:child_process';

const envPort = process.env.DEV_API_PORT || process.env.API_PORT || process.env.PORT || '3001';
const listen = envPort.includes(':') ? envPort : `0.0.0.0:${envPort}`;

const child = spawn('vercel', ['dev', '--listen', listen], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
