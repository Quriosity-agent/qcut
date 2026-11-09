import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { timelineReplaceMedia } from "../native-pipeline/editor/editor-handlers-replace-media.js";
import { measureStretchLoudness } from "../native-pipeline/editor/editor-replace-media-loudness.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import { parseCliArgs } from "../native-pipeline/cli/cli.js";

vi.mock(
	"../native-pipeline/editor/editor-replace-media-loudness.js",
	async (importOriginal) => ({
		...(await importOriginal<Record<string, unknown>>()),
		measureStretchLoudness: vi.fn(),
	})
);

/**
 * `replace-media --match-loudness`: the old file is measured before anything
 * is imported, the new one over the same stretch, and the gain change goes
 * to the editor in the same patch as the new media.
 */

const measure = vi.mocked(measureStretchLoudness);
const dirs: string[] = [];

beforeEach(() => {
	measure.mockReset();
});
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function finalFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "qcut-match-loudness-"));
	dirs.push(dir);
	const file = join(dir, "09_final.mp4");
	writeFileSync(file, "");
	return file;
}

const before = {
	id: "shot",
	name: "09_preview.mp4",
	sourceId: "preview",
	startTime: 155.583,
	endTime: 156.708,
	trimStart: 3.833,
	audio: { volumeDb: -2 },
};

function fakeClient({
	clip = before as Record<string, unknown>,
}: {
	clip?: Record<string, unknown>;
} = {}) {
	let swappedTo: string | undefined;
	const media: Record<string, Record<string, unknown>> = {
		preview: { id: "preview", name: "09_preview.mp4", path: "/m/preview.mp4" },
		final: {
			id: "final",
			name: "09_final.mp4",
			path: "/m/final.mp4",
			duration: 20,
		},
	};
	const get = vi.fn(async (url: string) => {
		const mediaId = url.match(/^\/api\/claude\/media\/p1\/(.+)$/)?.[1];
		if (mediaId) return media[decodeURIComponent(mediaId)] ?? null;
		return {
			tracks: [
				{
					id: "main",
					index: 0,
					name: "main",
					elements: [swappedTo ? { ...clip, sourceId: swappedTo } : clip],
				},
			],
		};
	});
	const post = vi.fn(async () => [
		{
			index: 0,
			success: true,
			editorReady: true,
			mediaFile: { id: "final", name: "09_final.mp4" },
		},
	]);
	const patch = vi.fn(async (_url: string, body: { mediaId: string }) => {
		swappedTo = body.mediaId;
		return { updated: true };
	});
	const remove = vi.fn(async () => true);
	return {
		client: { get, post, patch, delete: remove } as unknown as EditorApiClient,
		post,
		patch,
		remove,
	};
}

const options = (overrides: Partial<CLIRunOptions>): CLIRunOptions =>
	({
		command: "editor:timeline:replace-media",
		projectId: "p1",
		elementId: "shot",
		matchLoudness: true,
		...overrides,
	}) as CLIRunOptions;

describe("replace-media --match-loudness", () => {
	it("reads the flag", () => {
		expect(
			parseCliArgs([
				"editor",
				"timeline",
				"replace-media",
				"--project-id",
				"p",
				"--element-id",
				"e",
				"--media-id",
				"m",
				"--match-loudness",
			])
		).toMatchObject({ matchLoudness: true });
	});

	it("moves the gain by the difference between the two files over the clip", async () => {
		measure.mockResolvedValueOnce(-20).mockResolvedValueOnce(-18.6);
		const { client, patch } = fakeClient();
		const result = await timelineReplaceMedia(
			client,
			options({ source: finalFile() })
		);

		expect(result.success).toBe(true);
		const seconds = 156.708 - 155.583;
		expect(measure.mock.calls.map(([{ stretch }]) => stretch)).toEqual([
			{ path: "/m/preview.mp4", start: 3.833, duration: seconds },
			{ path: "/m/final.mp4", start: 3.833, duration: seconds },
		]);
		expect(patch).toHaveBeenCalledWith(
			"/api/claude/timeline/p1/elements/shot",
			{ mediaId: "final", sourceDuration: 20, audio: { volumeDb: -3.4 } }
		);
		expect(result.data).toMatchObject({
			loudness: {
				previousLufs: -20,
				replacementLufs: -18.6,
				gainChangeDb: -1.4,
				volumeDb: -3.4,
			},
		});
	});

	it("measures the new file from the in-point --trim-start gives", async () => {
		measure.mockResolvedValueOnce(-20).mockResolvedValueOnce(-20);
		const { client } = fakeClient();
		await timelineReplaceMedia(
			client,
			options({ mediaId: "final", trimStart: 0 })
		);
		expect(measure.mock.calls[1]?.[0].stretch.start).toBe(0);
	});

	it("refuses before importing when the clip's file is silent", async () => {
		measure.mockResolvedValueOnce(null);
		const { client, post, patch } = fakeClient();
		const result = await timelineReplaceMedia(
			client,
			options({ source: finalFile() })
		);
		expect(result).toMatchObject({ success: false });
		expect(result.error).toContain("has no sound to match");
		expect(post).not.toHaveBeenCalled();
		expect(patch).not.toHaveBeenCalled();
	});

	it("takes back the import when the new file is silent over the clip", async () => {
		measure.mockResolvedValueOnce(-20).mockResolvedValueOnce(null);
		const { client, patch, remove } = fakeClient();
		const result = await timelineReplaceMedia(
			client,
			options({ source: finalFile() })
		);
		expect(result.error).toContain(
			"09_final.mp4 has no sound over the stretch"
		);
		expect(remove).toHaveBeenCalledWith("/api/claude/media/p1/final");
		expect(patch).not.toHaveBeenCalled();
	});

	it("takes back the import when the new file cannot be measured", async () => {
		measure
			.mockResolvedValueOnce(-20)
			.mockRejectedValueOnce(new Error("Audio measurement timed out"));
		const { client, patch, remove } = fakeClient();
		const result = await timelineReplaceMedia(
			client,
			options({ source: finalFile() })
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain(
			"could not measure 09_final.mp4: Audio measurement timed out"
		);
		expect(remove).toHaveBeenCalledWith("/api/claude/media/p1/final");
		expect(patch).not.toHaveBeenCalled();
	});

	it("leaves the gain alone without the flag", async () => {
		const { client, patch } = fakeClient();
		await timelineReplaceMedia(
			client,
			options({ mediaId: "final", matchLoudness: undefined })
		);
		expect(measure).not.toHaveBeenCalled();
		expect(patch).toHaveBeenCalledWith(
			"/api/claude/timeline/p1/elements/shot",
			{ mediaId: "final", sourceDuration: 20 }
		);
	});
});
