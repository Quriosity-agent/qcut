import { describe, expect, it, vi } from "vitest";
import {
	drawWithMediaTransform,
	isIdentityMediaTransform,
	type MediaTransformVisual,
} from "../export-engine-utils";

const IDENTITY: MediaTransformVisual = {
	x: 0,
	y: 0,
	rotation: 0,
	scaleX: 1,
	scaleY: 1,
	flipHorizontal: false,
	flipVertical: false,
	opacity: 1,
};

function createRecordingContext() {
	const calls: Array<[string, ...number[]]> = [];
	const record =
		(name: string) =>
		(...args: number[]) => {
			calls.push([name, ...args]);
		};
	return {
		calls,
		ctx: {
			save: record("save"),
			restore: record("restore"),
			translate: record("translate"),
			rotate: record("rotate"),
			scale: record("scale"),
			beginPath: record("beginPath"),
			rect: record("rect"),
			clip: record("clip"),
			globalAlpha: 1,
		} as unknown as CanvasRenderingContext2D,
	};
}

const BOUNDS = { x: 100, y: 50, width: 400, height: 300 };

describe("drawWithMediaTransform", () => {
	it("applies a crop even when the outer transform is identity", async () => {
		const { calls, ctx } = createRecordingContext();
		const visual = {
			...IDENTITY,
			crop: { top: 0.1, right: 0.2, bottom: 0.15, left: 0.05 },
		};
		expect(isIdentityMediaTransform({ visual })).toBe(false);
		await drawWithMediaTransform({
			ctx,
			visual,
			bounds: { x: -460, y: 0, width: 2000, height: 1920 },
			canvasSize: { width: 1080, height: 1920 },
			draw: () => {
				calls.push(["draw"]);
			},
		});
		expect(calls.slice(-5)).toEqual([
			["beginPath"],
			["rect", 54, 192, 810, 1440],
			["clip"],
			["draw"],
			["restore"],
		]);
	});

	it("moves the canvas-relative crop with rotation, translation and flips", async () => {
		const { calls, ctx } = createRecordingContext();
		await drawWithMediaTransform({
			ctx,
			visual: {
				...IDENTITY,
				x: 20,
				y: -10,
				rotation: 90,
				scaleX: 0.5,
				flipHorizontal: true,
				crop: { top: 0.1, right: 0, bottom: 0, left: 0.25 },
			},
			bounds: { x: 0, y: 150, width: 600, height: 100 },
			canvasSize: { width: 600, height: 400 },
			draw: () => {
				calls.push(["draw"]);
			},
		});
		expect(calls).toEqual([
			["save"],
			["translate", 320, 190],
			["rotate", Math.PI / 2],
			["scale", -0.5, 1],
			["translate", -300, -200],
			["beginPath"],
			["rect", 150, 40, 450, 360],
			["clip"],
			["draw"],
			["restore"],
		]);
	});

	it("keeps cover overflow clipped to the element box when scaling down", async () => {
		const { calls, ctx } = createRecordingContext();
		await drawWithMediaTransform({
			ctx,
			visual: { ...IDENTITY, scaleX: 0.5, scaleY: 0.5 },
			bounds: { x: -700, y: 0, width: 2000, height: 400 },
			canvasSize: { width: 600, height: 400 },
			draw: () => {
				calls.push(["draw"]);
			},
		});
		expect(calls.slice(-5)).toEqual([
			["beginPath"],
			["rect", 0, 0, 600, 400],
			["clip"],
			["draw"],
			["restore"],
		]);
	});

	it("skips the transform entirely at identity", async () => {
		expect(isIdentityMediaTransform({ visual: IDENTITY })).toBe(true);
		const { calls, ctx } = createRecordingContext();
		const draw = vi.fn();
		await drawWithMediaTransform({
			ctx,
			visual: IDENTITY,
			bounds: BOUNDS,
			canvasSize: { width: 600, height: 400 },
			draw,
		});
		expect(draw).toHaveBeenCalledOnce();
		expect(calls).toEqual([]);
	});

	it("transforms about the bounds center with preview semantics", async () => {
		const { calls, ctx } = createRecordingContext();
		const visual: MediaTransformVisual = {
			...IDENTITY,
			x: 80,
			y: -36,
			rotation: 30,
			scaleX: 0.5,
			scaleY: 0.5,
			flipHorizontal: true,
			opacity: 0.5,
		};
		let alphaDuringDraw = Number.NaN;
		await drawWithMediaTransform({
			ctx,
			visual,
			bounds: BOUNDS,
			canvasSize: { width: 600, height: 400 },
			draw: () => {
				alphaDuringDraw = ctx.globalAlpha;
			},
		});
		// Bounds center (300, 200); moved by (80, -36); clockwise 30°; flip
		// rides the x-scale sign.
		expect(calls).toEqual([
			["save"],
			["translate", 380, 164],
			["rotate", (30 * Math.PI) / 180],
			["scale", -0.5, 0.5],
			["translate", -300, -200],
			["beginPath"],
			["rect", 0, 0, 600, 400],
			["clip"],
			["restore"],
		]);
		expect(alphaDuringDraw).toBe(0.5);
	});

	it("restores the context even when draw throws", async () => {
		const { calls, ctx } = createRecordingContext();
		await expect(
			drawWithMediaTransform({
				ctx,
				visual: { ...IDENTITY, rotation: 90 },
				bounds: BOUNDS,
				canvasSize: { width: 600, height: 400 },
				draw: () => {
					throw new Error("boom");
				},
			})
		).rejects.toThrow("boom");
		expect(calls.at(-1)).toEqual(["restore"]);
	});
});
