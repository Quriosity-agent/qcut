import { describe, expect, it } from "vitest";
import {
	mediaOverlayInputArgs,
	mediaOverlayVideoSource,
	overlayFrameWindow,
	readSegmentBlendFields,
} from "../claude/handlers/claude-export-handler/media-overlay-source.js";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types.js";
import { videoAlphaFromStream } from "../ffmpeg/video-alpha.js";

function segment(extra: Partial<ExportSegment> = {}): ExportSegment {
	return {
		elementId: "overlay",
		trackId: "upper",
		trackOrder: 0,
		elementOrder: 2,
		sourcePath: "/media/card.webm",
		startTime: 1,
		duration: 2.5,
		trimStart: 0,
		sourceId: "card",
		fitMode: "contain",
		...extra,
	};
}

const opacityKeyframes = [
	{ id: "k1", frame: 0, value: 0, easing: "linear" as const },
	{ id: "k2", frame: 12, value: 1, easing: "linear" as const },
];

describe("videoAlphaFromStream", () => {
	it("reads VP9 alpha from alpha_mode and names libvpx", () => {
		expect(
			videoAlphaFromStream({
				stream: {
					codec_name: "vp9",
					pix_fmt: "yuv420p",
					tags: { alpha_mode: "1" },
				},
			})
		).toEqual({
			codec: "vp9",
			pixelFormat: "yuv420p",
			alphaMode: 1,
			hasAlpha: true,
			decoder: "libvpx-vp9",
		});
		expect(
			videoAlphaFromStream({
				stream: {
					codec_name: "vp8",
					pix_fmt: "yuv420p",
					tags: { ALPHA_MODE: "1" },
				},
			}).decoder
		).toBe("libvpx");
	});

	it("reads alpha from the pixel format, needing no special decoder", () => {
		for (const pixelFormat of ["yuva444p12le", "argb", "rgba", "gbrap"]) {
			const alpha = videoAlphaFromStream({
				stream: { codec_name: "prores", pix_fmt: pixelFormat },
			});
			expect(alpha.hasAlpha).toBe(true);
			expect(alpha.decoder).toBeUndefined();
		}
	});

	it("finds no alpha in an opaque stream", () => {
		expect(
			videoAlphaFromStream({
				stream: { codec_name: "h264", pix_fmt: "yuv420p" },
			}).hasAlpha
		).toBe(false);
	});
});

describe("readSegmentBlendFields", () => {
	it("keeps the blend mode and keyframes", () => {
		expect(
			readSegmentBlendFields({
				element: {
					blendMode: "screen",
					keyframes: { opacity: opacityKeyframes },
				},
			})
		).toEqual({
			blendMode: "screen",
			keyframes: { opacity: opacityKeyframes },
		});
	});

	it("drops normal, unknown and empty values", () => {
		expect(
			readSegmentBlendFields({
				element: { blendMode: "normal", keyframes: { x: [] } },
			})
		).toEqual({});
		expect(
			readSegmentBlendFields({
				element: { blendMode: "dissolve" as "normal" },
			})
		).toEqual({});
	});

	it("draws normally without opacity keyframes when the blend section is off", () => {
		expect(
			readSegmentBlendFields({
				element: {
					blendMode: "multiply",
					blendEnabled: false,
					keyframes: { opacity: opacityKeyframes, x: opacityKeyframes },
				},
			})
		).toEqual({ keyframes: { x: opacityKeyframes } });
	});
});

describe("overlayFrameWindow", () => {
	it("covers the frames the preview shows the clip on", () => {
		expect(
			overlayFrameWindow({ startTime: 1, duration: 64 / 24, fps: 24 })
		).toEqual({ firstFrame: 24, frameCount: 64 });
		// 13.0833 s sits a hair before frame 314 (13.08333 s): it starts there.
		expect(
			overlayFrameWindow({ startTime: 13.0833, duration: 2.6667, fps: 24 })
		).toEqual({ firstFrame: 314, frameCount: 64 });
		// An edge a hair past a frame (ripple-delete noise) is on that frame.
		expect(
			overlayFrameWindow({ startTime: 2.0003, duration: 1.0004, fps: 24 })
		).toEqual({ firstFrame: 48, frameCount: 24 });
	});
});

describe("mediaOverlayInputArgs", () => {
	it("decodes a VP9 alpha source with libvpx, cut to the clip's source span", () => {
		expect(
			mediaOverlayInputArgs({
				segment: segment({ trimStart: 0.5, playbackRate: 2 }),
				alpha: videoAlphaFromStream({
					stream: {
						codec_name: "vp9",
						pix_fmt: "yuv420p",
						tags: { alpha_mode: "1" },
					},
				}),
			})
		).toEqual([
			"-c:v",
			"libvpx-vp9",
			"-ss",
			"0.5",
			"-t",
			"5",
			"-i",
			"/media/card.webm",
		]);
	});

	it("reads other sources with FFmpeg's own decoder", () => {
		expect(
			mediaOverlayInputArgs({
				segment: segment({ sourcePath: "/media/card.mov" }),
				alpha: videoAlphaFromStream({
					stream: { codec_name: "qtrle", pix_fmt: "argb" },
				}),
			})
		).toEqual(["-t", "2.5", "-i", "/media/card.mov"]);
	});

	it("loops a still for the clip's length", () => {
		expect(
			mediaOverlayInputArgs({
				segment: segment({ isImage: true, sourcePath: "/media/logo.png" }),
				alpha: null,
			})
		).toEqual(["-loop", "1", "-t", "2.5", "-i", "/media/logo.png"]);
	});
});

describe("mediaOverlayVideoSource", () => {
	it("describes the cut source on the clip's first frame with its transform, blend and keyframes", () => {
		const source = mediaOverlayVideoSource({
			fps: 24,
			segment: segment({
				startTime: 1.01,
				playbackRate: 2,
				blendMode: "multiply",
				keyframes: { opacity: opacityKeyframes },
				transform: {
					x: 40,
					y: -20,
					rotationDegrees: 15,
					scaleX: 0.5,
					scaleY: 0.75,
					opacity: 0.8,
				},
			}),
		});
		expect(source).toMatchObject({
			trackOrder: 0,
			elementOrder: 2,
			startTime: 25 / 24,
			duration: 5,
			trimStart: 0,
			trimEnd: 0,
			playbackRate: 2,
		});
		expect(source.visual).toMatchObject({
			x: 40,
			y: -20,
			rotation: 15,
			scaleX: 0.5,
			scaleY: 0.75,
			opacity: 0.8,
			blendMode: "multiply",
			fitMode: "contain",
			keyframes: { opacity: opacityKeyframes },
			keyframeFps: 24,
		});
	});
});
