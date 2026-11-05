/**
 * The native export carries its own copy of the CSS colour reader, because
 * Electron's tsc root cannot import editor-core at run time. This keeps the
 * two in step: a colour one export path reads, the other must read alike.
 *
 * #532: the timeline documents these fields as CSS colours, and a name like
 * `red` came out black or white from the native export and as `0xred` from
 * the export dialog's.
 */
import { describe, expect, it } from "vitest";
import {
	CSS_NAMED_COLORS as SHARED_NAMES,
	cssColorAlpha as sharedAlpha,
	parseCssColor as sharedParse,
} from "../../packages/editor-core/src/captions/css-color.js";
import {
	CSS_NAMED_COLORS as NATIVE_NAMES,
	cssColorAlpha as nativeAlpha,
	parseCssColor as nativeParse,
} from "../claude/handlers/claude-export-handler/css-color.js";

const CORPUS = [
	"red",
	"RED",
	" rebeccapurple ",
	"grey",
	"gray",
	"transparent",
	"#abc",
	"#ABCD",
	"#112233",
	"#11223344",
	"#12345",
	"#1234567",
	"rgb(255,0,0)",
	"rgb(255 0 0)",
	"rgba(255, 0, 0, 0.5)",
	"rgb(255 0 0 / 50%)",
	"rgb(100%, 0%, 50%)",
	"rgb(300, -5, 0)",
	"rgb(255, 0)",
	"rgb(255, 0, 0, 0.5, 1)",
	"hsl(120, 100%, 50%)",
	"hsl(120deg 100% 25%)",
	"hsl(120 50 50)",
	"hsl(0.5turn 100% 50% / 0.25)",
	"hsla(-60, 100%, 50%, 1)",
	"hsl(3.14159rad 100% 50%)",
	"hsl(200grad 100% 50%)",
	"hsl(red, 100%, 50%)",
	"oklch(0.6 0.2 30)",
	"currentColor",
	"constructor",
	"redd",
	"",
];

describe("CSS colour reader mirror", () => {
	it("knows the same names", () => {
		expect(NATIVE_NAMES).toEqual(SHARED_NAMES);
	});

	it("reads every form alike in both copies", () => {
		for (const value of CORPUS) {
			expect(nativeParse(value), value).toEqual(sharedParse(value));
		}
	});

	it("applies an opacity field alike in both copies", () => {
		for (const color of [{ hex: "#112233" }, { hex: "#112233", alpha: 0.25 }]) {
			for (const opacity of [-1, 0, 0.5, 1, 2]) {
				expect(nativeAlpha(color, opacity)).toBe(sharedAlpha(color, opacity));
			}
		}
	});
});
