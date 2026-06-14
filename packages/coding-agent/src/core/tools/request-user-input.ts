/**
 * `request_user_input` — a built-in custom tool that lets the LLM ask the user
 * a structured question mid-turn. Uses Pi's extension_ui protocol (select/input)
 * which pauses the agent loop until the host (Hub) responds via
 * `extension_ui_response`.
 *
 * This enables the Jishu Agent planning-phase pause-resume: the planner LLM
 * calls this tool → Pi emits `extension_ui_request` → the Hub shows the question
 * to the user → the user responds → the Hub sends `extension_ui_response` → Pi
 * resumes the SAME turn with the answer.
 */

import { Type } from "typebox";
import { defineTool } from "../extensions/types.ts";

export const requestUserInputTool = defineTool({
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
});
