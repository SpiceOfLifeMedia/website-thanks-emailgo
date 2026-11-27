import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

export function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
  const base = resolvePath(process.cwd(), 'src', specifier.slice(2));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.js`];
  const target = candidates.find((candidate) => existsSync(candidate));
  if (!target) throw new Error(`Could not resolve project import ${specifier}.`);
  return nextResolve(pathToFileURL(target).href, context);
}
