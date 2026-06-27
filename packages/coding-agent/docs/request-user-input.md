# `request_user_input` 扩展（问答式交互）

> **⚠️ 2026-06-27 更新 —— 扩展源已移交 jishu-hub 主仓纳管**
>
> 自此次起，扩展源不再由本 pi 仓库持有：
> - **源文件位置**：jishu-hub 主仓 `src-tauri/resources/extensions/request-user-input.ts`（本仓库 `.pi/extensions/request-user-input.ts` 已删除）；
> - **分发**：主仓编译期 `include_str!` 嵌入，Hub setup hook（`task_plan::ensure_request_user_input_extension`）部署到 `~/.jishu-agent/extensions/` 并幂等注册 `settings.json`，与 `jishu-task-conductor` 同机制；
> - 以下章节（§2 改动清单、§4 分发流程、§6 源码全文等）描述的是 c019b317 改造期的历史状态，保留作参考；现状以上述为准。

> 让 agent（LLM）在任务执行过程中**主动向用户提问**——给出选项让用户选，或让用户自由作答——拿到答案后继续同一个回合。这就是本 fork 所说的「问答式交互」。

本仓库以**扩展（extension）**的形式提供该能力，而非上游 pi 的内置工具。本文档说明它的设计动机、工具契约、安装分发流程，以及与上游共存时的合并注意事项。

---

## 1. 概述与动机

### 1.1 它解决什么问题

pi 是一个 agentic 编码代理：默认情况下 agent 会自主调用工具、读写文件、执行命令。但很多任务在动手之前需要人来做决策，例如：

- 「用 PostgreSQL 还是 MySQL？」
- 「这个重构要保留向后兼容，还是直接破坏式升级？」
- 「请提供部署目标的区域代号。」

`request_user_input` 让 agent 在需要时**暂停**，向用户抛出一个结构化问题，等用户作答后再继续。这与「agent 一路闷头干」形成互补，构成「问答式交互」。

### 1.2 为什么做成扩展而非内置工具

早期实现把该工具直接焊进了 pi 源码：

- 新增源文件 `packages/coding-agent/src/core/tools/request-user-input.ts`；
- 在 `packages/coding-agent/src/main.ts` 中 import 它，并注入到每个 session 的 `customTools`。

**痛点**：本仓库是 fork，需要持续合并上游 pi（例如 `v0.79.1 → v0.80.2` 这种动辄 200+ commits 的大合并）。`main.ts` 是上游高频改动的核心文件，每次合并都要人工保住那两处自研改动，极易丢失或冲突。

**改造后的形态**：把工具本体搬到扩展文件 `.pi/extensions/request-user-input.ts`，`main.ts` 回到与上游字节一致的原样。于是：

