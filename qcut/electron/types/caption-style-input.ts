/**
 * Caption style input from the editor API (add-element, batch-add, patch,
 * `captions import --style`). A caption keeps its look in `style`, with the
 * subtitle names (`fontColor`, `outlineWidth`, `bgOpacity`, `shadowOffset`,
 * `position.align`…); text elements use other names for the same things
 * (`color`, `strokeWidth`, `backgroundOpacity`, `shadowOffsetX/Y`,
 * `verticalAlign`…). Both spellings are accepted, inside `style` or at the
 * element's top level, and every field that cannot be used is named instead
 * of being dropped silently.
 *
 * Pure: the renderer applies the result, the HTTP route reports its
 * warnings for single adds (whose renderer reply carries no data).
 *
 * @module electron/types/caption-style-input
 */

type FieldReader = (value: unknown) => unknown;

const KARAOKE_MODES = [
	"none",
	"word-highlight",
	"word-by-word",
	"karaoke",
	"bounce",
	"typewriter",
	"slam",
	"spring",
	"overlap",
	"expand",
	"shine",
	"pulse",
	"fly-in",
	"gather",
	"flip",
	"blur-roll",
	"glitch",
	"mischief",
];

const INVALID = Symbol("invalid");

/**
 * A colour as the editor stores it: `#rgb` becomes `#rrggbb`; other CSS
 * colours (`transparent`, `rgba(…)`) are kept as given, since presets store
 * them and a timeline export must apply back unchanged.
 */
function color(value: unknown): unknown {
	if (typeof value !== "string" || !value.trim()) return INVALID;
	const trimmed = value.trim();
	const short = /^#([0-9a-f]{3})$/i.exec(trimmed)?.[1];
	return short
		? `#${[...short].map((digit) => digit + digit).join("")}`
		: trimmed;
}

function number({ min, max }: { min?: number; max?: number } = {}) {
	return (value: unknown): unknown =>
		typeof value === "number" &&
		Number.isFinite(value) &&
		(min === undefined || value >= min) &&
		(max === undefined || value <= max)
			? value
			: INVALID;
}

function oneOf(...allowed: string[]) {
	return (value: unknown): unknown =>
		typeof value === "string" && allowed.includes(value) ? value : INVALID;
}

function boolean(value: unknown): unknown {
	return typeof value === "boolean" ? value : INVALID;
}

function text(value: unknown): unknown {
	return typeof value === "string" && value.trim() ? value.trim() : INVALID;
}

/** The subtitle style fields, each with what it accepts. */
const CAPTION_STYLE_FIELDS: Record<
	string,
	{ read: FieldReader; expects: string }
> = {
	fontFamily: { read: text, expects: "a font family name" },
	fontSize: { read: number({ min: 1 }), expects: "a size in canvas pixels" },
	letterSpacing: { read: number(), expects: "pixels" },
	textAlign: {
		read: oneOf("left", "center", "right"),
		expects: "left, center or right",
	},
	fontColor: { read: color, expects: "a colour (#rrggbb)" },
	fontOpacity: { read: number({ min: 0, max: 1 }), expects: "0–1" },
	bold: { read: boolean, expects: "true or false" },
	italic: { read: boolean, expects: "true or false" },
	underline: { read: boolean, expects: "true or false" },
	outlineColor: { read: color, expects: "a colour (#rrggbb)" },
	outlineWidth: { read: number({ min: 0 }), expects: "pixels ≥ 0" },
	shadowColor: { read: color, expects: "a colour (#rrggbb)" },
	backgroundColor: { read: color, expects: "a colour (#rrggbb)" },
	bgOpacity: { read: number({ min: 0, max: 1 }), expects: "0–1" },
	lineSpacing: {
		read: number({ min: 0.1 }),
		expects: "a line-height multiple",
	},
	animationType: {
		read: oneOf("none", "fade", "slide-up", "slide-left"),
		expects: "none, fade, slide-up or slide-left",
	},
	animationDuration: { read: number({ min: 0 }), expects: "seconds ≥ 0" },
	animationDelay: { read: number({ min: 0 }), expects: "seconds ≥ 0" },
	karaokeMode: {
		read: oneOf(...KARAOKE_MODES),
		expects: KARAOKE_MODES.join(", "),
	},
	highlightColor: { read: color, expects: "a colour (#rrggbb)" },
	upcomingColor: { read: color, expects: "a colour (#rrggbb)" },
	highlightScale: { read: number({ min: 0.1 }), expects: "a scale factor" },
};

