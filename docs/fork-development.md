# Fork 开发说明：构建、版本与发布机制

> 本文档面向 fork 维护者，说明 fork（基于上游 `earendil-works/pi` v0.80.2）相对上游的自研改动**当前是如何运作的**。配套文档 [`fork-next-steps.md`](./fork-next-steps.md) 给出将这些改动「非侵入化」的改造建议。
>
> 调研基准：`git diff 0201806a..HEAD`（`0201806a` = 上游 `Release v0.80.2`）。

## 概述

fork 在上游 v0.80.2 上叠加自研改动，目标是让 pi 以 **`jishu` 命令、`0.80.2-8` 版本、bundle 形态**发布。当前实现方式是**直接修改上游的 `package.json` 等文件**，导致每次合并上游都要人工解决冲突。

自研改动全景（相对上游 v0.80.2）：

| 改动 | 文件 | 性质 |
|------|------|------|
| 版本 `0.80.2`→`0.80.2-8` + 包间依赖锁精确 | 5 个 `package.json` | 侵入（高频冲突） |
| `bin: pi`→`jishu` | `packages/coding-agent/package.json` | 侵入 |
| `build: tsgo`→`build-bundle.mjs` | `packages/coding-agent/package.json` | 侵入 |
| ai `build` 移除 `generate-models` | `packages/ai/package.json` | 侵入 |
| `prepare: husky` 安全化 | 根 `package.json` | 侵入（低） |
| `.publish-stage/` 加入 gitignore | `.gitignore` | 侵入（低） |
| `build-bundle.mjs` | 新文件 | 非侵入 |
| `request_user_input` 扩展 + 文档 | `.pi/extensions/`、`packages/coding-agent/docs/` | 非侵入 |

> `scripts/` 下所有脚本均为上游原样，fork 未改一行（`git diff 0201806a..HEAD --stat -- scripts/` 为空）。

---

## 1. 构建机制

### 1.1 上游构建 vs fork bundle

- **上游** coding-agent `build`：`tsgo -p tsconfig.build.json && shx chmod +x dist/cli.js && npm run copy-assets`，用 TypeScript 原生编译器输出**镜像 `src/` 的多文件 `dist/` 树**（数百个 `.js` + `.d.ts` + `.map`）。
- **fork** 把 `build` 改成 `node build-bundle.mjs && ...`，用 esbuild 把 `src/cli.ts` + `src/index.ts` 打成**单文件 minified ESM bundle**（`dist/cli.js` + `dist/index.js`），并把 `@earendil-works/pi-*` workspace 包**内联进 bundle**，其余依赖标记为 external。

### 1.2 为什么 bundle

根本原因是 **wasm 路径问题**：`@silvia-odwyer/photon-node` 的 CJS 入口执行 `fs.readFileSync(__dirname + '/photon_rs_bg.wasm')`，在 `bun build --compile` 产出的 binary 里会把构建机的绝对路径固化进去。bundle 让 `dist/cli.js` 自包含，配合 `runtime-deps.json` 声明运行时外部依赖，使发布的包不依赖完整的 `node_modules/@earendil-works/*` 目录树。

### 1.3 `runtime-deps.json`

`build-bundle.mjs` 扫描 4 个包的 `dependencies`，排除 `@earendil-works/*`（已 inline），取每个外部依赖的最高版本，写入 `dist/runtime-deps.json`。设计意图（见 `build-bundle.mjs:14-18` 注释）是作为「bundle 外部依赖清单」的单一事实来源，供打包脚本消费。**但目前没有任何脚本消费它**（见第 5 节）。

### 1.4 ai 移除 `generate-models`

上游 ai 的 `build` 含 `generate-models && generate-image-models`，这两个脚本是**实时网络抓取**（向 NVIDIA NIM、OpenRouter、models.dev、AI Gateway 等 `fetch`），在受限/离线环境会卡住或失败。fork 从 build 链移除它们。

产物（`src/models.generated.ts`、`src/image-models.generated.ts`、`src/providers/*.models.ts`）**已提交进 git**，故构建无需重新生成。上游仅在发布准备期（`release.mjs:169-170`）重新生成。

---

## 2. 版本与依赖机制

### 2.1 版本号 `0.80.2-8`

fork 把所有包版本改成 `0.80.2-8`（semver prerelease）。**没有任何脚本处理 `-8` 后缀**——全仓库 grep `preid`/`prerelease` 零命中，bump 完全靠人工编辑 `package.json`。`-N` 沿用 `0.79.1-N` 的计数习惯（每个上游版本独立计数还是延续，需维护者确认约定）。

上游版本流水线（根 `package.json` 的 `version:patch/minor/major`）：`npm version <bump> -ws` → `sync-versions.js` → `npm install --package-lock-only`。但 `release.mjs:27` 的 `SEMVER_RE = /^\d+\.\d+\.\d+$/` **不接受 prerelease**，故上游 `release:patch/minor/major` 对 fork 不可用。

