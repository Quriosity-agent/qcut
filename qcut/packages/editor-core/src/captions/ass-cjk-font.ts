/**
 * Which font an ASS style should name for text that contains CJK.
 *
 * libass resolves a font by name and does no per-glyph fallback, so a
 * Latin-only family such as Arial renders CJK as notdef "tofu" boxes — and on
 * macOS libass asks CoreText for a CJK fallback and is pointed at the
 * reserved PingFangUI.ttc, which a third-party process cannot open, so every
 * glyph comes out an empty box. Naming a family that is both CJK-capable and
 * openable is the only reliable path.
 *
 * That substitution used to be unconditional: any CJK in the text replaced
 * the family outright, so a caption that asked for Songti SC — a serif —
 * exported in Hiragino Sans GB, a sans (N31). An explicitly chosen family
 * that can render the text has to win; the platform font is a fallback, not
 * an override.
 *
 * The native export's copy of this rule lives in
 * `electron/claude/handlers/claude-export-handler/text-overlay.ts`, because
 * Electron's tsc root cannot import this package at run time;
 * `electron/__tests__/ass-cjk-font-mirror.test.ts` keeps the two in step.
 *
 * @module @qcut/editor-core/captions/ass-cjk-font
 */

/** CJK ideographs, kana, hangul and full-width forms. */
const CJK_PATTERN = /[⺀-鿿가-힯豈-﫿＀-￯]/;

/**
 * Families that carry CJK glyphs and that libass can open. PingFang is
 * deliberately absent: macOS reserves it.
 */
export const CJK_CAPABLE_FONT_FAMILIES: readonly string[] = [
	"Songti SC",
	"Songti TC",
	"Kaiti SC",
	"Kaiti TC",
	"Heiti SC",
	"Heiti TC",
	"STSong",
	"STKaiti",
	"STHeiti",
	"STFangsong",
	"Yuanti SC",
	"Wawati SC",
	"Weibei SC",
	"Xingkai SC",
	"Hannotate SC",
	"HanziPen SC",
	"Baoli SC",
	"Libian SC",
	"LingWai SC",
	"Lantinghei SC",
	"Hiragino Sans GB",
	"Hiragino Sans",
	"Arial Unicode MS",
	"Noto Sans CJK SC",
	"Noto Sans CJK TC",
	"Noto Sans CJK JP",
	"Noto Serif CJK SC",
	"Source Han Sans",
	"Source Han Serif",
	"Microsoft YaHei",
	"SimHei",
	"SimSun",
	"FangSong",
	"KaiTi",
];

const CJK_CAPABLE_LOOKUP = new Set(
	CJK_CAPABLE_FONT_FAMILIES.map((name) => name.toLowerCase())
);

/** Whether the text needs a font with CJK coverage at all. */
export function containsCjkText(text: string): boolean {
	return CJK_PATTERN.test(text);
}

/** Whether a requested family is known to render CJK through libass. */
export function isCjkCapableFamily(family: string): boolean {
	return CJK_CAPABLE_LOOKUP.has(family.trim().toLowerCase());
}

/**
 * The family an ASS style should name: the requested one whenever it can
 * render the text, otherwise the platform's CJK fallback.
 */
export function resolveAssCjkFamily({
	family,
	text,
	fallbackFamily,
}: {
	family: string;
	text: string;
	/** The platform's CJK font; without one the requested family stands. */
	fallbackFamily?: string;
}): string {
	if (!fallbackFamily) return family;
	if (!containsCjkText(text)) return family;
	if (isCjkCapableFamily(family)) return family;
	return fallbackFamily;
}
