import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	addClaudeAdjustmentElement,
	addClaudeCaptionElement,
	addClaudeMediaElement,
} from "../claude-timeline-bridge-helpers";
import type { TimelineStoreState } from "../claude-timeline-bridge-helpers";

/**
 * N6 (2026-10-28 trailer report): an `add-element` naming a track that had
 * been removed answered ok and put the clip on a new "音频轨道", so two
 * scores played over the dialogue. A named track is the lane now: a missing
 * or unsuitable one is refused instead of replaced.
 */

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: { getState: vi.fn(() => ({})) },
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: vi.fn(() => ({ activeProject: { id: "project-1", fps: 24 } })),
	},
}));
vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: {
		getState: vi.fn(() => ({
			mediaItems: [
				{ id: "m-score", name: "v11配乐.wav", type: "audio", duration: 170 },
			],
		})),
	},
}));
vi.mock("@qcut/platform-core", () => ({
	platform: vi.fn(() => ({ projectFolder: undefined })),
}));
vi.mock("@/lib/debug/debug-config", () => ({
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
	debugError: vi.fn(),
}));

function makeStore() {
	return {
		tracks: [
			{ id: "main", name: "Main", type: "media", isMain: true, elements: [] },
			{ id: "score", name: "配乐 Suno", type: "audio", elements: [] },
			{ id: "subs-en", name: "字幕 英文", type: "captions", elements: [] },
			{ id: "titles", name: "片名", type: "text", elements: [] },
		],
		findOrCreateTrack: vi.fn(() => "made-track"),
		addElementToTrack: vi.fn(() => "el-1"),
	} as unknown as TimelineStoreState;
}

describe("single add on a named track", () => {
	beforeEach(() => vi.clearAllMocks());

	it("refuses a track that no longer exists instead of making a new one", async () => {
		const store = makeStore();
		await expect(
			addClaudeMediaElement({
				element: {
					type: "audio",
					sourceName: "v11配乐.wav",
					trackId: "deleted-score-track",
					startTime: 0,
				},
				timelineStore: store,
				projectId: "project-1",
			})
		).rejects.toThrow("Track not found: deleted-score-track");
		expect(store.findOrCreateTrack).not.toHaveBeenCalled();
		expect(store.addElementToTrack).not.toHaveBeenCalled();
	});

	it("puts audio on the named audio track", async () => {
		const store = makeStore();
		await addClaudeMediaElement({
			element: {
				type: "audio",
				sourceName: "v11配乐.wav",
				trackId: "score",
				startTime: 0,
			},
			timelineStore: store,
			projectId: "project-1",
		});
		expect(store.findOrCreateTrack).not.toHaveBeenCalled();
		expect(store.addElementToTrack).toHaveBeenCalledWith(
			"score",
			expect.objectContaining({ mediaId: "m-score" }),
			expect.any(Object)
		);
	});

	// N17 (2026-10-28 trailer report): a single add refused an overlap that
	// batch-add, given the same `collision`, resolved.
	it("passes the request's collision policy to the store, as batch-add does", async () => {
		const store = makeStore();
		await addClaudeMediaElement({
			element: {
				type: "audio",
				sourceName: "v11配乐.wav",
				trackId: "score",
				startTime: 0,
				collision: "insert",
			} as never,
			timelineStore: store,
			projectId: "project-1",
		});
		expect(store.addElementToTrack).toHaveBeenCalledWith(
			"score",
			expect.anything(),
			expect.objectContaining({ collision: "insert" })
		);
		expect(() =>
			addClaudeCaptionElement({
				element: {
					type: "captions",
					trackId: "subs-en",
					content: "x",
					collision: "squeeze",
				} as never,
				timelineStore: makeStore(),
			})
		).toThrow("collision must be one of: reject, insert, overwrite");
	});

	it("puts a caption on the named captions track", () => {
		const store = makeStore();
		addClaudeCaptionElement({
			element: {
				type: "captions",
				trackId: "subs-en",
				content: "Round one.",
				startTime: 61,
				duration: 1.4,
			},
			timelineStore: store,
		});
		expect(store.findOrCreateTrack).not.toHaveBeenCalled();
		expect(store.addElementToTrack).toHaveBeenCalledWith(
			"subs-en",
			expect.objectContaining({ type: "captions", text: "Round one." }),
			expect.any(Object)
		);
	});

	it("refuses a track of another kind", () => {
		const store = makeStore();
		expect(() =>
			addClaudeCaptionElement({
				element: {
					type: "captions",
					trackId: "titles",
					content: "x",
					startTime: 0,
					duration: 1,
				},
				timelineStore: store,
			})
		).toThrow(
			'Track "片名" is a text track; a captions element needs a captions track'
		);
		expect(() =>
			addClaudeAdjustmentElement({
				element: {
					type: "adjustment",
					trackId: "score",
					startTime: 0,
					duration: 1,
				},
				timelineStore: store,
			})
		).toThrow(
			'Track "配乐 Suno" is an audio track; an adjustment element needs an adjustment track'
		);
		expect(store.addElementToTrack).not.toHaveBeenCalled();
	});
});
