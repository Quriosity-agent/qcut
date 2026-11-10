import { describe, expect, it } from "vitest";
import { buildMediaOverlayPassArgs } from "../claude/handlers/claude-export-handler/media-overlay-pass.js";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types.js";
import { isConstantExpression } from "../ffmpeg/keyframe-expression.js";

const SETTINGS = {
	width: 1280,
	height: 720,
	fps: 24,
	codec: "libx264",
	bitrate: "8M",
};

function clip(extra: Partial<ExportSegment> = {}): ExportSegment {
	return {
		elementId: "overlay-1",
		trackId: "overlays",
		trackOrder: 0,
		elementOrder: 0,
		sourcePath: "/media/overlay.mov",
		startTime: 1,
		duration: 2,
		trimStart: 0,
		sourceId: "overlay",
		fitMode: "cover",
		...extra,
	};
}

function pass(
	segment: ExportSegment,
	baseColor?: { range: string; space: string }
) {
	return buildMediaOverlayPassArgs({
		inputPath: "/tmp/video-before-media-overlays.mp4",
		outputPath: "/tmp/out.mp4",
		overlays: [{ segment, alpha: null }],
		settings: SETTINGS,
		duration: 5,
		baseColor,
	});
}

const transform = { x: 0, y: 0, rotationDegrees: 0, scaleX: 1, scaleY: 1 };

describe("buildMediaOverlayPassArgs", () => {
	it("keeps the filter graph when the joined picture's colour tags change", () => {
		expect(pass(clip()).args.slice(0, 5)).toEqual([
			"-y",
			"-reinit_filter",
			"0",
			"-i",
			"/tmp/video-before-media-overlays.mp4",
		]);
	});

	it("draws on the picture as it is, with exact conversions for the layers", () => {
		const steps = pass(clip()).filterComplex.split(";");
		expect(steps[0]).toBe("sws_flags=bicubic+accurate_rnd+full_chroma_int");
		const composite = steps.find((step) => step.startsWith("[0:v]["));
		expect(composite).toContain(":format=yuv420:");
		expect(steps.at(-1)).toMatch(/format=yuv420p\[media_overlay_out\]$/);
	});

	it("describes every frame of the picture as its first one is tagged", () => {
		const steps = pass(clip(), {
			range: "tv",
			space: "bt709",
		}).filterComplex.split(";");
		expect(steps[1]).toBe(
			"[0:v]setparams=range=tv:colorspace=bt709[media_overlay_base]"
		);
		expect(steps.some((step) => step.startsWith("[0:v]["))).toBe(false);
		expect(steps.some((step) => step.startsWith("[media_overlay_base]["))).toBe(
			true
		);
		// Untagged, or tagged with something setparams has no name for.
		expect(
			pass(clip(), { range: "unknown", space: "reserved" }).filterComplex
		).toContain("[0:v]setparams=range=unknown:colorspace=unknown[");
	});

	it("blends in planar RGB, which a yuv420 overlay would otherwise pull into YUV", () => {
		const graph = pass(clip({ blendMode: "multiply" })).filterComplex;
		expect(graph).toContain("format=gbrap[media_overlay_video_0_base_blend]");
		expect(graph).toMatch(
			/format=gbrap\[media_overlay_video_0_foreground_input\]/
		);
	});

	// geq runs an expression for every pixel of every frame: 21 overlays took
	// an 80 s export to 180 s, though none was cropped or less than opaque.
	it("runs no per-pixel expression for a clip that is neither cropped nor faded", () => {
		expect(pass(clip()).filterComplex).not.toContain("geq=");
		expect(
			pass(clip({ transform: { ...transform, opacity: 1 } })).filterComplex
		).not.toContain("geq=");
	});

	it("still scales the alpha of a clip that is less than opaque, or fades", () => {
		const half = pass(
			clip({ transform: { ...transform, opacity: 0.5 } })
		).filterComplex;
		expect(half.match(/geq=/g)).toHaveLength(1);
		expect(half).toContain("a='alpha(X,Y)*max(0,min(1,(0.5)*");
		const fading = pass(
			clip({
				keyframes: {
					opacity: [
						{ frame: 0, value: 0 },
						{ frame: 12, value: 1 },
					],
				},
			})
		).filterComplex;
		expect(fading.match(/geq=/g)).toHaveLength(1);
	});
});

describe("isConstantExpression", () => {
	it("reads the products the keyframe and animation builders write for a fixed value", () => {
		expect(isConstantExpression({ expression: "1", value: 1 })).toBe(true);
		expect(
			isConstantExpression({ expression: "(1)*((1))*(1)*(1)", value: 1 })
		).toBe(true);
		expect(isConstantExpression({ expression: "(0.5)*(2)", value: 1 })).toBe(
			true
		);
		expect(isConstantExpression({ expression: "0", value: 0 })).toBe(true);
	});

	it("is false for another value and for anything that is not plain numbers", () => {
		expect(isConstantExpression({ expression: "(0.5)*((1))", value: 1 })).toBe(
			false
		);
		expect(isConstantExpression({ expression: "0.1", value: 0 })).toBe(false);
		expect(
			isConstantExpression({ expression: "if(lt(T,1),0,1)", value: 1 })
		).toBe(false);
		expect(isConstantExpression({ expression: "(1)*(T)", value: 1 })).toBe(
			false
		);
		expect(isConstantExpression({ expression: "", value: 1 })).toBe(false);
		expect(isConstantExpression({ expression: "1e3", value: 1000 })).toBe(
			false
		);
	});
});
