import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	extractHighlights,
	getChannelColor,
	isVersionDismissed,
	dismissVersion,
} from "../project/release-notes";

describe("Release Notes Utilities", () => {
	describe("extractHighlights", () => {
		it("should extract items from What's New section", () => {
			const content = `# QCut v0.3.52

## What's New
- Skills system with default skills
- FFmpeg skill for video processing
- Organize-project skill

## Bug Fixes
- Various stability improvements`;

			const highlights = extractHighlights(content);
			expect(highlights).toEqual([
				"Skills system with default skills",
				"FFmpeg skill for video processing",
				"Organize-project skill",
			]);
		});

		it("should limit to maxItems", () => {
			const content = `## What's New
- Feature A
- Feature B
- Feature C
- Feature D`;

			const highlights = extractHighlights(content, 2);
			expect(highlights).toHaveLength(2);
			expect(highlights[0]).toBe("Feature A");
			expect(highlights[1]).toBe("Feature B");
		});

		it("should return empty array if no What's New section", () => {
			const content = `## Bug Fixes
- Fixed something`;

			expect(extractHighlights(content)).toEqual([]);
		});

		it("should handle Added section as alternative", () => {
			const content = `## Added
- New feature here`;

			const highlights = extractHighlights(content);
			expect(highlights).toEqual(["New feature here"]);
		});

		it("should handle asterisk bullet points", () => {
			const content = `## What's New
* Feature with asterisk
* Another feature`;

			const highlights = extractHighlights(content);
			expect(highlights).toEqual(["Feature with asterisk", "Another feature"]);
		});
	});

	describe("getChannelColor", () => {
		it("should return destructive for alpha", () => {
			expect(getChannelColor("alpha")).toBe("destructive");
		});

		it("should return secondary for beta", () => {
			expect(getChannelColor("beta")).toBe("secondary");
		});

		it("should return outline for rc", () => {
			expect(getChannelColor("rc")).toBe("outline");
		});

		it("should return default for stable", () => {
			expect(getChannelColor("stable")).toBe("default");
		});

		it("should return default for unknown channel", () => {
			expect(getChannelColor("unknown")).toBe("default");
		});
	});

	describe("isVersionDismissed / dismissVersion", () => {
		let store: Record<string, string>;

		beforeEach(() => {
			store = {};
			const mockStorage = {
				getItem: (key: string) => store[key] ?? null,
				setItem: (key: string, value: string) => {
					store[key] = value;
				},
				removeItem: (key: string) => {
					delete store[key];
				},
				clear: () => {
					store = {};
				},
				get length() {
					return Object.keys(store).length;
				},
				key: (index: number) => Object.keys(store)[index] ?? null,
			};
			vi.stubGlobal("localStorage", mockStorage);
		});

		it("should return false for a never-dismissed version", () => {
			expect(isVersionDismissed("1.0.0")).toBe(false);
		});

		it("should return true after dismissing the same version", () => {
			dismissVersion("1.0.0");
			expect(isVersionDismissed("1.0.0")).toBe(true);
		});

		it("should return false for a different version", () => {
			dismissVersion("1.0.0");
			expect(isVersionDismissed("1.0.1")).toBe(false);
		});

		it("should overwrite previously dismissed version", () => {
			dismissVersion("1.0.0");
			dismissVersion("1.0.1");
			expect(isVersionDismissed("1.0.0")).toBe(false);
			expect(isVersionDismissed("1.0.1")).toBe(true);
		});
	});
});