### 2.2 包间依赖为何锁精确版

上游 `sync-versions.js` 把包间依赖写成 `^${version}`（永远带 `^`，见 `sync-versions.js:58`）。fork 改成 prerelease `0.80.2-8` 后，**`^0.80.2` 不匹配 `0.80.2-8`**——semver 规则：prerelease 版本只在范围下界也带 prerelease 时才被纳入；`^0.80.2` 展开为 `>=0.80.2 <0.81.0`，下界不含 prerelease，故 `0.80.2-8`（语义上 `< 0.80.2`）被排除。若不锁精确，`npm install` 会去 registry 拉上游官方 `0.80.2` 而非 fork 的 `0.80.2-8`。因此 fork 手动把包间依赖锁成精确 `0.80.2-8`。

`sync-versions.js` 不处理精确版本，所以 fork bump 后**不能跑它**（会把精确版覆盖回 `^`）。

### 2.3 shrinkwrap

coding-agent 用 `npm-shrinkwrap.json`（非 package-lock）锁定完整外部依赖树，由 `generate-coding-agent-shrinkwrap.mjs` 从根 `package-lock` + 各 `package.json` 生成。`version`、`resolved` URL、内部包 `dependencies` 全源自 `package.json`。`check:shrinkwrap`（`npm run check` 的一部分）严格比对，故改版本后必须重跑 `shrinkwrap:coding-agent`。

### 2.4 `check:pinned-deps`

`check-pinned-deps.mjs` 要求依赖为精确 semver，但**豁免内部 workspace 依赖**（`@earendil-works/pi-*`，见 `:24-26`）。故 `^0.80.2` 与精确 `0.80.2-8` 的包间依赖都能通过——fork 锁精确版与此 check 无关，纯粹为 semver prerelease 匹配。

---

## 3. 发布机制

fork **完全复用上游发布脚本**：

- `scripts/publish.mjs`：逐包、原位 `npm publish --provenance --ignore-scripts`（设计为 CI OIDC 可信发布），**直接读源仓库 `package.json`，不重写、不建 staging**。
- `scripts/release.mjs`：bump 版本 + 更新 CHANGELOG + 重生成产物 + `npm run check` + commit + 打 tag `v${version}` + push（tag 触发 CI 发布）。
- `scripts/local-release.mjs`：仓库外打包 4 个包 tarball 做冒烟，构建 bun compile binary。

fork 的侵入式 `package.json` 改动，正是为了让这套上游流程产出 `jishu` / `0.80.2-8` / bundle。fork 的实际分发通过外部 **jishu hub** 项目完成（见 `packages/coding-agent/docs/request-user-input.md` 第 4 节），形态为 binary 或单包。

---

## 4. 其他自研改动

- **husky prepare 安全化**：根 `package.json` `prepare: husky` 包了 try/catch，防止无 husky 环境 install 失败。根 `package.json` 是 private monorepo，`prepare` 仅在 clone+install 时跑。
- **`.publish-stage` gitignore**：`.gitignore` 加 `.publish-stage/`（4 行），对应计划中的 staging 目录。
- **jishu 命名**：coding-agent `bin: { pi }` → `{ jishu }`。

---

## 5. 现存问题 / 已知缺口

1. **`runtime-deps.json` 零消费者**：`build-bundle.mjs` 产出它，注释说被 `pack-pi.mjs`(Full) / `publish-pi.mjs`(Lite) 消费，但这两个脚本**不存在**。`.publish-stage/` + 其 gitignore 同属一个「计划中但未实现的 staging 发布设计」。
2. **`build:binary` 路径缺口**：coding-agent `build:binary` 引用 `./dist/bun/cli.js`，但 `build-bundle.mjs` 只产 `dist/cli.js` + `dist/index.js`，**不产 `dist/bun/cli.js`**。fork 的 binary 构建路径很可能已损坏（需确认是否还在用）。
3. **types 缺失**：`build-bundle.mjs` 不产 `.d.ts`，但 `package.json` 仍声明 `types: dist/index.d.ts`，若有消费者把 jishu 当库 import 会类型缺失。
4. **`ESBUILD_BUNDLED` 死代码**：`build-bundle.mjs` define 了 `process.env.ESBUILD_BUNDLED='true'`，但 `src/` 无任何引用。
5. **`build-bundle.mjs` 注释笔误**：包列表写了 `agent-core`（实际目录是 `agent`），靠 `existsSync` 兜底。

---

## 6. 自研 vs 上游 文件清单

- **fork 自研新增**：`packages/coding-agent/build-bundle.mjs`、`.pi/extensions/request-user-input.ts`、`packages/coding-agent/docs/request-user-input.md`、本目录两份文档。
- **fork 侵入上游**：5 个 `package.json`、`.gitignore`。
- **纯上游未改**：`scripts/` 全部、`packages/*/src/` 全部。
