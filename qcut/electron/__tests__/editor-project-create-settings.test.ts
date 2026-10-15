import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleMediaProjectCommand } from "../native-pipeline/editor/editor-handlers-media.js";
import { resolveProjectCreateSettings } from "../native-pipeline/editor/editor-project-create-settings.js";
import { probeVideoInfo } from "../native-pipeline/subtitle/probe-video.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";

const SAMPLE_VIDEO = path.resolve(
	__dirname,
	"../../apps/web/src/test/e2e/fixtures/media/sample-video.mp4"
);

const clip720p24 = vi.fn(async () => ({
	width: 1280,
	height: 720,
	duration: 17.041667,
	fps: 24,
}));

describe("resolveProjectCreateSettings", () => {
	it("takes size and frame rate from --match-media", async () => {
		expect(
			await resolveProjectCreateSettings({
				matchMedia: "/clips/07.mp4",
				probe: clip720p24,
			})
		).toEqual({ width: 1280, height: 720, fps: 24 });
	});

	it("lets explicit flags win over the matched clip", async () => {
		expect(
			await resolveProjectCreateSettings({
				matchMedia: "/clips/07.mp4",
				fps: 25,
				probe: clip720p24,
			})
		).toEqual({ width: 1280, height: 720, fps: 25 });
		expect(
			await resolveProjectCreateSettings({ width: 1080, height: 1920 })
		).toEqual({ width: 1080, height: 1920 });
	});

	it("asks for nothing when no flag is given", async () => {
		expect(await resolveProjectCreateSettings({})).toEqual({});
	});

	it("refuses half a size, bad numbers and unreadable media", async () => {
		await expect(resolveProjectCreateSettings({ width: 1280 })).rejects.toThrow(
			"Give --width and --height together"
		);
		await expect(
			resolveProjectCreateSettings({ width: 12.5, height: 720 })
		).rejects.toThrow("--width must be a whole number of pixels above 0");
		await expect(resolveProjectCreateSettings({ fps: 0 })).rejects.toThrow(
			"--fps must be a number above 0"
		);
		await expect(
			resolveProjectCreateSettings({
				matchMedia: "/clips/missing.mp4",
				probe: async () => {
					throw new Error("No such file");
				},
			})
		).rejects.toThrow("--match-media could not read /clips/missing.mp4");
	});

	it("reads a real clip's frame rate", async () => {
		expect(await probeVideoInfo(SAMPLE_VIDEO)).toMatchObject({
			width: 1280,
			height: 720,
			fps: 30,
		});
	});
});

describe("editor:project:create with settings", () => {
	function makeOptions(overrides: Partial<CLIRunOptions>): CLIRunOptions {
		return {
			command: "editor:project:create",
			outputDir: "./output",
			json: true,
			verbose: false,
			quiet: false,
			saveIntermediates: false,
			...overrides,
		} as CLIRunOptions;
	}

	it("applies the requested settings to the new project", async () => {
		const post = vi.fn(async () => ({ projectId: "p-new", name: "Door" }));
		const patch = vi.fn(async () => ({ updated: true }));
		const client = { post, patch } as unknown as EditorApiClient;

		const result = await handleMediaProjectCommand(
			client,
			makeOptions({ name: "Door", width: 1280, height: 720, fps: 24 }),
			() => {}
		);

		expect(result).toEqual({
			success: true,
			data: {
				projectId: "p-new",
				name: "Door",
				settings: { width: 1280, height: 720, fps: 24 },
			},
		});
		expect(patch).toHaveBeenCalledWith("/api/claude/project/p-new/settings", {
			width: 1280,
			height: 720,
			fps: 24,
		});
	});

	it("creates nothing when a flag is invalid", async () => {
		const post = vi.fn();
		const client = { post, patch: vi.fn() } as unknown as EditorApiClient;

		const result = await handleMediaProjectCommand(
			client,
			makeOptions({ name: "Door", width: 1280 }),
			() => {}
		);

		expect(result).toEqual({
			success: false,
			error: "Give --width and --height together",
		});
		expect(post).not.toHaveBeenCalled();
	});
});
