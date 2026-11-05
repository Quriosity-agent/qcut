import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportSettingsWithAudio } from "@/types/export";
import { ExportFormat, ExportQuality } from "@/types/export";
import { useProjectStore } from "@/stores/project-store";

const mocks = vi.hoisted(() => ({ buildTimelineAssLayers: vi.fn() }));

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({
		ffmpeg: {
			exportVideoCLI: vi.fn(),
		},
	}),
}));

vi.mock("@/lib/ffmpeg/ffmpeg-video-recorder", () => ({
	FFmpegVideoRecorder: class {},
	isFFmpegExportEnabled: () => false,
}));

vi.mock("@/stores/stickers-overlay-store", () => ({
	useStickersOverlayStore: {
		getState: () => ({ getStickersForExport: () => [] }),
	},
}));

vi.mock("../export-engine-cli-text", async (importOriginal) => ({
	...(await importOriginal<typeof import("../export-engine-cli-text")>()),
	buildTimelineAssLayers: mocks.buildTimelineAssLayers,
}));

import { CLIExportEngine } from "../export-engine-cli";

const STOP = "stop once the layers were asked for";

function exportAt(frame: { width: number; height: number }) {
	const context = {
		imageSmoothingEnabled: true,
		imageSmoothingQuality: "high",
	} as unknown as CanvasRenderingContext2D;
	const canvas = {
		width: 0,
		height: 0,
		getContext: () => context,
	} as unknown as HTMLCanvasElement;
	const settings: ExportSettingsWithAudio = {
		format: ExportFormat.MP4,
		quality: ExportQuality.MEDIUM,
		filename: "output",
		...frame,
		frameRate: 30,
		includeAudio: false,
	};
	const engine = new CLIExportEngine(canvas, settings, [], [], 1);
	// Past the timeline analysis, which an empty timeline would not get through.
	return (
		engine as unknown as { exportWithCLI: () => Promise<string> }
	).exportWithCLI();
}

describe("CLIExportEngine's ASS layers", () => {
	beforeEach(() => {
		mocks.buildTimelineAssLayers.mockReset();
		mocks.buildTimelineAssLayers.mockImplementation(() => {
			throw new Error(STOP);
		});
	});

	it("are written for the project's canvas, not the export's frame", async () => {
		useProjectStore.setState({
			activeProject: { canvasSize: { width: 1920, height: 1080 } },
		} as never);

		await expect(exportAt({ width: 1280, height: 720 })).rejects.toThrow(STOP);

		expect(mocks.buildTimelineAssLayers).toHaveBeenCalledWith(
			expect.objectContaining({ canvasWidth: 1920, canvasHeight: 1080 })
		);
	});

	it("are written for the frame without a project to go by", async () => {
		useProjectStore.setState({ activeProject: null } as never);

		await expect(exportAt({ width: 1280, height: 720 })).rejects.toThrow(STOP);

		expect(mocks.buildTimelineAssLayers).toHaveBeenCalledWith(
			expect.objectContaining({ canvasWidth: 1280, canvasHeight: 720 })
		);
	});
});
