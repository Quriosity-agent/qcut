import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CANVAS_PLAYBACK_CACHE_DIRECTORY,
	CANVAS_PLAYBACK_CACHE_MAX_BYTES,
	createCanvasPlaybackCache,
} from "../canvas-composition-playback-cache";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function installStorage() {
	const files = new Map<string, Blob>();
	const writes = {
		wait: undefined as Promise<void> | undefined,
		error: undefined as Error | undefined,
	};
	const abort = vi.fn(async () => {});
	const write = vi.fn(async () => {
		await writes.wait;
		if (writes.error) throw writes.error;
	});
	const directory = {
		getFileHandle: vi.fn(
			async (name: string, options?: { create?: boolean }) => {
				if (!options?.create && !files.has(name))
					throw new DOMException("Missing frame", "NotFoundError");
				return {
					getFile: vi.fn(async () => files.get(name)!),
					createWritable: vi.fn(async () => {
						let pending: Blob | undefined;
						return {
							write: async (blob: Blob) => {
								pending = blob;
								await write();
							},
							close: vi.fn(async () => {
								if (pending) files.set(name, pending);
							}),
							abort,
						};
					}),
				};
			}
		),
		removeEntry: vi.fn(async (name: string) => {
			files.delete(name);
		}),
	};
	const parent = {
		getDirectoryHandle: vi.fn(async () => directory),
		removeEntry: vi.fn(async () => files.clear()),
	};
	const root = {
		getDirectoryHandle: vi.fn(async () => parent),
	};
	Object.defineProperty(navigator, "storage", {
		configurable: true,
		value: { getDirectory: vi.fn(async () => root) },
	});
	return { files, writes, write, abort, directory, parent, root };
}

const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
afterEach(() => {
	if (originalStorage)
		Object.defineProperty(navigator, "storage", originalStorage);
	else Reflect.deleteProperty(navigator, "storage");
});

function png({ value = "pixels" }: { value?: string } = {}) {
	return new Blob([value], { type: "image/png" });
}

