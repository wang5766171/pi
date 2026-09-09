import { describe, expect, it } from "vitest";
import { decideToolCall, MAX_TOOL_CALLS_PER_BATCH } from "../src/harness/execution/batch-guard.ts";

describe("tool batch guard (jishu-hub fork：批内总量上限)", () => {
	it("未达上限全部放行（含相同调用——不去重，对齐主流）", () => {
		const executed = { count: 0 };
		for (let i = 0; i < MAX_TOOL_CALLS_PER_BATCH; i += 1) {
			expect(decideToolCall(executed)).toEqual({ action: "allow" });
		}
		expect(executed.count).toBe(MAX_TOOL_CALLS_PER_BATCH);
	});

	it("达到上限后拒绝，且指引下一轮继续", () => {
		const executed = { count: MAX_TOOL_CALLS_PER_BATCH };
		const decision = decideToolCall(executed);
		expect(decision.action).toBe("reject");
		expect(decision.action === "reject" && decision.reason).toContain("拆分为多轮");
		expect(executed.count).toBe(MAX_TOOL_CALLS_PER_BATCH);
	});

	it("线上实录形态：单批 636 个调用 → 50 执行 + 586 拦截", () => {
		const executed = { count: 0 };
		let allowed = 0;
		let rejected = 0;
		for (let i = 0; i < 636; i += 1) {
			if (decideToolCall(executed).action === "allow") allowed += 1;
			else rejected += 1;
		}
		expect(allowed).toBe(MAX_TOOL_CALLS_PER_BATCH);
		expect(rejected).toBe(636 - MAX_TOOL_CALLS_PER_BATCH);
	});
});
