import {
	resolveSubtitleStyle,
	type TextAnimationEffect,
} from "@qcut/editor-core";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import type {
	CaptionElement,
	TextElement,
	TimelineTrack,
} from "@/types/timeline";
import type { CanvasTextContext } from "@/lib/text/text-canvas-primitives";
import { renderCaptionElement } from "../export-engine-renderer";
import { renderTextToCanvas } from "@/lib/text/text-canvas-renderer";
import { extractTextRasterSources } from "@/lib/export-cli/sources/text-raster-sources";
import {
	drawExportProjectLayer,
	resolveExportProjectCanvas,
} from "../export-project-canvas";

const project = { width: 640, height: 360 };
const text: TextElement = {
	id: "title",
	name: "Title",
	type: "text",
	content: "Export",
	startTime: 0,
	duration: 1,
	trimStart: 0,
	trimEnd: 0,
	fontSize: 40,
	fontFamily: "Arial",
	color: "#ffffff",
	backgroundColor: "transparent",
	textAlign: "center",
	fontWeight: "normal",
	fontStyle: "normal",
	textDecoration: "none",
	width: 280,
	height: 100,
	x: 35,
	y: -20,
	rotation: 0,
	opacity: 1,
	strokeWidth: 3,
	strokeColor: "#0000ff",
	shadowOpacity: 1,
	shadowColor: "#ff0000",
	shadowOffsetX: 16,
	shadowOffsetY: 8,
	shadowBlur: 5,
};

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
	const firstDifference = pixels({ canvas: actual }).findIndex(
		(value, index) => value !== expectedPixels[index]
	);
	expect(firstDifference).toBe(-1);
}