describe("composition playback disk cache", () => {
	it("stores only generation-owned PNG files and exposes committed byte counts", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache();
		const blob = png();
		const signal = new AbortController().signal;
		expect(cache.has({ frame: 0 })).toBe(false);
		await cache.write({ frame: 0, blob, signal });
		await cache.write({ frame: 1, blob, signal });
		expect(cache.has({ frame: 0 })).toBe(true);
		expect(cache.maxBytes).toBe(CANVAS_PLAYBACK_CACHE_MAX_BYTES);
		expect(cache.bytes).toBe(blob.size * 2);
		expect(cache.frameCount).toBe(2);
		expect(await cache.read({ frame: 1, signal })).toBe(blob);
		expect(storage.root.getDirectoryHandle).toHaveBeenCalledWith(
			CANVAS_PLAYBACK_CACHE_DIRECTORY,
			{ create: true }
		);
		expect(storage.parent.getDirectoryHandle).toHaveBeenCalledWith(cache.id, {
			create: true,
		});
		expect(CANVAS_PLAYBACK_CACHE_MAX_BYTES).toBe(2 * 1024 ** 3);
		await cache.dispose();
		expect(storage.parent.removeEntry).toHaveBeenCalledWith(cache.id, {
			recursive: true,
		});
		expect(cache.bytes).toBe(0);
		expect(cache.frameCount).toBe(0);
		expect(cache.has({ frame: 0 })).toBe(false);
	});

	it("rejects the byte limit before creating another frame", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache({ maxBytes: 6 });
		const signal = new AbortController().signal;
		await cache.write({ frame: 0, blob: png(), signal });
		await expect(
			cache.write({ frame: 1, blob: png(), signal })
		).rejects.toThrow("disk cache limit");
		expect(storage.directory.getFileHandle).toHaveBeenCalledTimes(1);
		expect(cache.bytes).toBe(6);
		await cache.dispose();
	});

	it("rejects a single oversized frame before allocating a file", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache({ maxBytes: 5 });
		const signal = new AbortController().signal;
		expect(cache.maxBytes).toBe(5);
		await expect(
			cache.write({ frame: 0, blob: png(), signal })
		).rejects.toThrow("frame exceeds its disk cache limit");
		expect(storage.directory.getFileHandle).not.toHaveBeenCalled();
		expect(cache.bytes).toBe(0);
		expect(cache.has({ frame: 0 })).toBe(false);
		await cache.dispose();
	});

	it("reuses only deleted frame bytes while retaining exact surviving PNGs", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache({ maxBytes: 12 });
		const signal = new AbortController().signal;
		const first = png();
		const second = png({ value: "second" });
		await cache.write({ frame: 0, blob: first, signal });
		await cache.write({ frame: 1, blob: second, signal });
		await cache.remove({ frames: [0, 0, 99], signal });
		expect(storage.directory.removeEntry).toHaveBeenCalledTimes(1);
		expect(cache.bytes).toBe(second.size);
		expect(cache.frameCount).toBe(1);
		expect(cache.has({ frame: 0 })).toBe(false);
		expect(cache.has({ frame: 1 })).toBe(true);
		expect(await cache.read({ frame: 1, signal })).toBe(second);
		await expect(cache.read({ frame: 0, signal })).rejects.toThrow(
			"not prepared"
		);
		await cache.write({ frame: 2, blob: first, signal });
		await cache.remove({ frames: [2], signal });
		await cache.write({ frame: 0, blob: first, signal });
		expect(cache.bytes).toBe(12);
		expect(cache.frameCount).toBe(2);
		expect(await cache.read({ frame: 0, signal })).toBe(first);
		await cache.dispose();
	});

	it("retains the failed frame's budget after a partial removal and allows retry", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache({ maxBytes: 12 });
		const signal = new AbortController().signal;
		await cache.write({ frame: 0, blob: png(), signal });
		await cache.write({ frame: 1, blob: png(), signal });
		const failure = new DOMException(
			"File locked",
			"NoModificationAllowedError"
		);
		storage.directory.removeEntry
			.mockImplementationOnce(async (name) => {
				storage.files.delete(name);
			})
			.mockRejectedValueOnce(failure);
		await expect(
			cache.remove({ frames: [0, 1], signal })
		).rejects.toMatchObject({
			message: "Unable to remove effect playback frame 1",
			cause: failure,
		});
		expect(cache.bytes).toBe(6);
		expect(cache.frameCount).toBe(1);
		expect(cache.has({ frame: 0 })).toBe(false);
		expect(cache.has({ frame: 1 })).toBe(true);
		expect(storage.files.has("1.png")).toBe(true);
		await expect(
			cache.write({ frame: 2, blob: png({ value: "1234567" }), signal })
		).rejects.toThrow("disk cache limit");
		await cache.remove({ frames: [1], signal });
		await cache.write({ frame: 2, blob: png({ value: "1234567" }), signal });
		expect(cache.bytes).toBe(7);
		await cache.dispose();
	});

	it("reclaims metadata for a frame already absent from OPFS", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache({ maxBytes: 6 });
		const signal = new AbortController().signal;
		await cache.write({ frame: 0, blob: png(), signal });
		storage.files.clear();
		storage.directory.removeEntry.mockRejectedValueOnce(
			new DOMException("Already removed", "NotFoundError")
		);
		await cache.remove({ frames: [0], signal });
		expect(cache.bytes).toBe(0);
		expect(cache.frameCount).toBe(0);
		expect(cache.has({ frame: 0 })).toBe(false);
		await cache.write({ frame: 1, blob: png(), signal });
		expect(cache.bytes).toBe(6);
		await cache.dispose();
	});

	it("serializes rolling removals with writes and reads in request order", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache({ maxBytes: 6 });
		const signal = new AbortController().signal;
		const waiting = deferred();
		storage.writes.wait = waiting.promise;
		const blob = png();
		const written = cache.write({ frame: 0, blob, signal });
		const readBeforeRemoval = cache.read({ frame: 0, signal });
		const removed = cache.remove({ frames: [0], signal });
		const readAfterRemoval = expect(
			cache.read({ frame: 0, signal })
		).rejects.toThrow("not prepared");
		const replacement = cache.write({ frame: 1, blob, signal });
		await vi.waitFor(() => expect(storage.write).toHaveBeenCalledOnce());
		expect(cache.has({ frame: 0 })).toBe(false);
		expect(storage.directory.removeEntry).not.toHaveBeenCalled();
		waiting.resolve();
		await written;
		expect(await readBeforeRemoval).toBe(blob);
		await Promise.all([removed, readAfterRemoval, replacement]);
		expect(cache.has({ frame: 0 })).toBe(false);
		expect(cache.has({ frame: 1 })).toBe(true);
		expect(cache.bytes).toBe(6);
		await cache.dispose();
	});

	it("rejects a cancelled queued removal without deleting its frames", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache();
		const waiting = deferred();
		storage.writes.wait = waiting.promise;
		const signal = new AbortController().signal;
		const written = cache.write({ frame: 0, blob: png(), signal });
		const controller = new AbortController();
		const rejected = expect(
			cache.remove({ frames: [0], signal: controller.signal })
		).rejects.toMatchObject({ name: "AbortError" });
		controller.abort();
		waiting.resolve();
		await Promise.all([written, rejected]);
		expect(storage.directory.removeEntry).not.toHaveBeenCalled();
		expect(cache.has({ frame: 0 })).toBe(true);
		expect(cache.bytes).toBe(6);
		await cache.dispose();
	});

	it("accounts for deletion completed during cancellation and retains subsequent frames", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache();
		const signal = new AbortController().signal;
		await cache.write({ frame: 0, blob: png(), signal });
		await cache.write({ frame: 1, blob: png(), signal });
		const waiting = deferred();
		storage.directory.removeEntry.mockImplementationOnce(async (name) => {
			await waiting.promise;
			storage.files.delete(name);
		});
		const controller = new AbortController();
		const rejected = expect(
			cache.remove({ frames: [0, 1], signal: controller.signal })
		).rejects.toMatchObject({ name: "AbortError" });
		await vi.waitFor(() =>
			expect(storage.directory.removeEntry).toHaveBeenCalledOnce()
		);
		expect(cache.bytes).toBe(12);
		expect(cache.has({ frame: 0 })).toBe(true);
		controller.abort();
		waiting.resolve();
		await rejected;
		expect(cache.bytes).toBe(6);
		expect(cache.has({ frame: 0 })).toBe(false);
		expect(cache.has({ frame: 1 })).toBe(true);
		expect(storage.files.has("1.png")).toBe(true);
		await cache.dispose();
	});

	it("waits for pending removals before disposing and rejects later writes", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache();
		const signal = new AbortController().signal;
		await cache.write({ frame: 0, blob: png(), signal });
		const waiting = deferred();
		storage.directory.removeEntry.mockImplementationOnce(async (name) => {
			await waiting.promise;
			storage.files.delete(name);
		});
		const rejectedRemoval = expect(
			cache.remove({ frames: [0], signal })
		).rejects.toThrow("disposed");
		const rejectedWrite = expect(
			cache.write({ frame: 1, blob: png(), signal })
		).rejects.toThrow("disposed");
		await vi.waitFor(() =>
			expect(storage.directory.removeEntry).toHaveBeenCalledOnce()
		);
		const disposal = cache.dispose();
		expect(cache.has({ frame: 0 })).toBe(false);
		expect(storage.parent.removeEntry).not.toHaveBeenCalled();
		waiting.resolve();
		await Promise.all([rejectedRemoval, rejectedWrite, disposal]);
		expect(storage.parent.removeEntry).toHaveBeenCalledOnce();
		expect(cache.bytes).toBe(0);
		await expect(cache.remove({ frames: [], signal })).rejects.toThrow(
			"disposed"
		);
	});

	it("validates the whole removal batch before deleting any frame", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache();
		const signal = new AbortController().signal;
		await cache.write({ frame: 0, blob: png(), signal });
		await expect(cache.remove({ frames: [0, -1], signal })).rejects.toThrow(
			"Invalid composition playback frame"
		);
		expect(storage.directory.removeEntry).not.toHaveBeenCalled();
		expect(cache.has({ frame: 0 })).toBe(true);
		expect(cache.bytes).toBe(6);
		await cache.dispose();
	});

	it("removes a quota-failed frame without publishing it or damaging earlier frames", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache();
		const signal = new AbortController().signal;
		const blob = png();
		await cache.write({ frame: 0, blob, signal });
		storage.writes.error = new DOMException(
			"Storage full",
			"QuotaExceededError"
		);
		await expect(cache.write({ frame: 1, blob, signal })).rejects.toMatchObject(
			{
				name: "QuotaExceededError",
			}
		);
		expect(storage.abort).toHaveBeenCalledOnce();
		expect(storage.directory.removeEntry).toHaveBeenCalledWith("1.png");
		expect(cache.frameCount).toBe(1);
		expect(await cache.read({ frame: 0, signal })).toBe(blob);
		await expect(cache.read({ frame: 1, signal })).rejects.toThrow(
			"not prepared"
		);
		await cache.dispose();
	});

	it("cancels an in-flight write before publication and drains disposal once", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache();
		const waiting = deferred();
		storage.writes.wait = waiting.promise;
		const controller = new AbortController();
		const operation = cache.write({
			frame: 0,
			blob: png(),
			signal: controller.signal,
		});
		const rejected = expect(operation).rejects.toMatchObject({
			name: "AbortError",
		});
		await vi.waitFor(() => expect(storage.write).toHaveBeenCalledOnce());
		controller.abort();
		const disposal = cache.dispose();
		expect(cache.dispose()).toBe(disposal);
		expect(storage.parent.removeEntry).not.toHaveBeenCalled();
		waiting.resolve();
		await rejected;
		await disposal;
		expect(storage.abort).toHaveBeenCalledOnce();
		expect(storage.parent.removeEntry).toHaveBeenCalledOnce();
		expect(cache.frameCount).toBe(0);
	});

	it("serializes reads behind writes and refuses queued operations after disposal", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache();
		const waiting = deferred();
		storage.writes.wait = waiting.promise;
		const signal = new AbortController().signal;
		const written = cache.write({ frame: 0, blob: png(), signal });
		const writeRejected = expect(written).rejects.toThrow("disposed");
		const read = cache.read({ frame: 0, signal });
		const readRejected = expect(read).rejects.toThrow("disposed");
		await vi.waitFor(() => expect(storage.write).toHaveBeenCalledOnce());
		const disposed = cache.dispose();
		waiting.resolve();
		await Promise.all([writeRejected, readRejected, disposed]);
		expect(storage.directory.getFileHandle).toHaveBeenCalledTimes(1);
		await expect(cache.read({ frame: 0, signal })).rejects.toThrow("disposed");
	});

	it("rejects aborted reads, duplicate frames and invalid input without touching files", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache();
		const signal = new AbortController().signal;
		await cache.write({ frame: 0, blob: png(), signal });
		await expect(
			cache.write({ frame: 0, blob: png(), signal })
		).rejects.toThrow("already written");
		await expect(
			cache.write({ frame: -1, blob: png(), signal })
		).rejects.toThrow("Invalid");
		await expect(
			cache.write({ frame: 1, blob: new Blob([]), signal })
		).rejects.toThrow("PNG");
		const cancelled = new AbortController();
		cancelled.abort();
		await expect(
			cache.read({ frame: 0, signal: cancelled.signal })
		).rejects.toMatchObject({ name: "AbortError" });
		expect(storage.directory.getFileHandle).toHaveBeenCalledTimes(1);
		await cache.dispose();
	});

	it("rejects a truncated stored frame", async () => {
		const storage = installStorage();
		const cache = await createCanvasPlaybackCache();
		const signal = new AbortController().signal;
		await cache.write({ frame: 0, blob: png(), signal });
		storage.files.set("0.png", png({ value: "x" }));
		await expect(cache.read({ frame: 0, signal })).rejects.toThrow(
			"incomplete"
		);
		await cache.dispose();
	});

	it("uses a distinct directory for each generation and tolerates missing cleanup", async () => {
		const storage = installStorage();
		const first = await createCanvasPlaybackCache();
		const second = await createCanvasPlaybackCache();
		expect(first.id).not.toBe(second.id);
		storage.parent.removeEntry.mockRejectedValueOnce(
			new DOMException("Already removed", "NotFoundError")
		);
		await first.dispose();
		await second.dispose();
		expect(storage.parent.removeEntry).toHaveBeenCalledTimes(2);
	});
});
