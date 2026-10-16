import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	assFontIndexBuilds,
	assFontMetrics,
	assFontSizeFactor,
	resetAssFontMetricsCache,
	systemFontDirectories,
} from "../claude/handlers/claude-export-handler/ass-font-metrics.js";

/**
 * Measured with the bundled FFmpeg: at Fontsize 96, libass draws Songti SC
 * at a 96 px em (win height = 1 em), Arial at 86 px (1.117 em) and Hiragino
 * Sans GB W3 at 83 px (1.162 em). The factor below is what the ASS Fontsize
 * is multiplied by so each comes out at the em the preview shows.
 */
const hasMacFonts =
	process.platform === "darwin" &&
	existsSync("/System/Library/Fonts/Supplemental/Arial.ttf") &&
	existsSync("/System/Library/Fonts/Supplemental/Songti.ttc");

describe.skipIf(!hasMacFonts)(
	"ASS font size factor (macOS system fonts)",
	() => {
		it("reads the win height of installed families, nearest weight first", () => {
			resetAssFontMetricsCache();
			expect(assFontSizeFactor({ family: "Arial" })).toBeCloseTo(1.117, 2);
			expect(assFontSizeFactor({ family: "arial", bold: true })).toBeCloseTo(
				1.117,
				2
			);
			expect(assFontSizeFactor({ family: "Songti SC" })).toBeCloseTo(1, 3);
			expect(assFontSizeFactor({ family: "Hiragino Sans GB" })).toBeCloseTo(
				1.162,
				2
			);
			expect(
				assFontSizeFactor({ family: "Hiragino Sans GB", bold: true })
			).toBeCloseTo(1.24, 2);
		});

		it("reads the line height libass lays out (hhea ascent − descent)", () => {
			expect(assFontMetrics({ family: "Arial" }).lineHeightEm).toBeCloseTo(
				1.117,
				2
			);
			expect(assFontMetrics({ family: "Songti SC" }).lineHeightEm).toBeCloseTo(
				1.4,
				2
			);
			expect(
				assFontMetrics({ family: "Hiragino Sans GB" }).lineHeightEm
			).toBeCloseTo(1, 2);
		});

		it("leaves an unknown family alone", () => {
			expect(assFontSizeFactor({ family: "No Such Font 2026" })).toBe(1);
			expect(assFontMetrics({ family: "No Such Font 2026" })).toEqual({
				sizeFactor: 1,
				lineHeightEm: 1,
			});
		});

		it("indexes only the folders it is given", () => {
			expect(
				assFontSizeFactor({ family: "Arial", directories: ["/nonexistent"] })
			).toBe(1);
			expect(systemFontDirectories()[0]).toBe("/System/Library/Fonts");
		});

		it("scans the system fonts once and reuses that index for every overlay", () => {
			resetAssFontMetricsCache();
			const before = assFontIndexBuilds();
			assFontMetrics({ family: "Arial" });
			assFontMetrics({ family: "Songti SC", bold: true });
			assFontSizeFactor({ family: "Hiragino Sans GB" });
			expect(assFontIndexBuilds() - before).toBe(1);
			// Explicit folders get their own index and leave the cache alone.
			assFontMetrics({ family: "Arial", directories: ["/nonexistent"] });
			assFontMetrics({ family: "Arial" });
			expect(assFontIndexBuilds() - before).toBe(2);
		});
	}
);
