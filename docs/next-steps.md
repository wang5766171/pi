# 下一步建议：把非侵入模式推广到剩余 fork 改动

> 本文承接提交 `c019b317`——它成功把一处 fork 侵入改动（`request_user_input`，原改 `main.ts`）收敛成了扩展文件，使 `main.ts` 回到上游字节原样、合并零冲突。本文给出**下一步**：把同一思路（让上游文件保持原样，fork 差异住在外围）推广到剩余的侵入改动（集中在 `package.json` 的版本/bin/build/prepare）。该次改造的开发记录见 [`development-note.md`](./development-note.md)。

## 一、当前还有什么侵入改动

`request_user_input` 已经非侵入化了，但 fork 相对上游 `v0.80.2` 仍有这些直接改上游文件的改动：

| # | 侵入改动 | 文件 |
|---|---------|------|
| 1 | 版本 `0.80.2`→`0.80.2-8` + 包间依赖锁精确 | 5 个 `package.json` |
| 2 | `bin: pi`→`jishu` | `packages/coding-agent/package.json` |
| 3 | coding-agent `build: tsgo`→`build-bundle.mjs` | `packages/coding-agent/package.json` |
| 4 | ai `build` 移除 `generate-models` | `packages/ai/package.json` |
| 5 | `prepare: husky` 安全化 | 根 `package.json` |
| 6 | `.publish-stage/` 加入 gitignore | `.gitignore` |

这些是「下一步」要解决的全部内容。

## 二、根因

所有侵入点都在 `package.json`，根因：**fork 复用上游发布脚本（`scripts/publish.mjs`/`release.mjs`/`local-release.mjs`），而这些脚本直接读源仓库 `package.json`、不建 staging、不重写**。要让这套上游流程产出 `jishu`/`0.80.2-8`/bundle，只能改源 `package.json`。

## 三、关键洞察：蓝图已画好，只差实现

`request_user_input` 的成功证明「fork 差异住在外围」可行。而 `package.json` 这批改动，fork 其实**已经设计好了非侵入方案**，只是没实现：

| 线索 | 状态 |
|------|------|
| `build-bundle.mjs` 产出 `dist/runtime-deps.json`（bundle 的外部依赖清单） | ✅ 已实现 |
| `build-bundle.mjs` 注释说它被 `pack-pi.mjs`/`publish-pi.mjs` 消费 | ❌ 这两个脚本不存在 |
| `.gitignore` 注释说 `.publish-stage/` 由 `publish-pi.mjs` 重建 | ❌ 同上 |

即：补上 `scripts/publish-pi.mjs`（用 staging 目录重建包 + 注入 fork 差异），就能让源 `package.json` 全部回到上游原样。

## 四、推荐路线 B：单自包含包

`build-bundle.mjs` 已把 `@earendil-works/pi-*` **内联进 `dist/cli.js`**，产物自包含所有 pi 代码，运行时只剩 `runtime-deps.json` 里的外部依赖。这天然支持「只发布一个自包含包」，从而绕开 4 包版本对齐、包间依赖锁精确等所有痛点。

fork 只发布一个 `jishu` 包（或 binary），`publish-pi.mjs` 流程：

```
1. 读 fork 后缀（来自 .fork-version 文件，如 "8"）
2. npm install（workspace，链接 pi-*）          ← 上游既有步骤
3. 构建：tui/agent/ai 用 tsgo；coding-agent 用 build-bundle.mjs
4. 在 .publish-stage/jishu/ 组装发布包：
   - cp dist/cli.js
   - 生成 package.json：version=0.80.2-8、bin=jishu、dependencies=<读 runtime-deps.json>
5. cd .publish-stage/jishu && npm install --omit=dev --ignore-scripts
6. npm pack → tarball 交 jishu hub 分发；或 bun compile → binary
```

落地后，fork 差异只剩 `build-bundle.mjs` + `publish-pi.mjs`（独立脚本）+ `.fork-version`（一个数字）+ `.gitignore` 的 `.publish-stage`。

