import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";

describe("slash commands", () => {
	it("exposes activity sync by default", () => {
		expect(BUILTIN_SLASH_COMMANDS.map((command) => command.name)).toContain("activity-sync");
	});
});
