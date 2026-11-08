import { afterEach, describe, expect, it, vi } from "vitest";
import {
	debugLog,
	debugWarn,
	setFFmpegDebugLogging,
} from "../ffmpeg/constants.js";

describe("[FFmpeg] debug lines (Q5, 2026-11-08 report)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		setFFmpegDebugLogging(true);
	});

	it("stay quiet when the CLI turns them off, whatever NODE_ENV says", () => {
		vi.stubEnv("NODE_ENV", "");
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		setFFmpegDebugLogging(false);
		debugLog("Using staged FFprobe binary from packaged resources:", "/x");
		debugWarn("Staged FFprobe binary exists but failed executable check:");
		expect(error).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	it("print under --verbose", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		setFFmpegDebugLogging(true);
		debugLog("Using staged FFprobe binary in development:", "/x");
		expect(error).toHaveBeenCalledWith(
			"[FFmpeg]",
			"Using staged FFprobe binary in development:",
			"/x"
		);
	});
});