- 合并上游时 `main.ts` **不再产生冲突**；
- 扩展文件位于 `.pi/extensions/`，上游不会在该路径下维护同名文件，**同样不会冲突**；
- 功能零损失——扩展注册的工具与原内置注入走的是同一条合并路径（见 [§3.4](#34-与内置实现完全等价)）。

---

## 2. 自研改动清单

| 动作 | 路径 | 说明 |
| --- | --- | --- |
| **新增** | `.pi/extensions/request-user-input.ts` | 扩展源文件（本仓库的唯一来源，随 git） |
| **还原** | `packages/coding-agent/src/main.ts` | 移除 `requestUserInputTool` 的 import 与 `customTools` 注入，恢复上游 `v0.80.2` 原样 |
| **删除** | `packages/coding-agent/src/core/tools/request-user-input.ts` | 旧的内置工具源文件，内容已平移进扩展 |
| **新增** | `packages/coding-agent/docs/request-user-input.md` | 本文档 |

> 改造后 `packages/coding-agent/src` 下不再出现 `requestUserInputTool` / `request-user-input` 的任何引用。

---

## 3. 工具契约

### 3.1 元信息

| 字段 | 值 |
| --- | --- |
| `name` | `request_user_input`（LLM 工具调用名） |
| `label` | `Request User Input` |
| `description` | 在任务执行期间向用户请求结构化输入；需要用户在选项间选择或补充信息时使用；agent 会暂停直到用户响应 |
| `promptSnippet` | `request_user_input: Ask the user a question or offer choices`（出现在默认系统提示的 Available tools 段） |

### 3.2 参数（parameters）

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `question` | `string` | 是 | 要问用户的问题 |
| `options` | `string[]` | 否 | 可选项。**省略**表示自由文本输入；**提供**表示让用户在选项中选择 |

### 3.3 `execute` 行为

```
有 options（非空数组）  →  ctx.ui.select(question, options)   多选一
无 options              →  ctx.ui.input(question)             自由文本
```

- 两者都是 `await`，**会阻塞工具执行，从而暂停 agent loop**，直到用户响应——即「pause-resume」语义。
- 用户响应文本作为工具结果（`text` content）返回给 agent，agent 据此继续**同一个回合**。
- 用户取消时返回 `(no response)`。

### 3.4 与内置实现完全等价

扩展注册的工具与曾经的内置 `customTools` 注入走的是**同一条合并路径**，因此对 agent 而言行为完全一致：

- `agent-session.ts`（`createAgentSession`）在组装可用工具集时，把 `getAllRegisteredTools()`（扩展注册）与 `_customTools`（内置注入）合并进同一个列表；
- `wrapper.ts` 的 `wrapRegisteredTools(...)` 用同一套逻辑把 `ToolDefinition` 包装成 `AgentTool`；
- 两者默认都对所有 session 可用；被 `excludeTools` / `noTools` 排除时一视同仁。

工具 `execute` 收到的 `ctx` 类型即 `ExtensionContext`，其 `ui.select` / `ui.input`（定义于 `core/extensions/types.ts` 的 `ExtensionUIContext`）正是被调用的方法——与改造前完全相同。

### 3.5 不同运行模式下的行为

- **TUI 模式**：`ctx.ui.select` / `ctx.ui.input` 弹出终端选择框 / 输入框，用户在界面上交互。
- **RPC / Hub 模式**：通过 pi 的 `extension_ui` 协议（`extension_ui_request` / `extension_ui_response`）异步与宿主交互，同样阻塞等待宿主回传答案后再恢复回合。
- **headless / print 模式**：无对话能力的模式下 UI 为 no-op，调用会立即返回 `undefined`（即 `(no response)`）。

---

## 4. 安装与分发流程

本仓库只提供扩展**来源**，实际部署由 **jishu hub** 完成。

```
pi 仓库（随 git）                         用户机器（运行时）
─────────────────────                    ─────────────────────────────────
.pi/extensions/                    部署    ~/.jishu-agent/extensions/
  request-user-input.ts   ──────────────▶   request-user-input.ts
        ▲                                        │
        │ jishu hub 取源                          │ pi 启动
        │                                        ▼
   jishu hub 安装流程                    discoverAndLoadExtensions 自动发现
                                        （loader.ts），任意 cwd 生效
```

### 4.1 pi 侧：自动发现机制

pi 启动时由 `discoverAndLoadExtensions`（`packages/coding-agent/src/core/extensions/loader.ts`）扫描两个标准位置：

1. **项目级**：`<cwd>/.pi/extensions/`
2. **全局级**：`<agentDir>/extensions/`，即 `~/.jishu-agent/extensions/`

发现规则（`discoverExtensionsInDir`）：

- 直接文件 `*.ts` / `*.js` → 加载；
- 子目录含 `index.ts` / `index.js` → 加载；
- 子目录含带 `"pi"` 字段的 `package.json` → 按声明加载。

扩展文件用 jiti 直接加载 TypeScript，所需依赖（`@earendil-works/*`、`typebox`）由 pi 通过 `virtualModules` 注入，**无需扩展自带 `node_modules`**。

> 本仓库根的 `.pi/extensions/` 未被 `.gitignore` 忽略（仅 `.pi/hf-sessions/`、`.pi/hf-sessions-backup/`、`.pi_config/` 等被忽略），可正常随 git 提交。

### 4.2 jishu hub 侧：部署到全局

jishu hub 负责把本仓库的 `.pi/extensions/request-user-input.ts` 部署到目标机器的全局扩展目录 `~/.jishu-agent/extensions/request-user-input.ts`。这样无论在哪个项目目录运行 pi，该工具都会被自动加载。

> **分发注意**：若 jishu hub 安装的是 pi 的 npm 包 / binary 而非从 git 仓库取文件，需确保该扩展能被 jishu hub 拿到（从 git 拉取，或在 pi 构建时打入产物）。这属于 jishu hub 的实现细节，本仓库只需保证存在稳定的源路径 `.pi/extensions/request-user-input.ts`。

---

## 5. 使用示例

工具由 agent 自主调用。要触发它，最直接的方式是在提示里表达「需要用户决策」的意图，并依赖系统提示里 `request_user_input` 的 `promptSnippet` 与 `description` 引导模型调用。

**示例 1：选择题（提供 `options`）**

> 用户：「帮我初始化一个新服务。」
> agent（内部判断需要确认技术栈）→ 调用：
> ```json
> {
>   "question": "数据库选型？",
>   "options": ["PostgreSQL", "MySQL", "SQLite"]
> }
> ```
> → 终端弹出选择框 → 用户选 `PostgreSQL` → agent 用该选择继续。

**示例 2：简答题（不提供 `options`）**

> agent 调用：
> ```json
> { "question": "请提供部署目标的区域代号（如 cn-east-1）。" }
> ```
> → 弹出输入框 → 用户输入 `cn-east-1` → agent 继续完成部署脚本。

**典型场景**：需求澄清、技术二选一 / 多选一、收集环境特定参数、危险操作前的确认式补充信息。

> 若希望 agent 更积极地使用该工具，可在项目/全局 system prompt（`.pi/prompts/`）中加一条指引，例如：「在动手实现前，若存在关键歧义，优先用 `request_user_input` 向用户确认。」

---

## 6. 扩展源码全文

文件：`.pi/extensions/request-user-input.ts`

```ts
/**
 * `request_user_input` — a tool that lets the LLM ask the user a structured
 * question mid-turn (multiple-choice via `options`, or free-text). It pauses
 * the agent loop until the user responds, then resumes the same turn with the
 * answer.
 *
 * This file is the source of truth for the extension inside the pi repo. The
 * jishu hub installer deploys it to the global extensions dir
 * (`~/.jishu-agent/extensions/`) so the tool is available in every project.
 *
 * Implemented as an extension (rather than a built-in `customTool` injected in
 * `main.ts`) so that `main.ts` stays byte-identical to upstream and merges no
 * longer conflict on this feature. See
 * `packages/coding-agent/docs/request-user-input.md` for full context.
 */
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function requestUserInputExtension(pi: ExtensionAPI) {
	pi.registerTool(
		defineTool({
			name: "request_user_input",
			label: "Request User Input",
			description:
				"Request structured input from the user during task execution. Use when you need the user to choose between options or provide information before continuing. The agent will pause until the user responds.",
			promptSnippet: "request_user_input: Ask the user a question or offer choices",
			parameters: Type.Object({
				question: Type.String({
					description: "The question to ask the user",
				}),
				options: Type.Optional(
					Type.Array(Type.String(), {
						description: "Available choices. Omit for free-text input.",
					}),
				),
			}),

			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const { question, options } = params as { question: string; options?: string[] };
				let response: string | undefined;

				if (options && options.length > 0) {
					response = await ctx.ui.select(question, options);
				} else {
					response = await ctx.ui.input(question);
				}

				return {
					content: [{ type: "text" as const, text: response ?? "(no response)" }],
					details: undefined,
				};
			},
		}),
	);
}
```

---

## 7. 与上游共存的合并注意事项

- **`main.ts` 不再冲突**：改造后 `main.ts` 与上游 `v0.80.2` 在本特性相关位置完全一致，合并上游时该文件不再因 `requestUserInputTool` 产生冲突。
- **扩展文件不冲突**：`.pi/extensions/request-user-input.ts` 是本仓库独有，上游不会在此路径维护同名文件。
- **升级流程**：拉取上游新版本时，本扩展无需任何人工干预——它独立于 pi 源码树。仅需确认 pi 的扩展 API（`ExtensionAPI.registerTool`、`ExtensionUIContext.select/input`）未发生破坏性变更（见下）。
- **需关注的上游变更**：若上游调整了扩展工具的 `execute` 签名或 `ExtensionUIContext` 接口，需同步更新本扩展。可对照 `packages/coding-agent/src/core/extensions/types.ts`。

---

## 8. 验证

1. **类型 / 编译**：对 `packages/coding-agent` 运行 `tsc`（或 `pi-test.sh`），确认删除旧源文件、还原 `main.ts` 后 0 error、`src` 下无 `requestUserInputTool` 残留引用。
2. **扩展加载**：在 pi 仓库根运行 pi（dogfooding，自动加载 `.pi/extensions/`），通过 `/tools` 或 agent 工具列表确认 `request_user_input` 出现在可用工具中。
3. **端到端**：引导 agent 调用 `request_user_input`——带 `options` 弹选择框、不带弹输入框，作答后 agent 用答案继续同一回合，行为与改造前一致。
4. **RPC 模式**：在 RPC / Hub 模式下确认 `ctx.ui.select/input` 仍经 `extension_ui` 协议正常 pause-resume。
5. **合并冲突消除**：模拟合并上游 `main.ts` 更新，确认不再因本特性产生冲突。
6. **文档一致性**：核对本文档中的工具名、参数、文件路径、分发流程与实际代码一致。

---

## 9. 版本对应

- 改造基于 `release_v0.80.2-8`（上游基线 `v0.80.2`）落地。
- 之后每次合并上游升级，若扩展 API 无破坏性变更，本扩展无需改动；若有，按 [§7](#7-与上游共存的合并注意事项) 同步。
