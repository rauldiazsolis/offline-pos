#!/usr/bin/env node
/**
 * Cross-platform dev orchestrator for POS monorepo.
 * Starts Vite and demo-backend in parallel without relying on shell operators.
 * Works on Windows (PowerShell/cmd), macOS, and Linux.
 */

import { spawn, spawnSync } from 'child_process';
import { platform } from 'os';

const isWindows = platform() === 'win32';

console.log('Starting POS dev environment (Vite + minibackend in parallel)...\n');

/**
 * Spawns a shell command as a single string (not an args array) — combining
 * an args array with shell:true triggers Node's DEP0190 deprecation warning.
 * On POSIX, detached:true puts the child in its own process group so the
 * whole descendant tree (shell -> pnpm -> node --watch -> ...) can be killed
 * together via the negative PID; Windows process groups work differently, so
 * cleanup there goes through `taskkill /t` instead (see killTree below).
 */
function spawnCommand(command) {
  return spawn(command, {
    stdio: 'inherit',
    shell: true,
    detached: !isWindows,
  });
}

const viteProcess = spawnCommand('vite');
const backendProcess = spawnCommand('pnpm --filter demo-backend run dev');

/**
 * Kills a spawned child and its full descendant tree, not just the
 * immediate shell process. A plain child.kill() only signals the
 * shell (cmd.exe/sh) — it does not touch grandchildren like the
 * `pnpm` -> `node --watch` -> actual-server-process chain, which would
 * otherwise survive as orphans holding their port open.
 */
function killTree(child) {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.killed) return;

  if (isWindows) {
    // /t kills the full descendant tree; /f forces it. Synchronous so
    // shutdown() below can rely on cleanup being done before the
    // orchestrator process itself exits.
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    // Negative PID targets the whole process group created by detached:true.
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Process group may already be gone — nothing left to clean up.
    }
  }
}

let shuttingDown = false;
function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down dev servers...');
  killTree(viteProcess);
  killTree(backendProcess);
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  shutdown(0);
});
process.on('SIGTERM', () => {
  shutdown(0);
});

// Handle process errors
viteProcess.on('error', (err) => {
  console.error('Vite process error:', err);
  shutdown(1);
});

backendProcess.on('error', (err) => {
  console.error('Backend process error:', err);
  shutdown(1);
});

// Forward exit codes if either process exits unexpectedly
viteProcess.on('exit', (code) => {
  if (!shuttingDown && code !== null && code !== 0) {
    console.error('Vite exited with code:', code);
    shutdown(code);
  }
});

backendProcess.on('exit', (code) => {
  if (!shuttingDown && code !== null && code !== 0) {
    console.error('Backend exited with code:', code);
    shutdown(code);
  }
});
