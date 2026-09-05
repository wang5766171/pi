import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// v0.85.0 起 esbuild 打包复用上游 scripts/build-coding-agent-bundle.mjs（两段式：
// tsgo 产 dist → 上游脚本按 5 入口重打包到 dist/bundle/，正确处理 sideEffects、
// oauth/bedrock 懒加载器落位、coordinator 轻量入口与 chord external——这些是
// fork 单文件 src 打包在 v0.85.0 结构下无法正确承载的）。本文件只保留 fork 独有
// 的第 6 版能力：运行时依赖清单 runtime-deps.json 的生成。
const __dirname = dirname(fileURLToPath(import.meta.url));

// Runtime dependency closure of the bundled distribution. Internal
// @earendil-works packages are workspace-resolved; third-party packages are
// emitted into runtime-deps.json.
// v0.85.0 closure: coding-agent → chord/agent/ai/client/protocol/tui；
// agent/ai → telemetry（pi-server 已不在 coding-agent 闭包内）。
const packages = ['coding-agent', 'agent', 'ai', 'tui', 'client', 'protocol', 'chord', 'telemetry'];

// Collect the runtime dependency set (name -> version) declared by the runtime
// packages. This map is the single source of truth shared by Full (pack-pi.mjs)
// and Lite (publish-pi.mjs) packaging — it is emitted as dist/runtime-deps.json
// after the build so the two packaging paths can never drift on which deps the
// distribution needs at runtime.
const runtimeDeps = {};

// Pick the higher of two (possibly range-prefixed) semver strings. Deps are
// pinned in these package.jsons, but the same dep may appear in more than one
// package; npm resolves such conflicts to the highest, so we mirror that here.
const higherVersion = (a, b) => {
  const pa = a.replace(/^[^0-9]+/, '').split('.').map(Number);
  const pb = b.replace(/^[^0-9]+/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da > db ? a : b;
  }
  return a;
};

for (const pkgName of packages) {
  const pkgPath = join(__dirname, '..', pkgName, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!pkg.dependencies) continue;
  for (const [dep, ver] of Object.entries(pkg.dependencies)) {
    if (dep.startsWith('@earendil-works/')) continue; // workspace-resolved, not external
    const existing = runtimeDeps[dep];
    runtimeDeps[dep] = existing ? higherVersion(existing, ver) : ver;
  }
}

writeFileSync(join(__dirname, 'dist', 'runtime-deps.json'), JSON.stringify(runtimeDeps, null, 2) + '\n');
console.log(`Wrote dist/runtime-deps.json (${Object.keys(runtimeDeps).length} runtime dependencies).`);

console.log('Manifest generation completed!');
