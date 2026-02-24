import { describe, it, expect, vi, beforeEach } from "vitest";
import { FilmstripCache } from "../filmstrip-cache";

// Mock URL.revokeObjectURL
const revokeObjectURL = vi.fn();
vi.stubGlobal("URL", { ...globalThis.URL, revokeObjectURL });

describe("FilmstripCache", () => {
	let cache: FilmstripCache;

	beforeEach(() => {
		cache = new FilmstripCache(5);
		revokeObjectURL.mockClear();
	});

	it("stores and retrieves entries", () => {
		cache.set("video1", 1.5, "blob:frame1");
		expect(cache.get("video1", 1.5)).toBe("blob:frame1");
	});

	it("returns null for missing entries", () => {
		expect(cache.get("video1", 1.5)).toBeNull();
	});

	it("tracks cache size", () => {
		cache.set("v1", 0, "blob:a");
		cache.set("v1", 1, "blob:b");
		expect(cache.size).toBe(2);
	});

	it("revokes old URL when overwriting same key", () => {
		cache.set("v1", 1.0, "blob:old");
		cache.set("v1", 1.0, "blob:new");
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:old");
		expect(cache.get("v1", 1.0)).toBe("blob:new");
	});

	it("does not revoke URL when setting same value", () => {
		cache.set("v1", 1.0, "blob:same");
		cache.set("v1", 1.0, "blob:same");
		expect(revokeObjectURL).not.toHaveBeenCalled();
	});

	it("evicts oldest entries when exceeding max size", () => {
		// Fill cache to max (5)
		for (let i = 0; i < 5; i++) {
			cache.set("v1", i, `blob:${i}`);
		}
		expect(cache.size).toBe(5);

		// Add one more — should trigger eviction of ~20% (1 entry)
		cache.set("v1", 5, "blob:5");
		expect(cache.size).toBeLessThanOrEqual(5);
		expect(revokeObjectURL).toHaveBeenCalled();
	});

	it("evictMedia removes all entries for a media ID", () => {
		cache.set("v1", 0, "blob:v1-0");
		cache.set("v1", 1, "blob:v1-1");
		cache.set("v2", 0, "blob:v2-0");

		cache.evictMedia("v1");

		expect(cache.get("v1", 0)).toBeNull();
		expect(cache.get("v1", 1)).toBeNull();
		expect(cache.get("v2", 0)).toBe("blob:v2-0");
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:v1-0");
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:v1-1");
	});

	it("clear revokes all URLs", () => {
		cache.set("v1", 0, "blob:a");
		cache.set("v2", 1, "blob:b");
		cache.clear();

		expect(cache.size).toBe(0);
		expect(revokeObjectURL).toHaveBeenCalledTimes(2);
	});

	it("getAll returns all frames for a media ID", () => {
		cache.set("v1", 0, "blob:0");
		cache.set("v1", 1.5, "blob:1.5");
		cache.set("v2", 0, "blob:other");

		const all = cache.getAll("v1");
		expect(all.size).toBe(2);
		expect(all.get(0)).toBe("blob:0");
		expect(all.get(1.5)).toBe("blob:1.5");
	});

	it("LRU eviction prefers least recently accessed entries", () => {
		vi.useFakeTimers();

		// Fill cache with staggered timestamps
		for (let i = 0; i < 5; i++) {
			cache.set("v1", i, `blob:${i}`);
			vi.advanceTimersByTime(100);
		}

		// Access entry 0 to make it most recently used
		cache.get("v1", 0);
		vi.advanceTimersByTime(100);

		// Add new entry to trigger eviction — should evict entry 1 (oldest accessed)
		cache.set("v1", 5, "blob:5");

		// Entry 0 should survive (recently accessed)
		expect(cache.get("v1", 0)).toBe("blob:0");

		vi.useRealTimers();
	});
});
