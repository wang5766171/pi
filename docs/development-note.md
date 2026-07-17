# 开发说明：`request_user_input` 从内置工具改造为扩展

> 对应提交 **`c019b317`**（`feat(coding-agent): 将 request_user_input（问答式交互）改造为扩展，main.ts 回到上游原样`）。
>
> 本文档从**开发/维护者视角**记录这次改造：做了什么、为什么这么做、关键技术决策、验证结论。工具本身的使用说明（契约、参数、使用示例、分发流程）见配套的完整文档 [`packages/coding-agent/docs/request-user-input.md`](../packages/coding-agent/docs/request-user-input.md)；改造之后的后续计划见 [`next-steps.md`](./next-steps.md)。

## 一、背景与动机

「问答式交互」是本 fork 最重要的自研特性：让 agent（LLM）在任务执行中途**主动向用户提问**——给选项让用户选，或让用户自由作答——拿到答案后继续同一个回合。

改造前，它以**改源码**方式实现：

- 新增 `packages/coding-agent/src/core/tools/request-user-input.ts`（内置工具源文件）；
- 在 `packages/coding-agent/src/main.ts` 中 import 它，并注入到每个 session 的 `customTools`。

**痛点**：本仓库是 fork，需要持续合并上游 pi（如 `v0.79.1 → v0.80.2` 这种动辄 200+ commits 的大合并）。`main.ts` 是上游高频改动的核心文件，每次合并都要人工保住那两处自研改动，极易丢失或冲突。

## 二、改造方案：内置 → 扩展

把工具本体从源码树搬到**扩展文件** `.pi/extensions/request-user-input.ts`，让 `main.ts` 回到与上游字节一致的原样。

| 维度 | 改造前（内置 customTool） | 改造后（扩展） |
|------|------------------------|--------------|
| 工具源码位置 | `src/core/tools/request-user-input.ts` | `.pi/extensions/request-user-input.ts` |
| 注入方式 | `main.ts` import + `customTools` 注入 | `pi.registerTool(defineTool(...))` |
| 对 `main.ts` 的改动 | 改 2 处（import + 注入） | 0 处（已还原上游） |
| 合并上游冲突 | 高（`main.ts` 高频文件） | 无 |
| 分发 | 随 pi 源码/包 | jishu hub 部署到 `~/.jishu-agent/extensions/`，任意 cwd 生效 |

## 三、改动清单（精确到行）

提交 `c019b317` 共改动 4 个文件（`+312 / -50`）：

| 动作 | 文件 | 内容 |
|------|------|------|
| 新增 | `.pi/extensions/request-user-input.ts`（55 行） | 扩展源，工具本体平移于此 |
| 删除 | `packages/coding-agent/src/core/tools/request-user-input.ts`（48 行） | 旧内置工具源文件，内容已平移进扩展 |
| 修改 | `packages/coding-agent/src/main.ts`（−2/+1） | 见下 |
| 新增 | `packages/coding-agent/docs/request-user-input.md`（256 行） | 完整中文工具说明 |

`main.ts` 的两处改动：

1. 删除 import：`import { requestUserInputTool } from "./core/tools/request-user-input.ts";`
2. 还原注入：`customTools: [...(sessionOptions.customTools ?? []), requestUserInputTool],` → `customTools: sessionOptions.customTools,`

## 四、关键技术决策：零损失的等价性

改造的核心顾虑是「扩展版会不会比内置版弱」。结论：**完全等价，行为零差异**。

1. **类型匹配**：`ExtensionAPI.registerTool(ToolDefinition)`（`core/extensions/types.ts:1178`）接受 `ToolDefinition`，而工具用的 `defineTool(...)`（`types.ts:493`）返回值正是该类型。
2. **执行上下文不变**：`execute` 收到的 `ctx` 即 `ExtensionContext`，其 `ui.select` / `ui.input`（`types.ts:124-135` 的 `ExtensionUIContext`）正是改造前调用的方法。
3. **同一合并路径**：扩展注册的工具与原 `customTools` 走的是**同一条合并路径**——`agent-session.ts`（`createAgentSession`）把 `getAllRegisteredTools()`（扩展注册）与 `_customTools`（内置注入）合并进同一工具集，`wrapper.ts` 的 `wrapRegisteredTools(...)` 用同一套逻辑包装。两者默认对所有 session 可用；被 `excludeTools` / `noTools` 排除时一视同仁。

因此对 agent 而言，扩展版与内置版完全一致——这不是「换了个功能近似的东西」，而是「同一工具换了个注册入口」。

## 五、`main.ts` 回到上游原样的证明

还原后，`packages/coding-agent/src/main.ts` 的 git blob 为 `50a19bba`，与上游 `v0.80.2` 的 `main.ts` **字节一致**（git blob 比对）。这比「逐行人工核对」更强——blob 相等意味着该文件对上游零差异，合并上游时该文件**不会产生任何冲突点**。

## 六、验证

| 项 | 方法 | 结果 |
|----|------|------|
| `main.ts` 对齐上游 | git blob 比对 | ✅ `50a19bba` == 上游 v0.80.2 |
| 无残留引用 | `src` 下 grep `requestUserInputTool` / `request-user-input` | ✅ 零命中 |
| 类型 / 编译 | `npm run check`（tsgo + biome） | ⏳ **未执行**——本地未安装 `node_modules`，待装依赖环境补跑 |
| 扩展加载 / 端到端 | dogfood + 引导 agent 调用 | ⏳ 同上，待运行环境验证 |

> 类型检查与端到端验证因本地缺 `node_modules` 暂未执行，这是本次改造**唯一未闭环**的部分，需在已装依赖的环境补跑 `npm run check` 并做一次 dogfood 确认。

## 七、后续维护

- **合并上游**：`main.ts` 不再有冲突点；`.pi/extensions/request-user-input.ts` 是本仓库独有路径，上游不会维护同名文件，同样不冲突。
- **需关注的上游变更**：仅当上游调整了扩展工具的 `execute` 签名或 `ExtensionUIContext` 接口时，需同步更新本扩展。可对照 `packages/coding-agent/src/core/extensions/types.ts`。
- **下一步**：本次把「改源码」收敛成了「放扩展文件」，是 fork 非侵入化的成功先例。把同样的模式推广到其余侵入改动（`package.json` 的版本/bin/build/prepare 等），见 [`next-steps.md`](./next-steps.md)。

## 八、扩展源移交主仓纳管（2026-06-27）

为彻底解耦 pi submodule，扩展源已从本仓库 `.pi/extensions/request-user-input.ts` 移交 **jishu-hub 主仓** 纳管：

- **新源位置**：主仓 `src-tauri/resources/extensions/request-user-input.ts`，内容与本仓库原文件一致；
- **分发机制**：主仓编译期 `include_str!` 嵌入，Hub setup hook（`task_plan::ensure_request_user_input_extension`）部署到 `~/.jishu-agent/extensions/` 并幂等注册 `settings.json`，与 `jishu-task-conductor` 完全同机制；
- **本仓库状态**：`.pi/extensions/request-user-input.ts` 已删除（`main.ts` 仍保持上游原样，无引用残留）。

> §二表格中的「工具源码位置」、§七中「本仓库独有路径」等描述反映的是 c019b317 改造时的历史状态；现状以本节为准。pi 的扩展 API（`ExtensionAPI.registerTool`、`ExtensionUIContext`）未变，扩展源在新位置仍等价工作。
