import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaStore } from "../media-store";
import {
	generateVideoThumbnailBrowser,
	getMediaDuration,
} from "../media-store-helpers";

vi.mock("@/lib/storage/storage-service", () => ({
	storageService: {
		saveMediaItem: vi.fn(async () => {}),
	},
}));

vi.mock("../media-store-helpers", () => ({
	revokeMediaBlob: vi.fn(),
	cloneFileForTemporaryUse: vi.fn((file: File) => file),
	generateVideoThumbnailBrowser: vi.fn(),
	getMediaDuration: vi.fn(),
	getFileType: vi.fn(() => "video"),
	getImageDimensions: vi.fn(),
	getMediaAspectRatio: vi.fn(),
}));

vi.mock("@/lib/media/alpha-playback-proxy", () => ({
	recordMediaAlpha: vi.fn(async () => null),
	forgetMediaAlphaInspection: vi.fn(),
}));

vi.mock("@/lib/media/blob-manager", () => ({
	getOrCreateObjectURL: vi.fn(() => "blob:mock"),
}));

vi.mock("@/lib/debug/debug-config", () => ({
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
	debugError: vi.fn(),
}));

vi.mock("@/lib/debug/error-handler", () => ({
	handleStorageError: vi.fn(),
	handleMediaProcessingError: vi.fn(),
}));

/** A measurement the test finishes when it chooses to. */
function pending<Value>(): {
	promise: Promise<Value>;
	finish: (value: Value) => void;
} {
	let finish: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>((resolve) => {
		finish = resolve;
	});
	return { promise, finish };
}

const itemOf = (id: string) =>
	useMediaStore.getState().mediaItems.find((item) => item.id === id);

/**
 * An item keeps its id when its file is written over in the project folder
 * and read again. The thumbnail and length of the old file were still being
 * measured then, and landed on the item by id: a clip of the new file was
 * laid out with the old file's length.
 */
