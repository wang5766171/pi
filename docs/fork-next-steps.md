# Fork 下一步建议：非侵入式改造路线

> 配套 [`fork-development.md`](./fork-development.md)（现状机制）。本文给出把 fork 的侵入式改动迁移到「staging 注入」模型的具体方案，目标是让仓库内的上游文件（`package.json`、`.gitignore`）保持字节级原样，合并上游时零冲突。与 `request_user_input` 扩展化是同一个思路：**让上游文件保持原样，fork 差异住在独立的外围里**。

## 一、根因

fork 当前所有侵入点都集中在 `package.json`，根因是：**fork 复用上游发布脚本（`publish.mjs`/`release.mjs`/`local-release.mjs`），而这些脚本直接从源仓库读 `package.json`、不建 staging、不重写**。为了让这套上游流程产出 `jishu`/`0.80.2-8`/bundle，只能改源 `package.json`。

## 二、关键洞察：你已经设计好了非侵入方案，只是没实现

| 线索 | 状态 |
|------|------|
| `build-bundle.mjs:73` 产出 `dist/runtime-deps.json` | ✅ 已实现 |
| `build-bundle.mjs:14-18` 注释说它被 `pack-pi.mjs`/`publish-pi.mjs` 消费 | ❌ 这两个脚本不存在 |
| `.gitignore:26-29` 注释说 `.publish-stage/` 由 `publish-pi.mjs` 重建 | ❌ 同上，脚本不存在 |

即：fork 已规划「staging 目录重建包 + 注入 fork 差异」的 `publish-pi.mjs`，连 gitignore 和 `runtime-deps.json` 都铺好了，唯独缺这个脚本本身。当前改源 `package.json` 是该设计落地前的临时妥协。

另一个关键事实：`build-bundle.mjs` 把 `@earendil-works/pi-*` **内联进 bundle**（`:41`），产出的 `dist/cli.js` **自包含所有 pi 代码**，运行时只剩 `runtime-deps.json` 里的外部依赖。这天然支持「**只发布一个自包含包**」的模型，从而绕开 4 包版本对齐、包间依赖锁精确等所有痛点。

## 三、推荐路线 B：单自包含包（匹配 bundle 设计）

fork 只发布一个自包含的 `jishu` 包（或 binary），不再发布 4 个 workspace 包。这样：

- ❌ 包间依赖问题消失（bundle 了，无包间依赖）
- ❌ 4 包版本对齐问题消失（只一个包）
- ❌ 锁精确版问题消失
- ✅ 只需在一个 staging `package.json` 上注入 `version` + `bin` + `dependencies`（来自 `runtime-deps.json`）

### `scripts/publish-pi.mjs` 流程（fork 自研，上游没有，零冲突）

```
1. 读 fork 后缀 FORK_SUFFIX（来自 .fork-version 文件或 env，如 "8"）
2. npm install（workspace，链接 pi-*）                  ← 上游既有步骤
3. 构建 bundle 的输入：
     - tui / agent：tsgo -p tsconfig.build.json
     - ai：tsgo -p tsconfig.build.json（绕过 generate-models，数据已提交）
     - coding-agent：node build-bundle.mjs → dist/cli.js + runtime-deps.json
4. 在 .publish-stage/jishu/ 组装发布包：
     - cp dist/cli.js
     - 生成 package.json：
         version: <coding-agent 上游 version>-<FORK_SUFFIX>   # 0.80.2-8
         bin:    { jishu: cli.js }
         dependencies: <读 runtime-deps.json>
5. cd .publish-stage/jishu && npm install --omit=dev --ignore-scripts
   （或生成 shrinkwrap 后 npm pack）
6. npm pack → tarball 交 jishu hub 分发；或 bun compile → binary
```

源仓库改动：**5 个 `package.json` + `.gitignore` 的 prepare/build/bin/version 全部回到上游原样**。fork 差异只剩 `build-bundle.mjs` + `publish-pi.mjs`（独立脚本）+ `.fork-version`（一个数字）+ `.gitignore` 的 `.publish-stage`（保留）。

## 四、备选路线 A：完整 staging 重写（若必须 4 包发布）

若 jishu hub 确实要 4 个独立 npm 包，`publish-pi.mjs` 在 `.publish-stage/` 重建整个 monorepo 副本，对**每个** staging `package.json` 注入 `version=0.80.2-8` + 包间依赖锁精确 `0.80.2-8` + coding-agent 的 `bin=jishu`，再重生成 lock + shrinkwrap。更重，但同样让源仓库零侵入。

