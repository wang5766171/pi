import * as esbuild from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read dependencies from all 4 packages
const packages = ['coding-agent', 'agent-core', 'ai', 'tui'];
const externalDeps = new Set();

for (const pkgName of packages) {
  const pkgPath = join(__dirname, '..', pkgName, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.dependencies) {
      for (const dep of Object.keys(pkg.dependencies)) {
        if (!dep.startsWith('@earendil-works/')) {
          externalDeps.add(dep);
        }
      }
    }
  }
}

const external = Array.from(externalDeps);

console.log('Externalizing the following dependencies:', external);

await esbuild.build({
  entryPoints: ['src/cli.ts', 'src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  minify: true,
  outdir: 'dist',
  external,
  format: 'esm',
  define: {
    'process.env.ESBUILD_BUNDLED': '"true"',
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
  plugins: [],
});

console.log('Build completed!');
