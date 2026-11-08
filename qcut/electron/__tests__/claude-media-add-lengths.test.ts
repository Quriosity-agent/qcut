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

const { withMediaAddLengths } = await import(
	"../claude/handlers/claude-media-add-lengths.js"
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

/** sample-video.mp4 is 5 s long. */
const video = { type: "media", trackId: "main", sourceId: "media-video" };

async function settle(elements: Array<Record<string, unknown>>) {
	return withMediaAddLengths({ projectId: "project-1", elements });
}

describe("withMediaAddLengths", () => {
	beforeEach(() => {
		clearMediaProbeCache();
		listing.files = [
			fixture({ id: "media-video", name: "sample-video.mp4", type: "video" }),
			fixture({ id: "media-image", name: "sample-image.png", type: "image" }),
		];
	});

	it("refuses a trimmed clip whose duration is its length after the trims (Q1)", async () => {
		// The report's shape (8.5 s wanted from a 15.04 s file by trimEnd
		// 6.54 s showed 1.96 s), scaled to the 5 s fixture: 2 s wanted by
		// trimEnd 1 s would show 1 s.
		await expect(
			settle([{ ...video, startTime: 0, duration: 2, trimEnd: 1 }])
		).rejects.toThrow(
			/The clip \("media-video"\): duration 2s is the clip's source span before its trims, so the trims leave 1s on the timeline, but the file is 5s long\. With trims, give "timelineDuration"/
		);
	});

	it("keeps a trimmed clip that spans its whole file, rounding included", async () => {
		const [exact, rounded] = await settle([
			{ ...video, startTime: 0, duration: 5, trimStart: 1, trimEnd: 1.5 },
			{ ...video, startTime: 4, duration: 4.98, trimEnd: 2 },
		]);
		expect(exact).toMatchObject({ duration: 5, trimStart: 1, trimEnd: 1.5 });
		expect(rounded).toMatchObject({ duration: 4.98, trimEnd: 2 });
	});

	it("leaves an untrimmed clip shorter than its file alone", async () => {
		const elements = [{ ...video, startTime: 0, duration: 2 }];
		expect(await settle(elements)).toEqual(elements);
	});

	it("reads timeline export's shape: duration after trims beside timelineDuration", async () => {
		const [exported] = await settle([
			{
				...video,
				startTime: 1,
				endTime: 3,
				duration: 2,
				timelineDuration: 2,
				trimEnd: 3,
			},
		]);
		expect(exported).toEqual({
			...video,
			startTime: 1,
			duration: 5,
			trimEnd: 3,
		});
	});

	it("derives the span from timelineDuration and speed when duration is left out", async () => {
		const [fast] = await settle([
			{
				...video,
				startTime: 0,
				timelineDuration: 2,
				trimStart: 1,
				playbackRate: 2,
			},
		]);
		expect(fast).toMatchObject({ duration: 5, trimStart: 1 });
		expect(fast).not.toHaveProperty("timelineDuration");
	});

	it("refuses a duration before trims written beside timelineDuration", async () => {
		await expect(
			settle([
				{
					...video,
					startTime: 0,
					duration: 5,
					timelineDuration: 2,
					trimEnd: 3,
				},
			])
		).rejects.toThrow(
			/duration 5s disagrees with its 2s on the timeline\. Beside timelineDuration, duration is the span after the trims, as timeline export writes it: 2s here/
		);
	});

	it("reads endTime without duration as the end on the timeline", async () => {
		const [ended] = await settle([
			{ ...video, startTime: 1, endTime: 3, trimStart: 0.5 },
		]);
		expect(ended).toEqual({
			...video,
			startTime: 1,
			duration: 2.5,
			trimStart: 0.5,
		});
	});

	it("refuses an endTime that disagrees with duration and trims", async () => {
		await expect(
			settle([{ ...video, startTime: 0, duration: 5, trimEnd: 1, endTime: 5 }])
		).rejects.toThrow(/endTime 5s disagrees .* end the clip at 4s/);
		const [agreeing] = await settle([
			{ ...video, startTime: 0, duration: 5, trimEnd: 1, endTime: 4 },
		]);
		expect(agreeing).not.toHaveProperty("endTime");
	});

	it("refuses clips with nothing left after their trims (Q3)", async () => {
		await expect(
			settle([
				{ ...video, startTime: 0, duration: 5, trimStart: 3, trimEnd: 2 },
			])
		).rejects.toThrow(
			/trimStart 3s and trimEnd 2s leave nothing of duration 5s/
		);
		// The file's own length, filled in for a clip given none, too.
		await expect(
			settle([{ ...video, startTime: 0, trimStart: 4, trimEnd: 1 }])
		).rejects.toThrow(/leave nothing of duration 5s/);
		await expect(
			settle([{ ...video, startTime: 0, timelineDuration: 0, trimEnd: 1 }])
		).rejects.toThrow(/its length on the timeline must be above 0/);
	});

	it("names the element of a batch it refuses", async () => {
		await expect(
			settle([
				{ ...video, startTime: 0, duration: 5 },
				{
					...video,
					name: "举剑",
					startTime: 5,
					duration: 1,
					trimStart: 1,
				},
			])
		).rejects.toThrow(/^Element 1 \("举剑"\): trimStart 1s/);
	});

	it("refuses frame counts beside trims", async () => {
		await expect(
			settle([{ ...video, startTime: 0, durationFrames: 48, trimStart: 1 }])
		).rejects.toThrow(/durationFrames counts the frames before the trims/);
	});

	it("checks stills only for something left, and leaves other types alone", async () => {
		const elements = [
			{
				type: "media",
				sourceId: "media-image",
				startTime: 0,
				duration: 3,
				trimEnd: 1,
			},
			{ type: "text", content: "Title", startTime: 0, duration: 2, endTime: 9 },
			{ type: "media", sourceId: "not-imported", duration: 2, trimEnd: 1 },
		];
		expect(await settle(elements)).toEqual(elements);
		await expect(
			settle([
				{ type: "media", sourceId: "media-image", duration: 1, trimEnd: 1 },
			])
		).rejects.toThrow(/leave nothing/);
	});
});
