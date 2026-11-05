import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownElement, TimelineTrack } from "@/types/timeline";
import type { ExportSettings } from "@/types/export";
import { ExportEngine } from "../export-engine";
import { OptimizedExportEngine } from "../export-engine-optimized";

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({ isElectron: false }),
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: () => ({
			activeProject: { canvasSize: { width: 640, height: 360 } },
		}),
	},
}));
vi.mock("@/lib/ffmpeg/ffmpeg-video-recorder", () => ({
	FFmpegVideoRecorder: class {},
	isFFmpegExportEnabled: () => false,
}));
vi.mock("@/stores/stickers-overlay-store", () => ({
	useStickersOverlayStore: {
		getState: () => ({
			getStickersForExport: () => [],
			getVisibleStickersAtTime: () => [],
		}),
	},
}));
vi.mock("@/stores/screen-recording-store", () => ({
	useScreenRecordingEnhancementStore: { getState: () => ({}) },
	hasActiveEnhancements: () => false,
}));

const markdown: MarkdownElement = {
	id: "markdown",
	type: "markdown",
	name: "Markdown",
	startTime: 0,
	duration: 2,
	trimStart: 0,
	trimEnd: 0,
	markdownContent:
		"## Centered heading\nA paragraph with enough words to wrap across several lines and overflow this small text box.\nLast line below the clipped edge.",
	theme: "dark",
	fontSize: 22,
	fontFamily: "Arial",
	padding: 12,
	backgroundColor: "#00aa66",
	textColor: "#ffffff",
	scrollMode: "auto-scroll",
	scrollSpeed: 28,
	x: 73,
	y: -31,
	width: 216,
	height: 106,
	rotation: 17,
	opacity: 0.65,
};

function pixels({ canvas }: { canvas: Canvas }) {
	return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height)
		.data;
}

describe("optimized Markdown export pixels", () => {
	beforeEach(() => {
		vi.stubGlobal("OffscreenCanvas", undefined);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each(
		[
			{ width: 640, height: 360 },
			{ width: 1280, height: 720 },
			{ width: 320, height: 180 },
			{ width: 360, height: 640 },
		].flatMap((frame) =>
			[false, true].map((offscreen) => ({ ...frame, offscreen }))
		)
	)("matches the canonical engine including scrolling and cache at $width x $height (offscreen: $offscreen)", async ({
		width,
		height,
		offscreen,
	}) => {
		if (offscreen) vi.stubGlobal("OffscreenCanvas", createCanvas);
		const tracks: TimelineTrack[] = [
			{
				id: "markdown-track",
				name: "Markdown",
				type: "markdown",
				elements: [markdown],
			},
		];
		const settings: ExportSettings = {
			format: "webm",
			quality: "720p",
			filename: "markdown.webm",
			width,
			height,
			frameRate: 30,
			backgroundColor: "#101820",
		};
		const reference = createCanvas(width, height);
		const actual = createCanvas(width, height);
		const base = new ExportEngine(
			reference as unknown as HTMLCanvasElement,
			settings,
			tracks,
			[],
			2
		);
		const optimized = new OptimizedExportEngine(
			actual as unknown as HTMLCanvasElement,
			settings,
			tracks,
			[],
			2
		);
		try {
			await base.renderFrame(0.25);
			await optimized.renderFrame(0.25);
			const first = pixels({ canvas: reference });
			expect(first.some((value, index) => index % 4 === 1 && value > 50)).toBe(
				true
			);
			expect(
				pixels({ canvas: actual }).findIndex(
					(value, index) => value !== first[index]
				)
			).toBe(-1);

			await base.renderFrame(0.75);
			await optimized.renderFrame(0.75);
			const scrolled = pixels({ canvas: reference });
			expect(
				scrolled.findIndex((value, index) => value !== first[index])
			).toBeGreaterThanOrEqual(0);
			expect(
				pixels({ canvas: actual }).findIndex(
					(value, index) => value !== scrolled[index]
				)
			).toBe(-1);

			await optimized.renderFrame(0.25);
			expect(
				pixels({ canvas: actual }).findIndex(
					(value, index) => value !== first[index]
				)
			).toBe(-1);
			expect(optimized.getPerformanceMetrics().cacheHits).toBe(1);
		} finally {
			optimized.cleanup();
		}
	});
});
