import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimePath = path.join(ROOT, 'server', 'nexus.mjs');
const vitePath = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

const children = new Set();
let shuttingDown = false;

function launch(label, args, env = process.env) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  children.add(child);
  child.once('error', error => {
    console.error(`[pro-code] ${label} failed to start:`, error);
    shutdown(1);
  });
  child.once('exit', code => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[pro-code] ${label} exited with code ${code ?? 1}`);
      shutdown(code ?? 1);
    }
  });
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(exitCode);
  }, 2_000);
  timer.unref();
  if (children.size === 0) process.exit(exitCode);
  Promise.all([...children].map(child => new Promise(resolve => child.once('exit', resolve))))
    .finally(() => process.exit(exitCode));
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const runtimeEnv = {
  ...process.env,
  PRO_CODE_HOST: process.env.PRO_CODE_HOST ?? '127.0.0.1',
  PRO_CODE_PORT: process.env.PRO_CODE_PORT ?? '8787',
};

const uiEnv = {
  ...process.env,
  VITE_NEXUS_BASE_URL: process.env.VITE_NEXUS_BASE_URL ?? 'http://127.0.0.1:8787',
  VITE_CASE_ID: process.env.VITE_CASE_ID ?? 'CASE-LOCAL-DEMO',
};

launch('local Nexus runtime', [runtimePath], runtimeEnv);
launch('Vite UI', [vitePath], uiEnv);
