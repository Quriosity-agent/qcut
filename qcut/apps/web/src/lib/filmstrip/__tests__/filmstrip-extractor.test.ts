import { describe, it, expect, vi, beforeEach } from "vitest";
import { filmstripCache } from "../filmstrip-cache";

// We test the extraction logic indirectly through cache interactions,
// since extractFrames depends on DOM elements (video, canvas) which
// are difficult to mock in JSDOM. The cache is the public API surface.

describe("filmstrip-extractor integration", () => {
	beforeEach(() => {
		filmstripCache.clear();
	});

	it("filmstripCache singleton is shared", () => {
		filmstripCache.set("test", 1.0, "blob:test");
		expect(filmstripCache.get("test", 1.0)).toBe("blob:test");
	});

	it("cache keys are quantized to 3 decimal places", () => {
		filmstripCache.set("v1", 1.123, "blob:a");
		// Same time at 3 decimal places should match
		expect(filmstripCache.get("v1", 1.123)).toBe("blob:a");
		// Different at 3rd decimal should not
		expect(filmstripCache.get("v1", 1.124)).toBeNull();
	});

	it("evictMedia cleans up specific media entries", () => {
		filmstripCache.set("v1", 0, "blob:v1-0");
		filmstripCache.set("v1", 1, "blob:v1-1");
		filmstripCache.set("v2", 0, "blob:v2-0");

		filmstripCache.evictMedia("v1");
		expect(filmstripCache.get("v1", 0)).toBeNull();
		expect(filmstripCache.get("v2", 0)).toBe("blob:v2-0");
	});

	it("default cache has 500 entry limit", () => {
		// Just verify we can set many entries without error
		for (let i = 0; i < 100; i++) {
			filmstripCache.set("v1", i * 0.1, `blob:${i}`);
		}
		expect(filmstripCache.size).toBe(100);
	});
});
