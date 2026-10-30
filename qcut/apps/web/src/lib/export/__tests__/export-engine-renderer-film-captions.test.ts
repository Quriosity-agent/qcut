import { describe, expect, it, vi } from "vitest";
import type { CaptionElement } from "@/types/timeline";
import { renderCaptionElement } from "../export-engine-renderer";

/**
 * N25 (2026-10-30 trailer report): style D of the trailer's film subtitles
 * in the canvas export: every soft shadow first, blurred like the preview's
 * text-shadow (σ = blur ÷ 2), then the letters; fades counted in frames.
 */

vi.mock("@/stores/ai/effects-store", () => ({
	useEffectsStore: {
		getState: () => ({ getElementEffects: () => [] }),
	},
}));
vi.mock("@/config/features", () => ({ EFFECTS_ENABLED: false }));

function recordingContext() {
	const draws: Array<Record<string, unknown>> = [];
	const ctx: Record<string, unknown> = {
		save: vi.fn(),
		restore: vi.fn(),
		fillRect: vi.fn(),
		strokeText: vi.fn(),
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		stroke: vi.fn(),
		measureText: vi.fn((text: string) => ({ width: text.length * 20 })),
		globalAlpha: 1,
		filter: "none",
		font: "",
		letterSpacing: "",
		textAlign: "center",
		textBaseline: "middle",
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 0,
		lineJoin: "miter",
	};
	ctx.fillText = vi.fn((text: string, x: number, y: number) => {
		draws.push({
			text,
			x,
			y,
			fillStyle: ctx.fillStyle,
			filter: ctx.filter,
			font: ctx.font,
			letterSpacing: ctx.letterSpacing,
			alpha: ctx.globalAlpha,
		});
	});
	return { ctx: ctx as unknown as CanvasRenderingContext2D, draws };
}

const canvas = { width: 1470, height: 630 } as HTMLCanvasElement;

const caption = {
	id: "cue",
	type: "captions",
	name: "cue",
	text: "三年前",
	secondaryText: "Three years ago",
	language: "zh",
	source: "manual",
	startTime: 2,
	duration: 1,
	trimStart: 0,
	trimEnd: 0,
	style: {
		fontFamily: "Source Han Serif CN",
		fontSize: 28,
		fontWeight: 600,
		bold: true,
		letterSpacing: 2.8,
		fontColor: "#f4efe6",
		outlineWidth: 0,
		bgOpacity: 0,
		shadows: [
			{ color: "#000000", opacity: 0.75, blur: 3.2, x: 0, y: 2 },
			{ color: "#000000", opacity: 0.38, blur: 18, x: 0, y: 0 },
		],
		fadeInFrames: 4,
		fadeOutFrames: 3,
		secondary: {
			fontFamily: "Gill Sans",
			fontSize: 22,
			bold: false,
			letterSpacing: 0.66,
			fontColor: "#ded6c6",
		},
	},
} as unknown as CaptionElement;

describe("film subtitles in the canvas export", () => {
	it("draws both shadows under both lines before any letter", () => {
		const { ctx, draws } = recordingContext();
		renderCaptionElement(ctx, canvas, caption, 2.5, 0, 24);
		expect(draws.map(({ text, filter }) => `${filter} ${text}`)).toEqual([
			"blur(1.6px) 三年前",
			"blur(1.6px) Three years ago",
			"blur(9px) 三年前",
			"blur(9px) Three years ago",
			"none 三年前",
			"none Three years ago",
		]);
		expect(draws[0].fillStyle).toBe("rgba(0, 0, 0, 0.75)");
		expect(draws[2].fillStyle).toBe("rgba(0, 0, 0, 0.38)");
		// The near shadow sits 2 px under the letters it is cast by.
		expect(Number(draws[0].y) - Number(draws[4].y)).toBe(2);
		expect(draws[4]).toMatchObject({
			fillStyle: "#f4efe6",
			letterSpacing: "2.8px",
		});
		expect(String(draws[4].font)).toContain("normal 600 28px");
		expect(draws[5]).toMatchObject({
			fillStyle: "#ded6c6",
			letterSpacing: "0.66px",
		});
		expect(String(draws[5].font)).toContain("normal normal 22px");
	});

	it("casts a shadow from the outline too when the caption has one", () => {
		const { ctx } = recordingContext();
		const strokes: Array<{ text: string; filter: unknown; style: unknown }> =
			[];
		const record = ctx as unknown as Record<string, unknown>;
		record.strokeText = vi.fn((text: string) => {
			strokes.push({ text, filter: record.filter, style: record.strokeStyle });
		});
		const outlined = {
			...caption,
			secondaryText: undefined,
			style: {
				...caption.style,
				outlineWidth: 2,
				outlineColor: "#101010",
				shadows: [{ color: "#000000", opacity: 0.5, blur: 4, x: 0, y: 2 }],
			},
		} as unknown as CaptionElement;
		renderCaptionElement(ctx, canvas, outlined, 2.5, 0, 24);
		expect(strokes).toEqual([
			{ text: "三年前", filter: "blur(2px)", style: "rgba(0, 0, 0, 0.5)" },
			{ text: "三年前", filter: "none", style: "#101010" },
		]);
	});

	it("fades in over 4 frames and out over 3 at the project rate", () => {
		const alphaAt = (time: number) => {
			const { ctx } = recordingContext();
			renderCaptionElement(ctx, canvas, caption, time, 0, 24);
			return Number((ctx as unknown as { globalAlpha: number }).globalAlpha);
		};
		expect(alphaAt(2 + 1 / 24)).toBeCloseTo(0.25, 6);
		expect(alphaAt(2 + 5 / 24)).toBe(1);
		expect(alphaAt(3 - 1 / 24)).toBeCloseTo(1 / 3, 6);
	});
});
