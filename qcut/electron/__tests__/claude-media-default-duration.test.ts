import { statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaFile } from "../types/claude-api.js";

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/tmp"), isPackaged: false },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

const listing = vi.hoisted(() => ({ files: [] as MediaFile[] }));

vi.mock(
	"../claude/handlers/claude-media-handler.js",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("../claude/handlers/claude-media-handler.js")
			>();
		return {
			...actual,
			listMediaFiles: vi.fn(async () => listing.files),
		};
	}
);

const { withDefaultMediaDurations } = await import(
	"../claude/handlers/claude-media-default-duration.js"
);
const { clearMediaProbeCache } = await import(
	"../claude/handlers/claude-media-probe.js"
);

const FIXTURES = path.resolve(
	__dirname,
	"../../apps/web/src/test/e2e/fixtures/media"
);

function fixture({
	id,
	name,
	type,
}: {
	id: string;
	name: string;
	type: MediaFile["type"];
}): MediaFile {
	const filePath = path.join(FIXTURES, name);
	const stat = statSync(filePath);
	return {
		id,
		name,
		type,
		path: filePath,
		size: stat.size,
		createdAt: stat.birthtimeMs,
		modifiedAt: stat.mtimeMs,
	};
}

describe("withDefaultMediaDurations", () => {
	beforeEach(() => {
		clearMediaProbeCache();
		listing.files = [
			fixture({ id: "media-video", name: "sample-video.mp4", type: "video" }),
			fixture({ id: "media-audio", name: "sample-audio.mp3", type: "audio" }),
			fixture({ id: "media-image", name: "sample-image.png", type: "image" }),
		];
	});

	it("gives media named without a length its file's length", async () => {
		const [bySourceId, byName, audio] = await withDefaultMediaDurations({
			projectId: "project-1",
			elements: [
				{ type: "media", trackId: "main", sourceId: "media-video" },
				{ type: "video", trackId: "main", sourceName: "sample-video.mp4" },
				{ type: "audio", trackId: "audio", sourceId: "media-audio" },
			],
		});
		expect(bySourceId.duration).toBe(5);
		expect(byName.duration).toBe(5);
		expect(audio.duration).toBeGreaterThan(0);
	});

	it("leaves a length the caller gave alone", async () => {
		const elements = [
			{ type: "media", sourceId: "media-video", duration: 2 },
			{ type: "media", sourceId: "media-video", durationFrames: 48 },
			{ type: "media", sourceId: "media-video", startTime: 0, endTime: 1 },
		];
		expect(
			await withDefaultMediaDurations({ projectId: "project-1", elements })
		).toBe(elements);
	});

	it("leaves stills, other element types and unknown media unchanged", async () => {
		const elements = [
			{ type: "media", sourceId: "media-image" },
			{ type: "text", content: "Title" },
			{ type: "media", sourceId: "not-imported" },
		];
		expect(
			await withDefaultMediaDurations({ projectId: "project-1", elements })
		).toEqual(elements);
	});
});
