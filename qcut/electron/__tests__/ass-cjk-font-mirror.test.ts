/**
 * The native export carries its own copy of the CJK font rule, because
 * Electron's tsc root cannot import editor-core at run time. This keeps the
 * two in step: a family one path honours, the other must honour too.
 *
 * N31: the renderer's copy substituted the platform CJK font for any CJK
 * text, so a caption asking for Songti SC exported in Hiragino Sans GB while
 * the native export rendered it in Songti SC — the two paths disagreed on the
 * typeface for exactly the families listed here.
 */
import { describe, expect, it } from "vitest";
import {
	CJK_CAPABLE_FONT_FAMILIES,
	resolveAssCjkFamily,
} from "../../packages/editor-core/src/captions/ass-cjk-font.js";
import { assFontFamily } from "../claude/handlers/claude-export-handler/text-overlay.js";
import type { TextOverlay } from "../claude/handlers/claude-export-handler/types.js";

const CJK_TEXT = "三年前";
/** macOS's fallback, which the native path picks on this platform. */
const DARWIN_FALLBACK = "Hiragino Sans GB";

const overlay = (fontFamily: string, content = CJK_TEXT) =>
	({ fontFamily, content }) as TextOverlay;

const shared = (family: string, content = CJK_TEXT) =>
	resolveAssCjkFamily({
		family,
		text: content,
		fallbackFamily: DARWIN_FALLBACK,
	});

describe("CJK font rule mirror", () => {
	it("honours every family on the shared list, in both copies", () => {
		for (const family of CJK_CAPABLE_FONT_FAMILIES) {
			expect(shared(family)).toBe(family);
			expect(assFontFamily(overlay(family))).toBe(family);
		}
	});

	it("keeps the requested family for text that needs no CJK coverage", () => {
		expect(shared("Gill Sans", "QCUT")).toBe("Gill Sans");
		expect(assFontFamily(overlay("Gill Sans", "QCUT"))).toBe("Gill Sans");
	});

	it("falls back together for a family that cannot render CJK", () => {
		// Deliberately not an installed face, so the native path's own
		// font-file check cannot rescue it either.
		const absent = "QCutNotAnInstalledFamily";
		expect(shared(absent)).toBe(DARWIN_FALLBACK);
		expect(assFontFamily(overlay(absent))).toBe(DARWIN_FALLBACK);
	});

	it("leaves the family alone when no fallback is offered", () => {
		expect(resolveAssCjkFamily({ family: "Gill Sans", text: CJK_TEXT })).toBe(
			"Gill Sans"
		);
	});
});