## 五、备选路线 A：完整 staging 重写

若 jishu hub 必须要 4 个独立 npm 包，`publish-pi.mjs` 在 `.publish-stage/` 重建整个 monorepo 副本，对每个 staging `package.json` 注入版本 + 包间依赖锁精确 + `bin=jishu`。更重，但同样让源仓库零侵入。

## 六、逐条侵入改动的非侵入落地点

| # | 现侵入 | 非侵入方案 | 源仓库是否回上游 |
|---|--------|-----------|:---:|
| 1 | 5 个 package.json 版本→`0.80.2-8` | staging 注入；后缀读 `.fork-version` | ✅ 全回 |
| 2 | 包间依赖锁精确 `0.80.2-8` | 路线B：bundle 消除包间依赖；路线A：staging 注入 | ✅ 全回 |
| 3 | coding-agent `build`→`build-bundle.mjs` | staging 直接调 `node build-bundle.mjs` | ✅ build 回 `tsgo` |
| 4 | ai `build` 移除 generate-models | staging 对 ai 直接调 `tsgo`（绕过 generate） | ✅ build 回上游 |
| 5 | `bin: pi`→`jishu` | staging package.json 注入 `bin: jishu` | ✅ bin 回 `pi` |
| 6 | `prepare: husky` 安全化 | 保留 `prepare: husky`，需跳过的环境设 `HUSKY=0` | ✅ prepare 回上游 |
| 7 | `.gitignore` 加 `.publish-stage` | **保留**（staging 必需，侵入极低） | ⬜ 保留 |

## 七、`-N` 后缀管理

当前 `-8` 纯手改 11 处，且 `release.mjs:27` 的 `SEMVER_RE = /^\d+\.\d+\.\d+$/` 不接受 prerelease，上游 `release:patch/minor/major` 对 fork 不可用。

方案：根目录加 `.fork-version`（内容就一个数字 `8`），`publish-pi.mjs` 读它拼成 `0.80.2-8`。fork 自身迭代只 bump 这一个文件，合并上游时不冲突。

## 八、需先确认的关键问题

1. **fork 最终分发形态**？决定路线 A/B：
   - (a) **binary**（`bun build --compile` → 重命名 jishu）→ 路线 B，且要先修 `dist/bun/cli.js` 缺口
   - (b) **单个自包含 npm 包** → 路线 B
   - (c) **4 个独立 npm 包** → 路线 A
2. **`build:binary` 现在还能跑吗**？fork 的 bundle 不产 `dist/bun/cli.js`，这条路径疑似已断。
3. **jishu 包的 `name`** 要不要改成 `jishu` / `@jishu/...`（避免和上游 npm 名冲突）？
4. **jishu hub 是从 git 拉源码构建，还是消费 npm tarball/binary**？

## 九、优先级

| 阶段 | 做什么 | 收益 |
|------|--------|------|
| P0 | 确认第八节 4 个问题（尤其分发形态） | 决定路线 |
| P1 | 实现 `scripts/publish-pi.mjs`（staging 注入）+ `.fork-version` | 非侵入核心 |
| P2 | 把 5 个 `package.json` / build / bin / prepare 全部还原上游 | 消除合并冲突 |
| P3 | 修 `build:binary` 的 `dist/bun/cli.js` 缺口（若走 binary） | 修复现存 bug |
| P4 | husky 改 `HUSKY=0`；保留 `.publish-stage` gitignore | 收尾 |

---

**总结**：`c019b317` 已经证明「让上游文件保持原样、fork 差异住在外围」是可行的（`main.ts` 回到上游、合并零冲突）。下一步把同一模式用到 `package.json` 这批改动上——补齐已画好蓝图的 `publish-pi.mjs`，fork 对上游的合并将从「每次人工保住十几处改动」降为「基本无冲突直接合并」。
