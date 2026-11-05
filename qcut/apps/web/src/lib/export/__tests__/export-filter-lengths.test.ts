import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import type { CanvasTextContext } from "@/lib/text/text-canvas-primitives";
import { drawExportProjectLayer } from "../export-project-canvas";
import { scaleFilterLengths } from "../export-filter-lengths";

const project = { width: 640, height: 360 };

function pixels({ canvas }: { canvas: Canvas }) {
	return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height)
		.data;
}

function expectIdenticalPixels({
	actual,
	expected,
}: {
	actual: Canvas;
	expected: Canvas;
}) {
	expect(actual.width).toBe(expected.width);
	expect(actual.height).toBe(expected.height);
	const expectedPixels = pixels({ canvas: expected });
	expect(
		pixels({ canvas: actual }).findIndex(
			(value, index) => value !== expectedPixels[index]
		)
	).toBe(-1);
}

describe("export filter length scaling", () => {
	it.each([
		{ input: String.raw`blur(1p\78)`, expected: "blur(2px)" },
		{ input: String.raw`blur(1\70 x)`, expected: "blur(2px)" },
		{ input: String.raw`blur(1P\000058)`, expected: "blur(2px)" },
		{
			input: String.raw`bl\75 r(+.5e1p\78)`,
			expected: String.raw`bl\75 r(10px)`,
		},
		{ input: "blur(1e999px)", expected: "blur(1e999px)" },
		{ input: "blur(1e308px)", expected: "blur(1e308px)" },
		{ input: "blur(1e-999px)", expected: "blur(0px)" },
		{ input: "blur(/* 1px */ 2px)", expected: "blur(/* 1px */ 4px)" },
		{ input: '"1px" blur(1px)', expected: '"1px" blur(2px)' },
		{
			input: String.raw`"a\"1px" blur(1px)`,
			expected: String.raw`"a\"1px" blur(2px)`,
		},
		{ input: "none", expected: "none" },
		{ input: "blur(1px-suffix)", expected: "blur(1px-suffix)" },
		{
			input: "brightness(1e2%) blur(1PX)",
			expected: "brightness(1e2%) blur(2px)",
		},
		{ input: "/* unclosed 1px", expected: "/* unclosed 1px" },
		{ input: '"unclosed 1px', expected: '"unclosed 1px' },
		{ input: "url(#unclosed1px", expected: "url(#unclosed1px" },
	])("preserves CSS tokens while scaling $input", ({ input, expected }) => {
		expect(scaleFilterLengths({ filter: input, factor: 2 })).toBe(expected);
	});

	it.each([
		{
			scale: 2,
			input: "blur(1e2px)",
			logical: "blur(100px)",
			device: "blur(200px)",
		},
		{
			scale: 0.5,
			input: "blur(1e2px)",
			logical: "blur(100px)",
			device: "blur(50px)",
		},
		{
			scale: 2,
			input: "drop-shadow(-1e1px +2E+1px .5e-2px #0000ff) blur(1e-2px)",
			logical: "drop-shadow(-10px 20px 0.005px #0000ff) blur(0.01px)",
			device: "drop-shadow(-20px 40px 0.01px #0000ff) blur(0.02px)",
		},
		{
			scale: 0.5,
			input: "drop-shadow(-1e1px +2E+1px .5e-2px #0000ff) blur(1e-2px)",
			logical: "drop-shadow(-10px 20px 0.005px #0000ff) blur(0.01px)",
			device: "drop-shadow(-5px 10px 0.0025px #0000ff) blur(0.005px)",
		},
		{
			scale: 2,
			input: String.raw`blur(1p\78)`,
			logical: "blur(1px)",
			device: "blur(2px)",
		},
	])("renders and restores $input at scale $scale like decimal CSS lengths", ({
		scale,
		input,
		logical,
		device,
	}) => {
		const frame = { width: 320 * scale, height: 180 * scale };
		const actual = createCanvas(frame.width, frame.height);
		const ctx = actual.getContext("2d");
		drawExportProjectLayer({
			ctx: ctx as unknown as CanvasTextContext,
			project: { width: 320, height: 180 },
			frame,
			draw: ({ ctx: drawing }) => {
				drawing.filter = input;
				expect(ctx.filter).toBe(device);
				const savedFilter = drawing.filter;
				expect(savedFilter).toBe(logical);
				drawing.filter = "none";
				drawing.filter = savedFilter;
				expect(ctx.filter).toBe(device);
				drawing.fillStyle = "#ff0000";
				drawing.fillRect(100, 60, 120, 60);
			},
		});
		const expected = createCanvas(frame.width, frame.height);
		const expectedContext = expected.getContext("2d");
		expectedContext.scale(scale, scale);
		expectedContext.filter = device;
		expectedContext.fillStyle = "#ff0000";
		expectedContext.fillRect(100, 60, 120, 60);
		expect(pixels({ canvas: actual }).some((value) => value > 0)).toBe(true);
		expectIdenticalPixels({ actual, expected });
	});

	it("round-trips lengths that serialize back into exponent notation", () => {
		const canvas = createCanvas(1280, 720);
		const ctx = canvas.getContext("2d");
		drawExportProjectLayer({
			ctx: ctx as unknown as CanvasTextContext,
			frame: canvas,
			project,
			draw: ({ ctx: drawing }) => {
				drawing.filter = "blur(1e-8px)";
				expect(ctx.filter).toBe("blur(2e-8px)");
				const savedFilter = drawing.filter;
				expect(savedFilter).toBe("blur(1e-8px)");
				drawing.filter = "none";
				drawing.filter = savedFilter;
				expect(ctx.filter).toBe("blur(2e-8px)");
			},
		});
	});

	it.each([
		'url("https://example.test/1e2px.svg#1e-2px")',
		"url('https://example.test/a)1e2px.svg#filter')",
		"url(#1e2px)",
		String.raw`url(#filter\)1e2px)`,
		String.raw`u\72l(https://example.test/1e2px.svg#filter)`,
		String.raw`\75\72\6c("https://example.test/1e2px.svg#filter")`,
		String.raw`u\000072 l(#1e2px)`,
		String.raw`\u\r\l(#1e2px)`,
	])("preserves numeric text inside %s while scaling surrounding filters", (url) => {
		const canvas = createCanvas(1280, 720);
		const ctx = canvas.getContext("2d");
		drawExportProjectLayer({
			ctx: ctx as unknown as CanvasTextContext,
			frame: canvas,
			project,
			draw: ({ ctx: drawing }) => {
				drawing.filter = `blur(1e-2px) ${url} blur(1e2px)`;
				expect(ctx.filter).toBe(`blur(0.02px) ${url} blur(200px)`);
				const savedFilter = drawing.filter;
				expect(savedFilter).toBe(`blur(0.01px) ${url} blur(100px)`);
				drawing.filter = "none";
				drawing.filter = savedFilter;
				expect(ctx.filter).toBe(`blur(0.02px) ${url} blur(200px)`);
			},
		});
	});
});
