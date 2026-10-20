import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvasPlaybackCache } from "../canvas-composition-playback-cache";

function installStorage() {
	const directories = new Map<string, Map<string, Blob>>();
	const locks = new Map<string, symbol>();
	const failures = {
		remove: new Set<string>(),
		create: false,
	};
	const parent = {
		async *entries() {
			for (const id of [...directories.keys()])
				yield [id, { kind: "directory" }] as const;
		},
		getDirectoryHandle: vi.fn(async (id: string) => {
			if (failures.create) throw new Error("Directory write failed");
			const files = directories.get(id) ?? new Map<string, Blob>();
			directories.set(id, files);
			return {
				getFileHandle: async (name: string) => ({
					getFile: async () => files.get(name)!,
					createWritable: async () => {
						let pending: Blob | undefined;
						return {
							write: async (blob: Blob) => {
								pending = blob;
							},
							close: async () => {
								if (pending) files.set(name, pending);
							},
							abort: async () => {},
						};
					},
				}),
				removeEntry: async (name: string) => {
					files.delete(name);
				},
			};
		}),
		removeEntry: vi.fn(async (id: string) => {
			if (failures.remove.has(id)) throw new Error("Directory removal failed");
			directories.delete(id);
		}),
	};
	const lockManager = {
		request: vi.fn(
			async <Result>(
				name: string,
				options: LockOptions,
				callback: (lock: Pick<Lock, "name" | "mode"> | null) => Promise<Result>
			) => {
				expect(options).toEqual({ mode: "exclusive", ifAvailable: true });
				if (locks.has(name)) return callback(null);
				const token = Symbol(name);
				locks.set(name, token);
				try {
					return await callback({ name, mode: "exclusive" });
				} finally {
					if (locks.get(name) === token) locks.delete(name);
				}
			}
		),
	};
	Object.defineProperty(navigator, "storage", {
		configurable: true,
		value: {
			getDirectory: async () => ({
				getDirectoryHandle: async () => parent,
			}),
		},
	});
	Object.defineProperty(navigator, "locks", {
		configurable: true,
		value: lockManager,
	});
	return { directories, locks, failures, parent, lockManager };
}

const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
afterEach(() => {
	if (originalStorage)
		Object.defineProperty(navigator, "storage", originalStorage);
	else Reflect.deleteProperty(navigator, "storage");
	if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
	else Reflect.deleteProperty(navigator, "locks");
});

function managedId() {
	return `v1-${crypto.randomUUID()}`;
}

describe("playback cache generation ownership", () => {
	it("reclaims inactive managed caches while preserving another window's active cache", async () => {
		const storage = installStorage();
		const abandoned = managedId();
		const legacy = crypto.randomUUID();
		storage.directories.set(abandoned, new Map());
		storage.directories.set(legacy, new Map());
		const first = await createCanvasPlaybackCache();
		const blob = new Blob(["first"], { type: "image/png" });
		const signal = new AbortController().signal;
		await first.write({ frame: 0, blob, signal });
		const second = await createCanvasPlaybackCache();
		expect(first.id).toMatch(/^v1-/);
		expect(storage.directories.has(abandoned)).toBe(false);
		expect(storage.directories.has(legacy)).toBe(true);
		expect(storage.directories.has(first.id)).toBe(true);
		expect(await first.read({ frame: 0, signal })).toBe(blob);
		expect(storage.parent.removeEntry).not.toHaveBeenCalledWith(
			first.id,
			expect.anything()
		);
		expect(second.cleanupWarnings).toContain(
			`Unmanaged preview cache retained: ${legacy}`
		);
		expect(storage.locks.size).toBe(2);
		await Promise.all([first.dispose(), second.dispose()]);
		expect(storage.locks.size).toBe(0);
	});

	it("reclaims a renderer-crash orphan once the browser has released its ownership lock", async () => {
		const storage = installStorage();
		const crashed = await createCanvasPlaybackCache();
		await crashed.write({
			frame: 0,
			blob: new Blob(["pixels"], { type: "image/png" }),
			signal: new AbortController().signal,
		});
		// Browser-held locks disappear with their renderer; persisted OPFS files remain.
		storage.locks.clear();
		const recovered = await createCanvasPlaybackCache();
		expect(storage.directories.has(crashed.id)).toBe(false);
		expect(storage.parent.removeEntry).toHaveBeenCalledWith(crashed.id, {
			recursive: true,
		});
		expect(storage.directories.has(recovered.id)).toBe(true);
		await recovered.dispose();
	});

	it("retains evidence of failed cleanup and allows the next generation to reclaim it", async () => {
		const storage = installStorage();
		const failed = await createCanvasPlaybackCache();
		const blob = new Blob(["pixels"], { type: "image/png" });
		await failed.write({
			frame: 0,
			blob,
			signal: new AbortController().signal,
		});
		storage.failures.remove.add(failed.id);
		const disposal = failed.dispose();
		await expect(disposal).rejects.toThrow("Unable to remove");
		expect(failed.dispose()).toBe(disposal);
		expect(failed.cleanupError?.cause).toBeInstanceOf(Error);
		expect(failed.bytes).toBe(blob.size);
		expect(failed.frameCount).toBe(1);
		expect(storage.directories.has(failed.id)).toBe(true);
		expect(storage.locks.size).toBe(0);
		storage.failures.remove.clear();
		const recovered = await createCanvasPlaybackCache();
		expect(storage.directories.has(failed.id)).toBe(false);
		await recovered.dispose();
	});

	it("never sweeps unowned generations when Web Locks are unavailable", async () => {
		const storage = installStorage();
		const previous = managedId();
		storage.directories.set(previous, new Map());
		Object.defineProperty(navigator, "locks", {
			configurable: true,
			value: undefined,
		});
		const fallback = await createCanvasPlaybackCache();
		expect(fallback.id).toMatch(/^unmanaged-/);
		expect(fallback.cleanupWarnings).toEqual([
			"Web Locks unavailable; crash cache reclamation disabled",
		]);
		expect(storage.directories.has(previous)).toBe(true);
		expect(storage.parent.removeEntry).not.toHaveBeenCalled();
		Object.defineProperty(navigator, "locks", {
			configurable: true,
			value: storage.lockManager,
		});
		const managed = await createCanvasPlaybackCache();
		expect(storage.directories.has(previous)).toBe(false);
		expect(storage.directories.has(fallback.id)).toBe(true);
		await Promise.all([fallback.dispose(), managed.dispose()]);
	});

	it("releases ownership if directory creation fails", async () => {
		const storage = installStorage();
		storage.failures.create = true;
		await expect(createCanvasPlaybackCache()).rejects.toThrow(
			"Directory write failed"
		);
		expect(storage.locks.size).toBe(0);
		expect(storage.directories.size).toBe(0);
	});

	it("reports reclamation failure before allocating another generation", async () => {
		const storage = installStorage();
		const abandoned = managedId();
		storage.directories.set(abandoned, new Map());
		storage.failures.remove.add(abandoned);
		await expect(createCanvasPlaybackCache()).rejects.toThrow(
			"Unable to reclaim"
		);
		expect(storage.parent.getDirectoryHandle).not.toHaveBeenCalled();
		expect(storage.locks.size).toBe(0);
		expect(storage.directories.size).toBe(1);
	});
});
