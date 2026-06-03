import { resetCapabilitiesCache, setCapabilities } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import {
	detectTerminalBackgroundFromEnv,
	getThemeByName,
	getThemeForRgbColor,
} from "../src/modes/interactive/theme/theme.ts";

afterEach(() => {
	resetCapabilitiesCache();
});

describe("detectTerminalBackgroundFromEnv", () => {
	it("uses the COLORFGBG background color index", () => {
		expect(detectTerminalBackgroundFromEnv({ env: { COLORFGBG: "0;15" } })).toMatchObject({
			theme: "light",
			source: "COLORFGBG",
			confidence: "high",
		});
		expect(detectTerminalBackgroundFromEnv({ env: { COLORFGBG: "15;0" } })).toMatchObject({
			theme: "dark",
			source: "COLORFGBG",
			confidence: "high",
		});
	});

	it("uses the last COLORFGBG field as the background", () => {
		expect(detectTerminalBackgroundFromEnv({ env: { COLORFGBG: "0;7;15" } }).theme).toBe("light");
	});

	it("defaults to dark without terminal background hints", () => {
		expect(detectTerminalBackgroundFromEnv({ env: {} })).toMatchObject({
			theme: "dark",
			source: "fallback",
			confidence: "low",
		});
	});
});

describe("theme color mode", () => {
	it("uses terminal capabilities", () => {
		setCapabilities({ images: null, trueColor: false, hyperlinks: false });
		const ansi256Theme = getThemeByName("dark");
		if (!ansi256Theme) throw new Error("dark theme not found");
		expect(ansi256Theme.getColorMode()).toBe("256color");
		expect(ansi256Theme.getFgAnsi("accent")).toMatch(/^\x1b\[38;5;\d+m$/);

		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		const truecolorTheme = getThemeByName("dark");
		if (!truecolorTheme) throw new Error("dark theme not found");
		expect(truecolorTheme.getColorMode()).toBe("truecolor");
		expect(truecolorTheme.getFgAnsi("accent")).toMatch(/^\x1b\[38;2;\d+;\d+;\d+m$/);
	});
});

describe("theme detection from RGB", () => {
	it("classifies RGB colors by luminance", () => {
		expect(getThemeForRgbColor({ r: 8, g: 8, b: 8 })).toBe("dark");
		expect(getThemeForRgbColor({ r: 250, g: 250, b: 250 })).toBe("light");
	});
});