## 五、逐条侵入改动的非侵入落地点

| # | 现侵入 | 非侵入方案 | 源仓库是否回上游 |
|---|--------|-----------|:---:|
| 1 | 5 个 package.json 版本→`0.80.2-8` | staging 注入；后缀读 `.fork-version` | ✅ 全回 |
| 2 | 包间依赖锁精确 `0.80.2-8` | 路线B：bundle 消除包间依赖；路线A：staging 注入 | ✅ 全回 |
| 3 | coding-agent `build`→`build-bundle.mjs` | staging 直接调 `node build-bundle.mjs` | ✅ build 回 `tsgo` |
| 4 | ai `build` 移除 generate-models | staging 对 ai 直接调 `tsgo`（绕过 generate） | ✅ build 回上游 |
| 5 | `bin: pi`→`jishu` | staging package.json 注入 `bin: jishu` | ✅ bin 回 `pi` |
| 6 | `prepare: husky` 安全化 | 保留 `prepare: husky`，需跳过的环境设 `HUSKY=0` | ✅ prepare 回上游 |
| 7 | `.gitignore` 加 `.publish-stage` | **保留**（staging 必需，侵入极低） | ⬜ 保留 |
| 8 | `build-bundle.mjs` | 保留（独立脚本，上游没有） | ⬜ 保留 |

## 六、`-N` 后缀管理（顺带解决手动 bump 痛点）

当前 `-8` 纯手改 11 个文件，且 `release.mjs:27` 的 `SEMVER_RE` 不接受 prerelease，上游 `release:patch/minor/major` 对 fork 不可用。

方案：根目录加 `.fork-version`（内容就一个数字 `8`），`publish-pi.mjs` 读它拼成 `0.80.2-8`。fork 自身迭代只 bump 这一个文件，合并上游时不冲突。

## 七、需确认的关键问题（决定方案形态）

1. **fork 最终分发形态**？决定路线 A/B：
   - (a) **binary**（`bun build --compile` → 重命名 jishu）→ 路线 B，且要先修 `dist/bun/cli.js` 缺口（见 `fork-development.md` §5.2）
   - (b) **单个自包含 npm 包** → 路线 B
   - (c) **4 个独立 npm 包**（和上游一样）→ 路线 A
2. **`build:binary` 现在还能跑吗**？fork 的 bundle 不产 `dist/bun/cli.js`，这条路径疑似已断。是否还在用 binary 分发？
3. **jishu 包的 `name`** 要不要从 `@earendil-works/pi-coding-agent` 改成 `jishu` / `@jishu/...`？（改了就不和上游 npm 名冲突，可直接 publish）
4. **jishu hub 是从 git 拉源码构建，还是消费 npm tarball/binary**？

## 八、优先级与落地顺序

| 阶段 | 做什么 | 收益 |
|------|--------|------|
| **P0** | 确认第七节 4 个问题（尤其分发形态） | 决定路线 |
| **P1** | 实现 `scripts/publish-pi.mjs`（staging 注入）+ `.fork-version` | 非侵入核心 |
| **P2** | 把 5 个 `package.json` / build / bin / prepare 全部还原上游 | 消除合并冲突 |
| **P3** | 修 `build:binary` 的 `dist/bun/cli.js` 缺口（若走 binary） | 修复现存 bug |
| **P4** | husky 改 `HUSKY=0` 环境变量；保留 `.publish-stage` gitignore | 收尾 |

## 九、风险评估

- 路线 B 最干净，但要求确认「单包/binary」分发。若实际是 4 包，走路线 A（多写点 staging 注入逻辑，思路相同）。
- 最大不确定性在第七节问题 1/2——这俩定了，方案就定型。
- P2 还原 `package.json` 后，需用 `publish-pi.mjs` 跑通一次完整构建+打包，验证产物（tarball 能装、`jishu` 命令可用、`runtime-deps.json` 依赖齐全）再合并到主分支。

---

**总结**：本方案的本质，是把 fork 已经画好蓝图（`runtime-deps.json` + `.publish-stage` 注释）但没写的那半个 `publish-pi.mjs` 补上，然后把现有侵入改动从源仓库搬进 staging。落地后，fork 对上游的合并将从「每次人工保住十几处改动」降为「基本无冲突直接合并」。
