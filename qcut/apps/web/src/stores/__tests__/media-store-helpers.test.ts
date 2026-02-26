import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	getFileType,
	cloneFileForTemporaryUse,
	getMediaAspectRatio,
	revokeMediaBlob,
	getImageDimensions,
	generateVideoThumbnailBrowser,
	getMediaDuration,
} from "../media/media-store-helpers";
import type { MediaItem } from "../media/media-store-types";

// Mock blob-manager
const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn(() => true);

vi.mock("@/lib/media/blob-manager", () => ({
	createObjectURL: (...args: unknown[]) => mockCreateObjectURL(...args),
	revokeObjectURL: (...args: unknown[]) => mockRevokeObjectURL(...args),
	getOrCreateObjectURL: vi.fn(() => "blob:mock-url"),
}));

describe("media-store-helpers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("revokeMediaBlob", () => {
		it("returns false for empty url", () => {
			expect(revokeMediaBlob("", "test")).toBe(false);
		});

		it("calls revokeObjectURL with scoped context", () => {
			revokeMediaBlob("blob:test-url", "thumbnail");
			expect(mockRevokeObjectURL).toHaveBeenCalledWith(
				"blob:test-url",
				"media-store:thumbnail"
			);
		});

		it("returns the result from revokeObjectURL", () => {
			mockRevokeObjectURL.mockReturnValueOnce(true);
			expect(revokeMediaBlob("blob:url", "ctx")).toBe(true);

			mockRevokeObjectURL.mockReturnValueOnce(false);
			expect(revokeMediaBlob("blob:url2", "ctx")).toBe(false);
		});
	});

	describe("getFileType", () => {
		it("returns 'image' for image MIME types", () => {
			expect(
				getFileType(new File([""], "photo.jpg", { type: "image/jpeg" }))
			).toBe("image");
			expect(
				getFileType(new File([""], "photo.png", { type: "image/png" }))
			).toBe("image");
			expect(
				getFileType(new File([""], "photo.webp", { type: "image/webp" }))
			).toBe("image");
		});

		it("returns 'video' for video MIME types", () => {
			expect(
				getFileType(new File([""], "clip.mp4", { type: "video/mp4" }))
			).toBe("video");
			expect(
				getFileType(new File([""], "clip.webm", { type: "video/webm" }))
			).toBe("video");
		});

		it("returns 'audio' for audio MIME types", () => {
			expect(
				getFileType(new File([""], "song.mp3", { type: "audio/mpeg" }))
			).toBe("audio");
			expect(
				getFileType(new File([""], "sound.wav", { type: "audio/wav" }))
			).toBe("audio");
		});

		it("returns null for unsupported MIME types", () => {
			expect(
				getFileType(new File([""], "doc.pdf", { type: "application/pdf" }))
			).toBeNull();
			expect(
				getFileType(new File([""], "data.json", { type: "application/json" }))
			).toBeNull();
			expect(
				getFileType(new File([""], "file.txt", { type: "text/plain" }))
			).toBeNull();
		});
	});

	describe("cloneFileForTemporaryUse", () => {
		it("creates a new File with same properties", () => {
			const original = new File(["hello"], "test.jpg", {
				type: "image/jpeg",
				lastModified: 1700000000000,
			});
			const clone = cloneFileForTemporaryUse(original);

			expect(clone).not.toBe(original);
			expect(clone.name).toBe(original.name);
			expect(clone.type).toBe(original.type);
			expect(clone.lastModified).toBe(original.lastModified);
			expect(clone.size).toBe(original.size);
		});

		it("preserves file content", async () => {
			const content = "file content here";
			const original = new File([content], "data.txt", {
				type: "text/plain",
			});
			const clone = cloneFileForTemporaryUse(original);

			const originalText = await original.text();
			const cloneText = await clone.text();
			expect(cloneText).toBe(originalText);
		});
	});

	describe("getMediaAspectRatio", () => {
		it("returns width/height when both are set", () => {
			const item = { width: 1920, height: 1080 } as MediaItem;
			expect(getMediaAspectRatio(item)).toBeCloseTo(16 / 9);
		});

		it("returns 16/9 default when width is missing", () => {
			const item = { height: 1080 } as MediaItem;
			expect(getMediaAspectRatio(item)).toBeCloseTo(16 / 9);
		});

		it("returns 16/9 default when height is missing", () => {
			const item = { width: 1920 } as MediaItem;
			expect(getMediaAspectRatio(item)).toBeCloseTo(16 / 9);
		});

		it("returns 16/9 default when both are missing", () => {
			const item = {} as MediaItem;
			expect(getMediaAspectRatio(item)).toBeCloseTo(16 / 9);
		});

		it("handles non-standard aspect ratios", () => {
			const item = { width: 1080, height: 1920 } as MediaItem;
			expect(getMediaAspectRatio(item)).toBeCloseTo(9 / 16);
		});

		it("handles square dimensions", () => {
			const item = { width: 500, height: 500 } as MediaItem;
			expect(getMediaAspectRatio(item)).toBe(1);
		});
	});

	describe("getImageDimensions", () => {
		let mockImg: Record<string, unknown>;
		let originalImage: typeof window.Image;

		beforeEach(() => {
			mockImg = {
				addEventListener: vi.fn(),
				remove: vi.fn(),
				src: "",
				naturalWidth: 1920,
				naturalHeight: 1080,
			};
			originalImage = window.Image;
			// Replace Image constructor with a factory that returns our mock
			(window as Record<string, unknown>).Image = (() =>
				mockImg) as unknown as typeof Image;
		});

		afterEach(() => {
			window.Image = originalImage;
		});

		it("resolves with image dimensions on load", async () => {
			const file = new File([""], "photo.jpg", { type: "image/jpeg" });

			const promise = getImageDimensions(file);

			// Simulate image load
			const loadHandler = (
				mockImg.addEventListener as ReturnType<typeof vi.fn>
			).mock.calls.find(
				(call: unknown[]) => call[0] === "load"
			)?.[1] as () => void;
			loadHandler();

			const result = await promise;
			expect(result).toEqual({ width: 1920, height: 1080 });
		});

		it("rejects on image error", async () => {
			const file = new File([""], "bad.jpg", { type: "image/jpeg" });

			const promise = getImageDimensions(file);

			const errorHandler = (
				mockImg.addEventListener as ReturnType<typeof vi.fn>
			).mock.calls.find(
				(call: unknown[]) => call[0] === "error"
			)?.[1] as () => void;
			errorHandler();

			await expect(promise).rejects.toThrow("Could not load image");
		});

		it("sets blob URL as image src", () => {
			const file = new File([""], "photo.jpg", { type: "image/jpeg" });
			getImageDimensions(file);

			expect(mockCreateObjectURL).toHaveBeenCalledWith(
				file,
				"getImageDimensions"
			);
			expect(mockImg.src).toBe("blob:mock-url");
		});
	});

	describe("generateVideoThumbnailBrowser", () => {
		let mockVideo: Record<string, unknown>;
		let mockCanvas: Record<string, unknown>;
		let mockCtx: Record<string, unknown>;

		beforeEach(() => {
			vi.useFakeTimers();

			mockCtx = {
				drawImage: vi.fn(),
			};
			mockCanvas = {
				width: 0,
				height: 0,
				getContext: vi.fn(() => mockCtx),
				toDataURL: vi.fn(() => "data:image/jpeg;base64,thumb"),
				remove: vi.fn(),
			};
			mockVideo = {
				addEventListener: vi.fn(),
				remove: vi.fn(),
				src: "",
				load: vi.fn(),
				videoWidth: 1280,
				videoHeight: 720,
				duration: 10,
				currentTime: 0,
				error: null,
			};

			vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
				if (tag === "video") return mockVideo as unknown as HTMLVideoElement;
				if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
				return document.createElement(tag);
			});
		});

		afterEach(() => {
			vi.useRealTimers();
			vi.restoreAllMocks();
		});

		it("resolves with thumbnail data on success", async () => {
			const file = new File([""], "video.mp4", { type: "video/mp4" });

			const promise = generateVideoThumbnailBrowser(file);

			// Trigger loadedmetadata
			const loadedHandler = (
				mockVideo.addEventListener as ReturnType<typeof vi.fn>
			).mock.calls.find(
				(call: unknown[]) => call[0] === "loadedmetadata"
			)?.[1] as () => void;
			loadedHandler();

			// Trigger seeked
			const seekedHandler = (
				mockVideo.addEventListener as ReturnType<typeof vi.fn>
			).mock.calls.find(
				(call: unknown[]) => call[0] === "seeked"
			)?.[1] as () => void;
			seekedHandler();

			const result = await promise;
			expect(result).toEqual({
				thumbnailUrl: "data:image/jpeg;base64,thumb",
				width: 1280,
				height: 720,
			});
		});

		it("rejects on video error", async () => {
			const file = new File([""], "bad.mp4", { type: "video/mp4" });

			const promise = generateVideoThumbnailBrowser(file);

			const errorHandler = (
				mockVideo.addEventListener as ReturnType<typeof vi.fn>
			).mock.calls.find(
				(call: unknown[]) => call[0] === "error"
			)?.[1] as () => void;
			errorHandler();

			await expect(promise).rejects.toThrow("Video loading failed");
		});

		it("rejects when canvas context is null", async () => {
			(mockCanvas.getContext as ReturnType<typeof vi.fn>).mockReturnValue(null);

			const file = new File([""], "video.mp4", { type: "video/mp4" });
			await expect(generateVideoThumbnailBrowser(file)).rejects.toThrow(
				"Could not get canvas context"
			);
		});

		it("rejects on timeout", async () => {
			const file = new File([""], "video.mp4", { type: "video/mp4" });

			const promise = generateVideoThumbnailBrowser(file);

			// Advance past 10s timeout
			vi.advanceTimersByTime(10_001);

			await expect(promise).rejects.toThrow(
				"Video thumbnail generation timed out"
			);
		});
	});

	describe("getMediaDuration", () => {
		let mockElement: Record<string, unknown>;

		beforeEach(() => {
			vi.useFakeTimers();

			mockElement = {
				addEventListener: vi.fn(),
				remove: vi.fn(),
				src: "",
				load: vi.fn(),
				duration: 30.5,
			};

			vi.spyOn(document, "createElement").mockImplementation(
				() => mockElement as unknown as HTMLMediaElement
			);
		});

		afterEach(() => {
			vi.useRealTimers();
			vi.restoreAllMocks();
		});

		it("resolves with duration on loadedmetadata", async () => {
			const file = new File([""], "video.mp4", { type: "video/mp4" });

			const promise = getMediaDuration(file);

			// Trigger loadedmetadata
			const loadedHandler = (
				mockElement.addEventListener as ReturnType<typeof vi.fn>
			).mock.calls.find(
				(call: unknown[]) => call[0] === "loadedmetadata"
			)?.[1] as () => void;
			loadedHandler();

			// Advance past the 50ms cleanup delay
			vi.advanceTimersByTime(100);

			const result = await promise;
			expect(result).toBe(30.5);
		});

		it("rejects on error", async () => {
			const file = new File([""], "bad.mp4", { type: "video/mp4" });

			const promise = getMediaDuration(file);

			const errorHandler = (
				mockElement.addEventListener as ReturnType<typeof vi.fn>
			).mock.calls.find(
				(call: unknown[]) => call[0] === "error"
			)?.[1] as () => void;
			errorHandler();

			await expect(promise).rejects.toThrow("Could not load media");
		});

		it("rejects on timeout", async () => {
			const file = new File([""], "video.mp4", { type: "video/mp4" });

			const promise = getMediaDuration(file);

			vi.advanceTimersByTime(10_001);

			await expect(promise).rejects.toThrow("Media loading timeout");
		});

		it("rejects for NaN duration", async () => {
			mockElement.duration = NaN;
			const file = new File([""], "video.mp4", { type: "video/mp4" });

			const promise = getMediaDuration(file);

			const loadedHandler = (
				mockElement.addEventListener as ReturnType<typeof vi.fn>
			).mock.calls.find(
				(call: unknown[]) => call[0] === "loadedmetadata"
			)?.[1] as () => void;
			loadedHandler();

			await expect(promise).rejects.toThrow("Invalid media duration");
		});

		it("rejects for zero duration", async () => {
			mockElement.duration = 0;
			const file = new File([""], "video.mp4", { type: "video/mp4" });

			const promise = getMediaDuration(file);

			const loadedHandler = (
				mockElement.addEventListener as ReturnType<typeof vi.fn>
			).mock.calls.find(
				(call: unknown[]) => call[0] === "loadedmetadata"
			)?.[1] as () => void;
			loadedHandler();

			await expect(promise).rejects.toThrow("Invalid media duration");
		});

		it("creates audio element for audio files", () => {
			const file = new File([""], "song.mp3", { type: "audio/mpeg" });
			getMediaDuration(file);

			expect(document.createElement).toHaveBeenCalledWith("audio");
		});

		it("creates video element for video files", () => {
			const file = new File([""], "clip.mp4", { type: "video/mp4" });
			getMediaDuration(file);

			expect(document.createElement).toHaveBeenCalledWith("video");
		});
	});
});
