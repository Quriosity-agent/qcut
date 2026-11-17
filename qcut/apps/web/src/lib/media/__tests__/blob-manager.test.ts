import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe("BlobManager", () => {
	let createObjectUrlMock: ReturnType<typeof vi.fn>;
	let revokeObjectUrlMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
		createObjectUrlMock = vi.fn(() => "blob:transition-preview");
		revokeObjectUrlMock = vi.fn();
		URL.createObjectURL = createObjectUrlMock as typeof URL.createObjectURL;
		URL.revokeObjectURL = revokeObjectUrlMock as typeof URL.revokeObjectURL;
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		URL.createObjectURL = originalCreateObjectURL;
		URL.revokeObjectURL = originalRevokeObjectURL;
	});

	it("keeps a cached URL alive when the next preview acquires it during grace", async () => {
		const { BLOB_RELEASE_GRACE_MS, blobManager } = await import(
			"../blob-manager"
		);
		const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
		const firstUrl = blobManager.getOrCreateObjectURL(file, "outgoing-preview");

		blobManager.releaseObjectURL(firstUrl, "outgoing-unmount");
		vi.advanceTimersByTime(BLOB_RELEASE_GRACE_MS / 2);
		const reusedUrl = blobManager.getOrCreateObjectURL(
			file,
			"incoming-preview"
		);
		vi.advanceTimersByTime(BLOB_RELEASE_GRACE_MS);

		expect(reusedUrl).toBe(firstUrl);
		expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
		expect(revokeObjectUrlMock).not.toHaveBeenCalled();

		blobManager.releaseObjectURL(reusedUrl, "incoming-unmount");
		vi.advanceTimersByTime(BLOB_RELEASE_GRACE_MS);
		expect(revokeObjectUrlMock).toHaveBeenCalledOnce();
		expect(revokeObjectUrlMock).toHaveBeenCalledWith(firstUrl);
	});

	/**
	 * A media file written over on disk and read again: same name, and here
	 * the same size too. The cached lookup goes by name and size, so it would
	 * hand the new file the old file's URL.
	 */
	it("gives a file that replaces another its own URL, and later lookups find it", async () => {
		let made = 0;
		createObjectUrlMock.mockImplementation(() => {
			made += 1;
			return `blob:media-${made}`;
		});
		const { BLOB_RELEASE_GRACE_MS, blobManager } = await import(
			"../blob-manager"
		);
		const before = new File(["red."], "shot.mp4", { type: "video/mp4" });
		const after = new File(["blue"], "shot.mp4", { type: "video/mp4" });
		expect(after.size).toBe(before.size);
		const oldUrl = blobManager.getOrCreateObjectURL(before, "media-item");
		// The trap this is for: the new file would be given the old picture.
		expect(blobManager.getOrCreateObjectURL(after, "probe")).toBe(oldUrl);
		blobManager.releaseObjectURL(oldUrl, "probe");

		const newUrl = blobManager.createReplacementObjectURL(after, "refresh");
		expect(newUrl).not.toBe(oldUrl);
		expect(blobManager.getOrCreateObjectURL(after, "preview")).toBe(newUrl);
		// Another object for the same file, as a reload hands out.
		const reread = new File(["blue"], "shot.mp4", { type: "video/mp4" });
		expect(blobManager.getOrCreateObjectURL(reread, "reload")).toBe(newUrl);

		// The old URL goes when its holder lets go, and takes nothing with it.
		blobManager.releaseObjectURL(oldUrl, "media-item-superseded");
		vi.advanceTimersByTime(BLOB_RELEASE_GRACE_MS);
		expect(revokeObjectUrlMock).toHaveBeenCalledWith(oldUrl);
		expect(revokeObjectUrlMock).not.toHaveBeenCalledWith(newUrl);
		const again = new File(["blue"], "shot.mp4", { type: "video/mp4" });
		expect(blobManager.getOrCreateObjectURL(again, "later")).toBe(newUrl);
	});

	it("still force-revokes temporary URLs immediately", async () => {
		const { blobManager } = await import("../blob-manager");
		const file = new File(["frame"], "frame.png", { type: "image/png" });
		const url = blobManager.createObjectURL(file, "temporary-frame");

		blobManager.revokeObjectURL(url, "temporary-frame-complete");

		expect(revokeObjectUrlMock).toHaveBeenCalledOnce();
		expect(revokeObjectUrlMock).toHaveBeenCalledWith(url);
	});
});
