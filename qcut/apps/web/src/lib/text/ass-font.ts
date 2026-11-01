/**
 * libass (used by the bundled FFmpeg for burned-in text and captions)
 * resolves fonts by name but performs no per-glyph fallback: a Latin-only
 * family such as Arial renders CJK content as notdef "tofu" boxes. When the
 * content needs CJK coverage, substitute a platform font that has it — CJK
 * fonts render Latin glyphs acceptably, the reverse does not hold.
 *
 * The coverage rule itself is editor-core's, so this path, the caption ASS
 * generator and the native export all agree on when to substitute.
 */
import { resolveAssCjkFamily } from "@qcut/editor-core";

const CJK_FONT_BY_PLATFORM: Record<string, string> = {
	darwin: "Arial Unicode MS",
	win32: "Microsoft YaHei",
	linux: "Noto Sans CJK SC",
};

function runtimePlatform(): string {
	if (typeof window !== "undefined" && window.electronAPI?.platform) {
		return window.electronAPI.platform;
	}
	// Node contexts (CLI, main process) have no window; use process.platform.
	// biome-ignore lint/style/noRestrictedGlobals: Node-only fallback reads process.platform, never process.env; renderer path returns above
	return typeof process !== "undefined" ? process.platform : "darwin";
}

export function assCompatibleFontFamily({
	family,
	content,
}: {
	family: string;
	content: string;
}): string {
	// A family the user chose that can already render the text keeps it: the
	// substitution used to be unconditional, so asking for Songti SC gave a
	// sans-serif instead (N31).
	return resolveAssCjkFamily({
		family,
		text: content,
		fallbackFamily:
			CJK_FONT_BY_PLATFORM[runtimePlatform()] ?? "Noto Sans CJK SC",
	});
}
