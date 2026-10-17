import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TProject } from "@/types/project";
import {
	copyProjectContents,
	duplicateProjectName,
} from "../project-duplicate";

const storage = vi.hoisted(() => ({
	copyProjectMedia: vi.fn(),
	loadFolders: vi.fn(),
	saveFolders: vi.fn(),
	loadTimeline: vi.fn(),
	saveTimeline: vi.fn(),
}));
const platformStorage = vi.hoisted(() => ({
	load: vi.fn(),
	save: vi.fn(),
}));
vi.mock("@/lib/storage/storage-service", () => ({ storageService: storage }));
vi.mock("@qcut/platform-core", () => ({
	platform: () => ({ storage: platformStorage }),
}));
vi.mock("@/lib/debug/debug-config", () => ({
	debugLog: vi.fn(),
	debugError: vi.fn(),
}));

const project = {
	id: "src",
	name: "门的计划",
	scenes: [{ id: "scene-a" }, { id: "scene-b" }],
	currentSceneId: "scene-a",
} as unknown as TProject;

describe("duplicateProjectName", () => {
	it("appends 副本 and numbers further copies", () => {
		expect(
			duplicateProjectName({ name: "门的计划", existingNames: ["门的计划"] })
		).toBe("门的计划（副本）");
		expect(
			duplicateProjectName({
				name: "门的计划（副本）",
				existingNames: ["门的计划", "门的计划（副本）"],
			})
		).toBe("门的计划（副本 2）");
		expect(
			duplicateProjectName({
				name: "门的计划",
				existingNames: ["门的计划（副本）", "门的计划（副本 2）"],
			})
		).toBe("门的计划（副本 3）");
	});
});

describe("copyProjectContents", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		storage.copyProjectMedia.mockResolvedValue(3);
		storage.loadFolders.mockResolvedValue([{ id: "f1", name: "B-roll" }]);
		storage.loadTimeline.mockImplementation(
			async ({ sceneId }: { sceneId?: string }) =>
				sceneId === "scene-b" ? null : [{ id: `track-${sceneId ?? "legacy"}` }]
		);
		platformStorage.load.mockResolvedValue([{ id: "sticker-1" }]);
		Object.defineProperty(globalThis, "window", {
			value: {
				electronAPI: {
					projectFolder: {
						copyContents: vi.fn(async () => ({
							sourceRoot: "/Projects/src",
							targetRoot: "/Projects/dst",
							copiedMedia: true,
							copiedSettings: true,
						})),
					},
				},
			},
			configurable: true,
			writable: true,
		});
	});

	it("copies media (same ids, moved paths), folders, every scene timeline and stickers", async () => {
		const result = await copyProjectContents({
			source: project,
			targetProjectId: "dst",
		});

		expect(storage.copyProjectMedia).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceProjectId: "src",
				targetProjectId: "dst",
			})
		);
		const rewrite = storage.copyProjectMedia.mock.calls[0][0].rewriteLocalPath;
		expect(rewrite("/Projects/src/media/08.mp4")).toBe(
			"/Projects/dst/media/08.mp4"
		);
		expect(rewrite("/elsewhere/clip.mp4")).toBe("/elsewhere/clip.mp4");
		expect(rewrite("/Projects/src-archive/clip.mp4")).toBe(
			"/Projects/src-archive/clip.mp4"
		);

		expect(storage.saveFolders).toHaveBeenCalledWith("dst", [
			{ id: "f1", name: "B-roll" },
		]);
		expect(storage.saveTimeline.mock.calls.map((call) => call[0])).toEqual([
			{
				projectId: "dst",
				tracks: [{ id: "track-legacy" }],
				sceneId: undefined,
			},
			{
				projectId: "dst",
				tracks: [{ id: "track-scene-a" }],
				sceneId: "scene-a",
			},
		]);
		expect(platformStorage.save).toHaveBeenCalledWith("overlay-stickers-dst", [
			{ id: "sticker-1" },
		]);
		expect(result).toEqual({
			mediaItems: 3,
			timelines: 2,
			folders: 1,
			stickers: 1,
			diskCopied: true,
		});
	});

	it("moves Windows paths with their own separator", async () => {
		Object.defineProperty(globalThis, "window", {
			value: {
				electronAPI: {
					projectFolder: {
						copyContents: vi.fn(async () => ({
							sourceRoot: "C:\\Projects\\src",
							targetRoot: "C:\\Projects\\dst",
							copiedMedia: true,
							copiedSettings: true,
						})),
					},
				},
			},
			configurable: true,
			writable: true,
		});
		await copyProjectContents({ source: project, targetProjectId: "dst" });
		const rewrite = storage.copyProjectMedia.mock.calls[0][0].rewriteLocalPath;
		expect(rewrite("C:\\Projects\\src\\media\\08.mp4")).toBe(
			"C:\\Projects\\dst\\media\\08.mp4"
		);
		expect(rewrite("C:\\Projects\\src-archive\\08.mp4")).toBe(
			"C:\\Projects\\src-archive\\08.mp4"
		);
	});

	it("still copies the stored contents when there is no desktop folder to copy", async () => {
		Object.defineProperty(globalThis, "window", {
			value: {},
			configurable: true,
			writable: true,
		});
		const result = await copyProjectContents({
			source: project,
			targetProjectId: "dst",
		});
		const rewrite = storage.copyProjectMedia.mock.calls[0][0].rewriteLocalPath;
		expect(rewrite("/Projects/src/media/08.mp4")).toBe(
			"/Projects/src/media/08.mp4"
		);
		expect(result.diskCopied).toBe(false);
		expect(result.mediaItems).toBe(3);
	});
});
