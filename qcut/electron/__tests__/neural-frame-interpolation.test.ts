import { describe, expect, it } from "vitest";
import { buildDurationPreservingFrameInterpolationFilter } from "../ffmpeg/frame-interpolation-filter";
import { prepareNeuralInterpolation } from "../ffmpeg/neural-frame-interpolation";
import { resolveNeuralInterpolationSegment } from "../claude/handlers/claude-export-handler/export-neural-segment";
import type {
	ExportSegment,
	ResolvedExportSettings,
} from "../claude/handlers/claude-export-handler/types";

const SETTINGS = { fps: 30 } as ResolvedExportSettings;

function segment(overrides: Partial<ExportSegment> = {}): ExportSegment {
	return {
		elementId: "e1",
		trackId: "t1",
		trackOrder: 0,
		elementOrder: 0,
		sourcePath: "/nonexistent/clip.mp4",
		startTime: 0,
		duration: 2,
		trimStart: 1,
		sourceId: "m1",
		fitMode: "cover",
		...overrides,
	};
}

describe("neural frame interpolation", () => {
	// Validation happens before ffprobe, so these never touch a binary.
	it("rejects impossible windows before probing anything", async () => {
		await expect(
			prepareNeuralInterpolation({
				sourcePath: "/nonexistent/clip.mp4",
				trimStart: 0,
				readDuration: 0,
				requiredFrames: 10,
				workDir: "/tmp/unused",
			})
		).rejects.toThrow(RangeError);
		await expect(
			prepareNeuralInterpolation({
				sourcePath: "/nonexistent/clip.mp4",
				trimStart: 0,
				readDuration: 1,
				requiredFrames: 1,
				workDir: "/tmp/unused",
			})
		).rejects.toThrow(RangeError);
	});

	it("passes every non-neural segment through untouched", async () => {
		for (const input of [
			segment(),
			segment({ frameInterpolation: "motion-compensated" }),
			segment({ frameInterpolation: "neural", isImage: true }),
		]) {
			await expect(
				resolveNeuralInterpolationSegment({
					segment: input,
					settings: SETTINGS,
					tempDir: "/tmp/unused",
					index: 0,
				})
			).resolves.toBe(input);
		}
	});

	// A neural segment reaching the graph builder means the pre-stage was
	// skipped; exporting it as a plain clip would misreport the setting.
	it("refuses to build a filter for an unresolved neural segment", () => {
		expect(() =>
			buildDurationPreservingFrameInterpolationFilter({
				mode: "neural",
				fps: 30,
			})
		).toThrow(/resolved before the filter graph/);
		expect(
			buildDurationPreservingFrameInterpolationFilter({ mode: "none", fps: 30 })
		).toBe("");
	});
});