describe("what was measured from a file the item no longer has", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useMediaStore.setState({ mediaItems: [] });
	});

	it("does not land on a video that was given another file meanwhile", async () => {
		const oldFile = new File(["old"], "shake.mp4", { type: "video/mp4" });
		const newFile = new File(["newer"], "shake.mp4", { type: "video/mp4" });
		const oldThumbnail = pending<{
			thumbnailUrl: string;
			width: number;
			height: number;
		}>();
		vi.mocked(generateVideoThumbnailBrowser)
			.mockImplementationOnce(() => oldThumbnail.promise)
			.mockImplementation(async () => ({
				thumbnailUrl: "data:new",
				width: 1920,
				height: 1080,
			}));
		vi.mocked(getMediaDuration)
			.mockImplementationOnce(async () => 4)
			.mockImplementation(async () => 9);

		const id = await useMediaStore.getState().addMediaItem("proj-1", {
			name: "shake.mp4",
			type: "video",
			file: oldFile,
			url: "blob:old",
		});
		// The file is written over and read again while the old one is measured.
		await useMediaStore.getState().updateMediaItem("proj-1", id, {
			file: newFile,
			url: "blob:new",
			thumbnailUrl: undefined,
			duration: undefined,
		});
		await vi.waitFor(() => {
			expect(itemOf(id)).toMatchObject({
				thumbnailUrl: "data:new",
				duration: 9,
			});
		});

		oldThumbnail.finish({ thumbnailUrl: "data:old", width: 640, height: 360 });
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(itemOf(id)).toMatchObject({
			file: newFile,
			thumbnailUrl: "data:new",
			width: 1920,
			height: 1080,
			duration: 9,
		});
	});

	it("does not mark the item failed for its old file's failure", async () => {
		const oldFile = new File(["old"], "shake.mp4", { type: "video/mp4" });
		const newFile = new File(["newer"], "shake.mp4", { type: "video/mp4" });
		const oldThumbnail = pending<never>();
		let failOld: (error: Error) => void = () => undefined;
		vi.mocked(generateVideoThumbnailBrowser)
			.mockImplementationOnce(
				() =>
					new Promise((_resolve, reject) => {
						failOld = reject;
						void oldThumbnail;
					})
			)
			.mockImplementation(async () => ({
				thumbnailUrl: "data:new",
				width: 1920,
				height: 1080,
			}));
		vi.mocked(getMediaDuration).mockImplementation(async () => 9);

		const id = await useMediaStore.getState().addMediaItem("proj-1", {
			name: "shake.mp4",
			type: "video",
			file: oldFile,
			url: "blob:old",
		});
		await useMediaStore.getState().updateMediaItem("proj-1", id, {
			file: newFile,
			url: "blob:new",
			thumbnailUrl: undefined,
		});
		await vi.waitFor(() => {
			expect(itemOf(id)?.thumbnailStatus).toBe("ready");
		});

		failOld(new Error("the old file is gone"));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(itemOf(id)).toMatchObject({
			thumbnailStatus: "ready",
			thumbnailUrl: "data:new",
		});
		// Not tried again either: three calls would be a retry of the old file.
		expect(generateVideoThumbnailBrowser).toHaveBeenCalledTimes(2);
	});

	/**
	 * A thumbnail that fails is tried again after a pause. An item given
	 * another file during that pause was set back to "loading" by the old
	 * file's second try, and stayed there: what that try measured is dropped.
	 */
	it("does not try the old file again once the item has another", async () => {
		const oldFile = new File(["old"], "shake.mp4", { type: "video/mp4" });
		const newFile = new File(["newer"], "shake.mp4", { type: "video/mp4" });
		vi.mocked(generateVideoThumbnailBrowser)
			.mockImplementationOnce(async () => {
				throw new Error("the decoder was busy");
			})
			.mockImplementation(async () => ({
				thumbnailUrl: "data:new",
				width: 1920,
				height: 1080,
			}));
		vi.mocked(getMediaDuration).mockImplementation(async () => 9);

		const id = await useMediaStore.getState().addMediaItem("proj-1", {
			name: "shake.mp4",
			type: "video",
			file: oldFile,
			url: "blob:old",
		});
		// The first try has failed and waits; the file is written over.
		await vi.waitFor(() => {
			expect(generateVideoThumbnailBrowser).toHaveBeenCalledTimes(1);
		});
		await useMediaStore.getState().updateMediaItem("proj-1", id, {
			file: newFile,
			url: "blob:new",
			thumbnailUrl: undefined,
		});
		await vi.waitFor(() => {
			expect(itemOf(id)?.thumbnailStatus).toBe("ready");
		});

		// Past the pause before the second try.
		await new Promise((resolve) => setTimeout(resolve, 450));
		expect(itemOf(id)).toMatchObject({
			thumbnailStatus: "ready",
			thumbnailUrl: "data:new",
		});
		expect(generateVideoThumbnailBrowser).toHaveBeenCalledTimes(2);
	});

	it("does not land on a sound that was given another file meanwhile", async () => {
		const oldFile = new File(["old"], "hit.wav", { type: "audio/wav" });
		const newFile = new File(["newer"], "hit.wav", { type: "audio/wav" });
		const oldLength = pending<number>();
		vi.mocked(getMediaDuration)
			.mockImplementationOnce(() => oldLength.promise)
			.mockImplementation(async () => 2.5);

		const id = await useMediaStore.getState().addMediaItem("proj-1", {
			name: "hit.wav",
			type: "audio",
			file: oldFile,
			url: "blob:old",
		});
		await useMediaStore.getState().updateMediaItem("proj-1", id, {
			file: newFile,
			url: "blob:new",
			duration: undefined,
		});
		await vi.waitFor(() => {
			expect(itemOf(id)?.duration).toBe(2.5);
		});

		oldLength.finish(7);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(itemOf(id)).toMatchObject({ file: newFile, duration: 2.5 });
	});
});