function bounds({ canvas }: { canvas: Canvas }) {
	const data = pixels({ canvas });
	let left = canvas.width,
		right = -1,
		top = canvas.height,
		bottom = -1;
	for (let y = 0; y < canvas.height; y += 1) {
		for (let x = 0; x < canvas.width; x += 1) {
			if (data[(y * canvas.width + x) * 4 + 3] < 30) continue;
			left = Math.min(left, x);
			right = Math.max(right, x);
			top = Math.min(top, y);
			bottom = Math.max(bottom, y);
		}
	}
	return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function drawTitle({
	frame,
	element = text,
	currentTime = 0.75,
}: {
	frame: { width: number; height: number };
	element?: TextElement;
	currentTime?: number;
}) {
	const canvas = createCanvas(frame.width, frame.height);
	drawExportProjectLayer({
		ctx: canvas.getContext("2d") as unknown as CanvasTextContext,
		frame,
		project,
		draw: ({ ctx, canvas: logicalCanvas }) =>
			renderTextToCanvas({
				ctx,
				canvas: logicalCanvas,
				element,
				currentTime,
				fps: 4,
			}),
	});
	return canvas;
}

function animatedText({
	effect,
}: {
	effect: TextAnimationEffect;
}): TextElement {
	return {
		...text,
		textAnimations: {
			schemaVersion: 1,
			entrance: {
				timing: { duration: 0.5, delay: 0, easing: "linear" },
				sequence: { unit: "all", order: "forward", staggerRatio: 0, seed: 1 },
				target: "text",
				effect,
			},
		},
	};
}

describe("project canvas export coordinates", () => {
	it.each([
		{ width: 1280, height: 720, scale: 2 },
		{ width: 320, height: 180, scale: 0.5 },
		{ width: 360, height: 640, scale: 360 / 640 },
		{ width: 640, height: 640, scale: 1 },
	])("preserves font, outline, shadow and center offsets at $width x $height", (frame) => {
		const baseline = bounds({ canvas: drawTitle({ frame: project }) });
		const actual = bounds({ canvas: drawTitle({ frame }) });
		expect(actual.width).toBeGreaterThan(20);
		expect(Math.abs(actual.width - baseline.width * frame.scale)).toBeLessThan(
			4
		);
		expect(
			Math.abs(actual.height - baseline.height * frame.scale)
		).toBeLessThan(4);
		const expectedLeft =
			frame.width / 2 + (baseline.left - project.width / 2) * frame.scale;
		const expectedTop =
			frame.height / 2 + (baseline.top - project.height / 2) * frame.scale;
		expect(Math.abs(actual.left - expectedLeft)).toBeLessThan(3);
		expect(Math.abs(actual.top - expectedTop)).toBeLessThan(3);
	});

	it.each([
		{ width: 1280, height: 720, scale: 2 },
		{ width: 320, height: 180, scale: 0.5 },
		{ width: 360, height: 640, scale: 360 / 640 },
	])("keeps caption padding, font and rounded background proportional at $width x $height", (frame) => {
		const element = {
			id: "caption",
			type: "captions",
			name: "Caption",
			text: "Hello",
			startTime: 0,
			duration: 1,
			trimStart: 0,
			trimEnd: 0,
			language: "en",
			source: "manual",
			style: resolveSubtitleStyle({
				fontSize: 32,
				bgOpacity: 1,
				backgroundColor: "#004488",
				outlineWidth: 0,
				shadows: [],
				position: { align: "bottom", x: 50, y: 90 },
			}),
		} as CaptionElement;
		const render = ({ width, height }: { width: number; height: number }) => {
			const canvas = createCanvas(width, height);
			drawExportProjectLayer({
				ctx: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
				frame: canvas,
				project,
				draw: ({ ctx, canvas: logicalCanvas }) =>
					renderCaptionElement(ctx, logicalCanvas, element, 0.5),
			});
			return canvas;
		};
		const baseline = bounds({ canvas: render(project) });
		const actualCanvas = render(frame);
		const actual = bounds({ canvas: actualCanvas });
		expect(Math.abs(actual.width - baseline.width * frame.scale)).toBeLessThan(
			3
		);
		expect(
			Math.abs(actual.height - baseline.height * frame.scale)
		).toBeLessThan(3);
		expect(
			Math.abs(frame.height - actual.top - actual.height - 20 * frame.scale)
		).toBeLessThan(2);
		const corner = actualCanvas
			.getContext("2d")
			.getImageData(actual.left, actual.top, 1, 1).data;
		expect(corner[3]).toBeLessThan(128);
	});

	it("keeps unchanged-resolution rendering byte identical", () => {
		const direct = createCanvas(project.width, project.height);
		renderTextToCanvas({
			ctx: direct.getContext("2d") as unknown as CanvasTextContext,
			canvas: project,
			element: text,
			currentTime: 0.75,
			fps: 4,
		});
		expectIdenticalPixels({
			actual: drawTitle({ frame: project }),
			expected: direct,
		});
	});

	it("scales device-space shadow and filter lengths and restores drawing state after failure", () => {
		const canvas = createCanvas(1280, 720);
		const ctx = canvas.getContext("2d") as unknown as CanvasTextContext;
		ctx.shadowBlur = 7;
		expect(() =>
			drawExportProjectLayer({
				ctx,
				frame: canvas,
				project,
				draw: ({ ctx: drawing }) => {
					drawing.shadowBlur = 6;
					drawing.shadowOffsetX = -5;
					drawing.shadowOffsetY = 3;
					drawing.filter = "blur(2.5px) brightness(120%)";
					expect(ctx.shadowBlur).toBe(12);
					expect(drawing.shadowBlur).toBe(6);
					expect(ctx.shadowOffsetX).toBe(-10);
					expect(ctx.shadowOffsetY).toBe(6);
					expect(ctx.filter).toBe("blur(5px) brightness(120%)");
					// Read back in project units, so a save and restore is a no-op.
					expect(drawing.filter).toBe("blur(2.5px) brightness(120%)");
					const savedFilter = drawing.filter;
					drawing.filter = "none";
					drawing.filter = savedFilter;
					expect(ctx.filter).toBe("blur(5px) brightness(120%)");
					throw new Error("failed draw");
				},
			})
		).toThrow("failed draw");
		expect(ctx.shadowBlur).toBe(7);
		expect(ctx.getTransform().a).toBe(1);
	});

	it.each([
		{ width: 1280, height: 720, scale: 2 },
		{ width: 320, height: 180, scale: 0.5 },
		{ width: 360, height: 640, scale: 0.5625 },
		{ width: 640, height: 360, scale: 1 },
	])("keeps filter save and restore pixel identical at $width x $height", (frame) => {
		const filter =
			"blur(2.5px) drop-shadow(-3px 4px 1px #0000ff) brightness(120%)";
		const render = ({ roundTrip }: { roundTrip: boolean }) => {
			const canvas = createCanvas(frame.width, frame.height);
			const ctx = canvas.getContext("2d");
			ctx.filter = "brightness(90%)";
			drawExportProjectLayer({
				ctx: ctx as unknown as CanvasTextContext,
				frame,
				project,
				draw: ({ ctx: drawing, canvas: logicalCanvas }) => {
					drawing.save();
					drawing.filter = filter;
					const savedFilter = drawing.filter;
					expect(savedFilter).toBe(filter);
					if (roundTrip) {
						drawing.filter = "none";
						drawing.filter = savedFilter;
					}
					expect(ctx.filter).toBe(
						`blur(${2.5 * frame.scale}px) drop-shadow(${-3 * frame.scale}px ${4 * frame.scale}px ${frame.scale}px #0000ff) brightness(120%)`
					);
					drawing.fillStyle = "#ffffff";
					drawing.fillRect(
						logicalCanvas.width / 2 - 20,
						logicalCanvas.height / 2 - 10,
						40,
						20
					);
					drawing.restore();
				},
			});
			expect(ctx.filter).toBe("brightness(90%)");
			expect(ctx.getTransform().a).toBe(1);
			return canvas;
		};
		const direct = render({ roundTrip: false });
		const restored = render({ roundTrip: true });
		expect(bounds({ canvas: restored }).width).toBeGreaterThan(10);
		expectIdenticalPixels({ actual: restored, expected: direct });
	});

	it("fits a portrait project uniformly in a landscape output", () => {
		expect(
			resolveExportProjectCanvas({
				project: { width: 1080, height: 1920 },
				frame: { width: 1920, height: 1080 },
			})
		).toEqual({
			scale: 0.5625,
			canvas: { width: 1920 / 0.5625, height: 1920 },
		});
	});

	it.each([
		undefined,
		{ width: 0, height: 360 },
		{ width: Number.NaN, height: 360 },
	])("falls back to frame coordinates without a valid project canvas", (invalid) => {
		expect(
			resolveExportProjectCanvas({ project: invalid, frame: project })
		).toEqual({ canvas: project, scale: 1 });
	});

	const effects: TextAnimationEffect[] = [
		{ kind: "fade", minimumOpacity: 0 },
		{
			kind: "slide",
			direction: "left",
			distance: { value: 40, unit: "px" },
			fade: true,
		},
		{
			kind: "blur",
			direction: "up",
			distance: { value: 20, unit: "px" },
			radiusPx: 8,
			fade: true,
		},
	];
	it.each(
		[
			{ width: 1280, height: 720 },
			{ width: 320, height: 180 },
			{ width: 360, height: 640 },
		].flatMap((frame) => effects.map((effect) => ({ ...frame, effect })))
	)("bakes $effect.kind FFmpeg crops at $width x $height with the same pixels as canvas export", async (frame) => {
		const element = animatedText({ effect: frame.effect });
		const tracks = [
			{ id: "titles", type: "text", order: 0, elements: [element] },
		] as TimelineTrack[];
		const baked: Canvas[] = [];
		const layers = await extractTextRasterSources({
			tracks,
			sessionId: "resolution",
			canvasWidth: frame.width,
			canvasHeight: frame.height,
			projectCanvas: project,
			fps: 4,
			api: {
				saveEffectSequenceFrame: async () => ({
					success: true,
					patternPath: "/tmp/title-%05d.png",
				}),
			},
			createCanvas: ({ width, height }) => {
				const canvas = createCanvas(width, height);
				return {
					width,
					height,
					getContext: () =>
						canvas.getContext(
							"2d"
						) as unknown as OffscreenCanvasRenderingContext2D,
					convertToBlob: async () => {
						const snapshot = createCanvas(width, height);
						snapshot.getContext("2d").drawImage(canvas, 0, 0);
						baked.push(snapshot);
						return new Blob([new Uint8Array([1])]);
					},
				};
			},
			logger: () => {},
		});
		expect(layers).toHaveLength(1);
		expect(baked).toHaveLength(4);
		for (const [frameIndex, cropped] of baked.entries()) {
			const full = createCanvas(frame.width, frame.height);
			full.getContext("2d").drawImage(cropped, layers[0].x, layers[0].y);
			const expected = drawTitle({
				frame,
				element,
				currentTime: frameIndex / 4,
			});
			const actualPixels = pixels({ canvas: full });
			const expectedPixels = pixels({ canvas: expected });
			let error = 0;
			for (let i = 0; i < actualPixels.length; i += 1)
				error += Math.abs(actualPixels[i] - expectedPixels[i]);
			expect(error / actualPixels.length).toBeLessThan(0.03);
		}
		const alphaTotals = baked.map((canvas) =>
			pixels({ canvas }).reduce(
				(total, value, index) => total + (index % 4 === 3 ? value : 0),
				0
			)
		);
		expect(alphaTotals[0]).toBeLessThan(alphaTotals[3]);
		expect(bounds({ canvas: baked[3] }).width).toBeGreaterThan(20);
	});
});
