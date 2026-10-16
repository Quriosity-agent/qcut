import { describe, expect, it, vi } from "vitest";
import type { CaptionElement } from "@/types/timeline";
import { renderCaptionElement } from "../export-engine-renderer";

/**
 * Captions land where the preview draws them: the line box 28 px in from the
 * top or bottom edge, text 36 px in from a side. The native ASS pass pins
 * its captions to the same points (text-overlay.ts), so both engines and the
 * preview agree.
 */

vi.mock("@/stores/ai/effects-store", () => ({
	useEffectsStore: {
		getState: () => ({ getElementEffects: () => [] }),
	},
}));
vi.mock("@/config/features", () => ({ EFFECTS_ENABLED: false }));

function fakeContext() {
	const fillText = vi.fn();
	const ctx = {
		save: vi.fn(),
		restore: vi.fn(),
		fillRect: vi.fn(),
		strokeText: vi.fn(),
		fillText,
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		stroke: vi.fn(),
		measureText: vi.fn((text: string) => ({ width: text.length * 20 })),
		globalAlpha: 1,
		font: "",
		letterSpacing: "",
		textAlign: "center",
		textBaseline: "middle",
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 0,
		lineJoin: "miter",
	};
	return { ctx: ctx as unknown as CanvasRenderingContext2D, fillText };
}

const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;

/** The glyph pass: the default style's 1 px shadow draws the text first. */
function lastText(fillText: ReturnType<typeof vi.fn>) {
	return fillText.mock.calls.filter(([text]) => text === "Hello").at(-1);
}

function caption(style: Record<string, unknown> = {}): CaptionElement {
	return {
		id: "caption",
		type: "captions",
		name: "caption",
		text: "Hello",
		language: "en",
		source: "manual",
		startTime: 0,
		duration: 2,
		trimStart: 0,
		trimEnd: 0,
		style,
	} as unknown as CaptionElement;
}

describe("muxer caption placement", () => {
	it("sits a bottom caption's line box 28 px above the bottom edge", () => {
		const { ctx, fillText } = fakeContext();
		renderCaptionElement(ctx, canvas, caption(), 1);
		// One 48 px line at 1.4 spacing is 67.2 px tall: its centre (where the
		// text is drawn, baseline middle) is 28 + 33.6 px above the bottom.
		const textCall = lastText(fillText);
		expect(textCall?.[1]).toBe(640);
		expect(textCall?.[2]).toBeCloseTo(720 - 28 - 33.6, 5);
	});

	it("pins top-left and right captions at the preview's 28 × 36 px insets", () => {
		const topLeft = fakeContext();
		renderCaptionElement(
			topLeft.ctx,
			canvas,
			caption({ textAlign: "left", position: { align: "top", x: 50, y: 10 } }),
			1
		);
		const left = lastText(topLeft.fillText);
		expect(left?.[1]).toBe(36);
		expect(left?.[2]).toBeCloseTo(28 + 33.6, 5);

		const right = fakeContext();
		renderCaptionElement(right.ctx, canvas, caption({ textAlign: "right" }), 1);
		const rightCall = lastText(right.fillText);
		expect(rightCall?.[1]).toBe(1280 - 36);
	});
});