/** Text-element names for the same fields. */
const CAPTION_STYLE_ALIASES: Record<string, string> = {
	color: "fontColor",
	opacity: "fontOpacity",
	strokeColor: "outlineColor",
	strokeWidth: "outlineWidth",
	backgroundOpacity: "bgOpacity",
	lineHeight: "lineSpacing",
};

/** Text-element fields a caption has no counterpart for. */
const NO_CAPTION_EQUIVALENT: Record<string, string> = {
	strokeOpacity: "the outline is drawn at the text's opacity",
	shadowOpacity: "the shadow is drawn at the text's opacity",
	shadowBlur: "caption shadows are not blurred",
	glowColor: "captions have no glow",
	glowOpacity: "captions have no glow",
	glowBlur: "captions have no glow",
	backgroundRadius: "the caption box has a fixed 4 px radius",
	backgroundPadding: "the caption box has a fixed 8 × 16 px padding",
	marginV:
		"captions sit 28 px from the edge position.align names (stacked captions move up by whole blocks)",
	marginL: "captions wrap inside the middle 80 % of the frame",
	marginR: "captions wrap inside the middle 80 % of the frame",
	x: "captions are placed by position.align (top, center or bottom), not by x/y",
	y: "captions are placed by position.align (top, center or bottom), not by x/y",
	width: "captions wrap inside the middle 80 % of the frame",
	height: "a caption is as tall as its lines",
	rotation: "captions are not rotated",
};

/** Top-level element fields that are not style and need no report. */
const CAPTION_ELEMENT_FIELDS = new Set([
	"id",
	"elementId",
	"type",
	"trackId",
	"trackIndex",
	"name",
	"content",
	"text",
	"language",
	"source",
	"confidence",
	"words",
	"emphasis",
	"emphasisBaseStyle",
	"style",
	"startTime",
	"endTime",
	"duration",
	"durationFrames",
	"startFrame",
	"after",
	"collision",
	"hidden",
	"colorLabel",
	"trimStart",
	"trimEnd",
	"projectId",
	"correlationId",
	"requestId",
]);

