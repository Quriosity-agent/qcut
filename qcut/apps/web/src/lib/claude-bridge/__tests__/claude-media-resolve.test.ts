import { beforeEach, describe, expect, it, vi } from "vitest";

const media = vi.hoisted(() => ({
	items: [] as Array<{ id: string; name: string }>,
}));
vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: { getState: () => ({ mediaItems: media.items }) },
}));

import {
	decodeDeterministicMediaSourceName,
	resolveMediaIdForBatchElement,
} from "../claude-media-resolve";

/** The main process names an imported file `media_<base64url of its name>`. */
function deterministicId(name: string): string {
	const bytes = new TextEncoder().encode(name);
	const base64 = btoa(String.fromCharCode(...bytes));
	return `media_${base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

beforeEach(() => {
	media.items = [
		{ id: "m-store", name: "05_拳域_01.mp4" },
		{ id: "m-score", name: "score.mp3" },
	];
});

describe("media id resolution", () => {
	it("decodes a deterministic id back to the file name", () => {
		expect(
			decodeDeterministicMediaSourceName({
				sourceId: deterministicId("05_拳域_01.mp4"),
			})
		).toBe("05_拳域_01.mp4");
		expect(
			decodeDeterministicMediaSourceName({ sourceId: "media_" })
		).toBeNull();
		expect(
			decodeDeterministicMediaSourceName({ sourceId: "other" })
		).toBeNull();
		expect(
			decodeDeterministicMediaSourceName({ sourceId: "media_%%%" })
		).toBeNull();
	});

	it("finds media by id, by the name an id encodes, then by name", () => {
		const resolve = (element: Record<string, string>) =>
			resolveMediaIdForBatchElement({ element });
		expect(resolve({ mediaId: "m-score" })).toBe("m-score");
		expect(resolve({ mediaId: deterministicId("05_拳域_01.mp4") })).toBe(
			"m-store"
		);
		expect(resolve({ sourceId: "m-score" })).toBe("m-score");
		expect(resolve({ sourceId: deterministicId("score.mp3") })).toBe("m-score");
		expect(resolve({ sourceName: "05_拳域_01.mp4" })).toBe("m-store");
		expect(resolve({ mediaId: "gone", sourceName: "score.mp3" })).toBe(
			"m-score"
		);
		expect(resolve({ mediaId: "gone", sourceId: "gone" })).toBeNull();
	});
});
