import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const projectDir = process.cwd();
const standaloneDir = resolve(projectDir, '.next/standalone');
const standaloneNextDir = resolve(standaloneDir, '.next');
const staticDir = resolve(projectDir, '.next/static');

if (!existsSync(resolve(standaloneDir, 'server.js'))) {
  throw new Error('Build Email, thanks first with `npm run build`.');
}
if (existsSync(staticDir)) {
  mkdirSync(standaloneNextDir, { recursive: true });
  cpSync(staticDir, resolve(standaloneNextDir, 'static'), { recursive: true });
}
if (existsSync(resolve(projectDir, 'public'))) {
  cpSync(resolve(projectDir, 'public'), resolve(standaloneDir, 'public'), { recursive: true });
}

const server = spawn(process.execPath, [resolve(standaloneDir, 'server.js')], {
  cwd: projectDir,
  env: { ...process.env, EMAILGO_DATA_DIR: process.env.EMAILGO_DATA_DIR || resolve(projectDir, 'data'), HOSTNAME: process.env.HOSTNAME || '0.0.0.0', PORT: process.env.PORT || '3000' },
  stdio: 'inherit',
});
server.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
