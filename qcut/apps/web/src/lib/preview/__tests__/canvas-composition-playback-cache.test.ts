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
		await cache.write({ frame: 0, blob, signal });
		await cache.write({ frame: 1, blob, signal });
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
