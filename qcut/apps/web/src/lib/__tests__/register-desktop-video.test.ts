import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";
import { registerDesktopVideo } from "../media/register-desktop-video";

const mocks = vi.hoisted(() => ({
	isElectron: true,
	info: vi.fn(),
	importMedia: vi.fn(),
}));

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({
		isElectron: mocks.isElectron,
		claude: { media: { info: mocks.info } },
		mediaImport: { import: mocks.importMedia },
	}),
}));

const item: MediaItem = {
	id: "stable-video-id",
	name: "talk.mp4",
	type: "video",
	file: new File(["video"], "talk.mp4", { type: "video/mp4" }),
	localPath: "/tmp/talk.mp4",
	url: "blob:preview",
};

beforeEach(() => {
	mocks.isElectron = true;
	mocks.info.mockReset().mockResolvedValue(null);
	mocks.importMedia.mockReset().mockResolvedValue({
		success: true,
		targetPath: "/project/media/imported/stable-video-id.mp4",
	});
});

describe("desktop video registration", () => {
	it("copies the temporary video under the same project/media identity", async () => {
		const result = await registerDesktopVideo({
			projectId: "project",
			mediaItem: item,
		});
		expect(mocks.info).toHaveBeenCalledWith("project", item.id);
		expect(mocks.importMedia).toHaveBeenCalledWith({
			projectId: "project",
			mediaId: item.id,
			sourcePath: item.localPath,
			preferSymlink: false,
		});
		expect(result).toEqual({
			...item,
			localPath: "/project/media/imported/stable-video-id.mp4",
			isLocalFile: true,
		});
		expect(item.localPath).toBe("/tmp/talk.mp4");
	});

	it("waits for registration before exposing a successful result", async () => {
		let finish!: (value: { success: boolean; targetPath: string }) => void;
		mocks.importMedia.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		let settled = false;
		const pending = registerDesktopVideo({
			projectId: "project",
			mediaItem: item,
		}).then((value) => {
			settled = true;
			return value;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		finish({ success: true, targetPath: "/project/copy.mp4" });
		await expect(pending).resolves.toMatchObject({
			localPath: "/project/copy.mp4",
		});
	});

	it("does not reimport an already registered target onto itself", async () => {
		mocks.info.mockResolvedValue({ path: item.localPath });
		await expect(
			registerDesktopVideo({ projectId: "project", mediaItem: item })
		).resolves.toBe(item);
		expect(mocks.importMedia).not.toHaveBeenCalled();
	});

	it("queries the current project and preserves non-ASCII source paths", async () => {
		const localPath = "/tmp/中文 口播.mp4";
		await registerDesktopVideo({
			projectId: "second-project",
			mediaItem: { ...item, localPath },
		});
		expect(mocks.info).toHaveBeenCalledWith("second-project", item.id);
		expect(mocks.importMedia).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "second-project",
				mediaId: item.id,
				sourcePath: localPath,
			})
		);
	});

	it.each([
		{ success: false, error: "Source file missing" },
		{ success: true, targetPath: "" },
	])("rejects incomplete imports %j", async (result) => {
		mocks.importMedia.mockResolvedValue(result);
		await expect(
			registerDesktopVideo({ projectId: "project", mediaItem: item })
		).rejects.toThrow();
	});

	it("propagates IPC failures without pretending the video is registered", async () => {
		mocks.importMedia.mockRejectedValue(new Error("Permission denied"));
		await expect(
			registerDesktopVideo({ projectId: "project", mediaItem: item })
		).rejects.toThrow("Permission denied");
	});

	it("leaves web imports alone", async () => {
		mocks.isElectron = false;
		await expect(
			registerDesktopVideo({ projectId: "project", mediaItem: item })
		).resolves.toBe(item);
		expect(mocks.info).not.toHaveBeenCalled();
		expect(mocks.importMedia).not.toHaveBeenCalled();
	});

	it.each([
		{ ...item, type: "image" as const },
		{ ...item, localPath: undefined },
	])("preserves imports outside the local-video path", async (mediaItem) => {
		await expect(
			registerDesktopVideo({ projectId: "project", mediaItem })
		).resolves.toBe(mediaItem);
		expect(mocks.importMedia).not.toHaveBeenCalled();
	});
});
