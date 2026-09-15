#!/usr/bin/env node
/**
 * Cross-platform dev orchestrator for POS monorepo.
 * Starts Vite and demo-backend in parallel without relying on shell operators.
 * Works on Windows (PowerShell/cmd), macOS, and Linux.
 */

import { spawn } from 'child_process';
import { platform } from 'os';

const isWindows = platform() === 'win32';
const shell = isWindows ? 'cmd' : '/bin/bash';
const shellArgs = isWindows ? ['/c'] : ['-c'];

console.log('Starting POS dev environment (Vite + minibackend in parallel)...\n');

// Spawn Vite dev server
const viteProcess = spawn('vite', [], {
  stdio: 'inherit',
  shell: true,
});

// Spawn demo-backend dev server
const backendProcess = spawn('pnpm', ['--filter', 'demo-backend', 'run', 'dev'], {
  stdio: 'inherit',
  shell: true,
});

// Handle process termination (Ctrl+C)
process.on('SIGINT', () => {
  console.log('\nShutting down dev servers...');
  viteProcess.kill();
  backendProcess.kill();
  process.exit(0);
});

// Handle process errors
viteProcess.on('error', (err) => {
  console.error('Vite process error:', err);
  process.exit(1);
});

backendProcess.on('error', (err) => {
  console.error('Backend process error:', err);
  process.exit(1);
});

// Forward exit codes if either process exits unexpectedly
viteProcess.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error('Vite exited with code:', code);
    backendProcess.kill();
    process.exit(code);
  }
});

backendProcess.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error('Backend exited with code:', code);
    viteProcess.kill();
    process.exit(code);
  }
});
