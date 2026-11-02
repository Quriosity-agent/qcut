/**
 * CSS colours for the paths that cannot hand one to a browser: an ASS style,
 * an override tag, an FFmpeg option. The timeline documents text and caption
 * colours as CSS colours, and only the preview used to read them all (#532):
 * a name like `red` came out black or white from the native export and as
 * garbage from the export dialog's.
 *
 * The main process cannot import editor-core at run time, so
 * `electron/claude/handlers/claude-export-handler/css-color.ts` holds a copy;
 * `electron/__tests__/css-color-mirror.test.ts` keeps the two in step.
 *
 * @module @qcut/editor-core/captions/css-color
 */

export interface ParsedCssColor {
	/** `#rrggbb`, lower case. */
	hex: string;
	/** The alpha the colour itself carries, 0–1; undefined when it has none. */
	alpha?: number;
}

/** The CSS Color 4 named colours, with `grey` and `gray` both spelled. */
export const CSS_NAMED_COLORS: Readonly<Record<string, string>> = {
	aliceblue: "#f0f8ff",
	antiquewhite: "#faebd7",
	aqua: "#00ffff",
	aquamarine: "#7fffd4",
	azure: "#f0ffff",
	beige: "#f5f5dc",
	bisque: "#ffe4c4",
	black: "#000000",
	blanchedalmond: "#ffebcd",
	blue: "#0000ff",
	blueviolet: "#8a2be2",
	brown: "#a52a2a",
	burlywood: "#deb887",
	cadetblue: "#5f9ea0",
	chartreuse: "#7fff00",
	chocolate: "#d2691e",
	coral: "#ff7f50",
	cornflowerblue: "#6495ed",
	cornsilk: "#fff8dc",
	crimson: "#dc143c",
	cyan: "#00ffff",
	darkblue: "#00008b",
	darkcyan: "#008b8b",
	darkgoldenrod: "#b8860b",
	darkgray: "#a9a9a9",
	darkgreen: "#006400",
	darkgrey: "#a9a9a9",
	darkkhaki: "#bdb76b",
	darkmagenta: "#8b008b",
	darkolivegreen: "#556b2f",
	darkorange: "#ff8c00",
	darkorchid: "#9932cc",
	darkred: "#8b0000",
	darksalmon: "#e9967a",
	darkseagreen: "#8fbc8f",
	darkslateblue: "#483d8b",
	darkslategray: "#2f4f4f",
	darkslategrey: "#2f4f4f",
	darkturquoise: "#00ced1",
	darkviolet: "#9400d3",
	deeppink: "#ff1493",
	deepskyblue: "#00bfff",
	dimgray: "#696969",
	dimgrey: "#696969",
	dodgerblue: "#1e90ff",
	firebrick: "#b22222",
	floralwhite: "#fffaf0",
	forestgreen: "#228b22",
	fuchsia: "#ff00ff",
	gainsboro: "#dcdcdc",
	ghostwhite: "#f8f8ff",
	gold: "#ffd700",
	goldenrod: "#daa520",
	gray: "#808080",
	green: "#008000",
	greenyellow: "#adff2f",
	grey: "#808080",
	honeydew: "#f0fff0",
	hotpink: "#ff69b4",
	indianred: "#cd5c5c",
	indigo: "#4b0082",
	ivory: "#fffff0",
	khaki: "#f0e68c",
	lavender: "#e6e6fa",
	lavenderblush: "#fff0f5",
	lawngreen: "#7cfc00",
	lemonchiffon: "#fffacd",
	lightblue: "#add8e6",
	lightcoral: "#f08080",
	lightcyan: "#e0ffff",
	lightgoldenrodyellow: "#fafad2",
	lightgray: "#d3d3d3",
	lightgreen: "#90ee90",
	lightgrey: "#d3d3d3",
	lightpink: "#ffb6c1",
	lightsalmon: "#ffa07a",
	lightseagreen: "#20b2aa",
	lightskyblue: "#87cefa",
	lightslategray: "#778899",
	lightslategrey: "#778899",
	lightsteelblue: "#b0c4de",
	lightyellow: "#ffffe0",
	lime: "#00ff00",
	limegreen: "#32cd32",
	linen: "#faf0e6",
	magenta: "#ff00ff",
	maroon: "#800000",
	mediumaquamarine: "#66cdaa",
	mediumblue: "#0000cd",
	mediumorchid: "#ba55d3",
	mediumpurple: "#9370db",
	mediumseagreen: "#3cb371",
	mediumslateblue: "#7b68ee",
	mediumspringgreen: "#00fa9a",
	mediumturquoise: "#48d1cc",
	mediumvioletred: "#c71585",
	midnightblue: "#191970",
	mintcream: "#f5fffa",
	mistyrose: "#ffe4e1",
	moccasin: "#ffe4b5",
	navajowhite: "#ffdead",
	navy: "#000080",
	oldlace: "#fdf5e6",
	olive: "#808000",
	olivedrab: "#6b8e23",
	orange: "#ffa500",
	orangered: "#ff4500",
	orchid: "#da70d6",
	palegoldenrod: "#eee8aa",
	palegreen: "#98fb98",
	paleturquoise: "#afeeee",
	palevioletred: "#db7093",
	papayawhip: "#ffefd5",
	peachpuff: "#ffdab9",
	peru: "#cd853f",
	pink: "#ffc0cb",
	plum: "#dda0dd",
	powderblue: "#b0e0e6",
	purple: "#800080",
	rebeccapurple: "#663399",
	red: "#ff0000",
	rosybrown: "#bc8f8f",
	royalblue: "#4169e1",
	saddlebrown: "#8b4513",
	salmon: "#fa8072",
	sandybrown: "#f4a460",
	seagreen: "#2e8b57",
	seashell: "#fff5ee",
	sienna: "#a0522d",
	silver: "#c0c0c0",
	skyblue: "#87ceeb",
	slateblue: "#6a5acd",
	slategray: "#708090",
	slategrey: "#708090",
	snow: "#fffafa",
	springgreen: "#00ff7f",
	steelblue: "#4682b4",
	tan: "#d2b48c",
	teal: "#008080",
	thistle: "#d8bfd8",
	tomato: "#ff6347",
	turquoise: "#40e0d0",
	violet: "#ee82ee",
	wheat: "#f5deb3",
	white: "#ffffff",
	whitesmoke: "#f5f5f5",
	yellow: "#ffff00",
	yellowgreen: "#9acd32",
};

