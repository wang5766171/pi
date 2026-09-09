/**
 * Tool batch guard (jishu-hub fork) —— 防御"并行工具调用爆炸"。
 *
 * 线上实录（2026-09-09 fundet-task-pilot）：退化模型在单条 assistant 消息里
 * 发射 636 个 toolCall（其中 626 个完全相同），运行时照单全收全部执行。
 *
 * 设计（2026-09-09 用户裁决，对齐主流调研结论）：**只做批内总量上限**——
 * opencode 不做任何去重（仅 agent.steps 步数预算）；Claude Code 批内封顶
 * 约 20（收紧后曾因掰断 60-80 调用的合法工作流被用户投诉）。故不做"同名
 * 同参去重"（无业界先例），上限取 50：高于主流最低值两倍、远低于爆炸量级
 * （数百），仅作防爆炸阈值而非效率配额。
 *
 * 溢出语义：超出上限的调用立即返回错误结果（协议完整：每个 toolCall 都有
 * 对应 result），指引模型"拆分为多轮"——下一轮继续，任务不中断、不丢操作。
 * 跨轮（后续 assistant 消息）不受任何限制。
 */

/** 单条消息（一个批次）允许执行的工具调用总数上限。 */
export const MAX_TOOL_CALLS_PER_BATCH = 50;

export type BatchGuardDecision = { action: "allow" } | { action: "reject"; reason: string };

/** 判定单个计划调用是否放行：批内已放行计数达到上限即拒绝。 */
export function decideToolCall(executedCount: { count: number }): BatchGuardDecision {
	if (executedCount.count >= MAX_TOOL_CALLS_PER_BATCH) {
		return {
			action: "reject",
			reason: `并行工具调用过多：单条消息最多执行 ${MAX_TOOL_CALLS_PER_BATCH} 个工具调用。请拆分为多轮，每轮只发起必要的调用；未执行的调用可在下一轮继续。`,
		};
	}
	executedCount.count += 1;
	return { action: "allow" };
}