export interface CaptionStyleInput {
	/** The style to store, in subtitle names; undefined when none was given. */
	style?: Record<string, unknown>;
	/** Fields given but not applied: `style.marginV`, `x`… with the reason. */
	ignored: Array<{ field: string; reason: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads one given field into `style`; returns why it could not be used. */
function readField({
	key,
	value,
	style,
}: {
	key: string;
	value: unknown;
	style: Record<string, unknown>;
}): string | undefined {
	if (value === undefined) return undefined;
	if (key === "shadowOffset") {
		if (!isRecord(value)) return "expected {x, y} in pixels";
		for (const axis of ["x", "y"] as const) {
			if (value[axis] === undefined) continue;
			const read = number()(value[axis]);
			if (read === INVALID) return `${axis} expected pixels`;
			style.shadowOffset = {
				...(style.shadowOffset as object),
				[axis]: read,
			};
		}
		return undefined;
	}
	if (key === "shadowOffsetX" || key === "shadowOffsetY") {
		const read = number()(value);
		if (read === INVALID) return "expected pixels";
		const axis = key === "shadowOffsetX" ? "x" : "y";
		style.shadowOffset = { ...(style.shadowOffset as object), [axis]: read };
		return undefined;
	}
	if (key === "position" || key === "verticalAlign") {
		const align =
			key === "position" ? (isRecord(value) ? value.align : INVALID) : value;
		const read = oneOf(
			"top",
			"center",
			"bottom"
		)(align === "middle" ? "center" : align);
		if (read === INVALID) return "expected top, center or bottom";
		const position = key === "position" && isRecord(value) ? value : {};
		style.position = {
			...(style.position as object),
			...position,
			align: read,
		};
		return undefined;
	}
	if (key === "fontWeight") {
		if (value !== "bold" && value !== "normal" && typeof value !== "number") {
			return "expected bold or normal";
		}
		style.bold =
			value === "bold" || (typeof value === "number" && value >= 600);
		return undefined;
	}
	if (key === "fontStyle" || key === "textDecoration") {
		const on = key === "fontStyle" ? "italic" : "underline";
		const off = key === "fontStyle" ? "normal" : "none";
		if (value !== on && value !== off) return `expected ${on} or ${off}`;
		style[on] = value === on;
		return undefined;
	}
	if (key === "backgroundColor" && value === "transparent") {
		// No box at all; the exports cannot draw a colour named "transparent".
		style.bgOpacity = 0;
		return undefined;
	}
	const field = CAPTION_STYLE_ALIASES[key] ?? key;
	const spec = CAPTION_STYLE_FIELDS[field];
	if (!spec) {
		return NO_CAPTION_EQUIVALENT[key]
			? `no effect on captions: ${NO_CAPTION_EQUIVALENT[key]}`
			: "not a caption style field";
	}
	const read = spec.read(value);
	if (read === INVALID) return `expected ${spec.expects}`;
	style[field] = read;
	return undefined;
}

/** Every field a caption's style takes, in either spelling. */
export const CAPTION_STYLE_KEYS: ReadonlySet<string> = new Set([
	...Object.keys(CAPTION_STYLE_FIELDS),
	...Object.keys(CAPTION_STYLE_ALIASES),
	"shadowOffset",
	"shadowOffsetX",
	"shadowOffsetY",
	"position",
	"verticalAlign",
	"fontWeight",
	"fontStyle",
	"textDecoration",
]);

/** Fields read at the top level as style, reported when they do nothing. */
const TOP_LEVEL_STYLE_KEYS = new Set([
	...CAPTION_STYLE_KEYS,
	...Object.keys(NO_CAPTION_EQUIVALENT),
]);

/**
 * The caption style an API element asks for: `style` first, then style
 * fields given at the top level (which win, as for text elements). A field
 * spelled both ways takes the subtitle name's value. Unknown top-level
 * fields are reported too, so a misspelled field is never silently lost.
 */
export function normalizeCaptionStyleInput({
	element,
}: {
	element: Record<string, unknown>;
}): CaptionStyleInput {
	const style: Record<string, unknown> = {};
	const ignored: CaptionStyleInput["ignored"] = [];
	const nested = element.style;
	if (nested !== undefined && nested !== null && !isRecord(nested)) {
		ignored.push({ field: "style", reason: "expected an object" });
	}
	const topLevel = Object.entries(element).filter(([key, value]) => {
		if (value === undefined || CAPTION_ELEMENT_FIELDS.has(key)) return false;
		if (TOP_LEVEL_STYLE_KEYS.has(key)) return true;
		ignored.push({ field: key, reason: "not a caption field" });
		return false;
	});
	for (const [entries, prefix] of [
		[isRecord(nested) ? Object.entries(nested) : [], "style."],
		[topLevel, ""],
	] as const) {
		// Other spellings first, so a subtitle name given beside one wins.
		const ordered = [...entries].sort(
			([left], [right]) =>
				Number(left in CAPTION_STYLE_FIELDS) -
				Number(right in CAPTION_STYLE_FIELDS)
		);
		for (const [key, value] of ordered) {
			const reason = readField({ key, value, style });
			if (reason) ignored.push({ field: `${prefix}${key}`, reason });
		}
	}
	return { ...(Object.keys(style).length > 0 ? { style } : {}), ignored };
}

/** One line per ignored field, for an API answer's `warnings`. */
export function captionStyleWarnings({
	ignored,
}: Pick<CaptionStyleInput, "ignored">): string[] {
	return ignored.map(
		({ field, reason }) => `Caption field "${field}" ignored: ${reason}`
	);
}

/**
 * A patch's caption style: its `style` plus the style fields given at the
 * top level; other top-level fields are the patch's own business.
 */
export function captionStyleFromPatch({
	changes,
}: {
	changes: Record<string, unknown>;
}): CaptionStyleInput {
	const element: Record<string, unknown> = { style: changes.style };
	for (const key of CAPTION_STYLE_KEYS) {
		if (changes[key] !== undefined) element[key] = changes[key];
	}
	return normalizeCaptionStyleInput({ element });
}