const HEX_DIGITS = /^#([0-9a-f]{3,8})$/;
const FUNCTIONAL = /^(rgb|hsl)a?\(([^)]*)\)$/;

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function hexByte(value: number): string {
	return Math.round(Math.min(255, Math.max(0, value)))
		.toString(16)
		.padStart(2, "0");
}

function parseHex(digits: string): ParsedCssColor | undefined {
	if (digits.length === 3 || digits.length === 4) {
		const [r, g, b, a] = [...digits].map((digit) => `${digit}${digit}`);
		return {
			hex: `#${r}${g}${b}`,
			...(a ? { alpha: Number.parseInt(a, 16) / 255 } : {}),
		};
	}
	if (digits.length === 6) return { hex: `#${digits}` };
	if (digits.length === 8) {
		return {
			hex: `#${digits.slice(0, 6)}`,
			alpha: Number.parseInt(digits.slice(6), 16) / 255,
		};
	}
	return;
}

/** A number or a percentage as a fraction of `full`; undefined when neither. */
function parseField(field: string, full: number): number | undefined {
	const value = Number(field.endsWith("%") ? field.slice(0, -1) : field);
	if (field === "" || !Number.isFinite(value)) return;
	return field.endsWith("%") ? (value / 100) * full : value;
}

/** An `hsl()` hue in degrees: a bare number, or with its CSS angle unit. */
function parseHue(field: string): number | undefined {
	const unit = /(deg|grad|rad|turn)$/.exec(field)?.[1];
	const value = Number(unit ? field.slice(0, -unit.length) : field);
	if (field === "" || !Number.isFinite(value)) return;
	if (unit === "turn") return value * 360;
	if (unit === "rad") return (value * 180) / Math.PI;
	if (unit === "grad") return value * 0.9;
	return value;
}

function rgbChannels(fields: string[]): number[] | undefined {
	const channels = fields.map((field) => parseField(field, 255));
	return channels.includes(undefined) ? undefined : (channels as number[]);
}

/**
 * CSS Color 4's `hsl()` to 0–255 channels. Saturation and lightness run 0–100,
 * with or without their `%`.
 */
function hslChannels(fields: string[]): number[] | undefined {
	const hue = parseHue(fields[0]);
	const saturation = parseField(fields[1], 100);
	const lightness = parseField(fields[2], 100);
	if (hue === undefined || saturation === undefined || lightness === undefined)
		return;
	const s = clamp01(saturation / 100);
	const l = clamp01(lightness / 100);
	const amount = s * Math.min(l, 1 - l);
	const channel = (offset: number) => {
		const k = (((offset + hue / 30) % 12) + 12) % 12;
		return (l - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
	};
	return [channel(0), channel(8), channel(4)];
}

function parseFunctional(
	kind: string,
	body: string
): ParsedCssColor | undefined {
	const fields = body.split(/[\s,/]+/).filter(Boolean);
	if (fields.length !== 3 && fields.length !== 4) return;
	const channels =
		kind === "rgb"
			? rgbChannels(fields.slice(0, 3))
			: hslChannels(fields.slice(0, 3));
	if (!channels) return;
	const hex = `#${channels.map(hexByte).join("")}`;
	if (fields.length === 3) return { hex };
	const alpha = parseField(fields[3], 1);
	return alpha === undefined ? undefined : { hex, alpha: clamp01(alpha) };
}

/**
 * Reads a CSS colour: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`,
 * `rgba()`, `hsl()`, `hsla()`, a name, or `transparent`. Anything else
 * (a typo, `oklch()`, `currentColor`) is undefined, for the caller to warn
 * about: an export has no browser to ask.
 */
export function parseCssColor(value: string): ParsedCssColor | undefined {
	const text = value.trim().toLowerCase();
	if (text === "transparent") return { hex: "#000000", alpha: 0 };
	const named = Object.hasOwn(CSS_NAMED_COLORS, text)
		? CSS_NAMED_COLORS[text]
		: undefined;
	if (named) return { hex: named };
	const hex = HEX_DIGITS.exec(text);
	if (hex) return parseHex(hex[1]);
	const functional = FUNCTIONAL.exec(text);
	return functional ? parseFunctional(functional[1], functional[2]) : undefined;
}

/**
 * The alpha a colour draws at under its `…Opacity` field, as the preview draws
 * it: a colour with its own alpha keeps it in place of the field (they do not
 * combine), and a field at 0 hides the colour either way.
 */
export function cssColorAlpha(color: ParsedCssColor, opacity: number): number {
	if (opacity <= 0) return 0;
	return color.alpha ?? clamp01(opacity);
}
