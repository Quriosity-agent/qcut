import { describe, expect, it, vi } from "vitest";
import { addClaudeTextElement } from "../claude-timeline-bridge-helpers";
import type { TimelineStoreState } from "../claude-timeline-bridge-helpers";

/**
 * A single `add-element` for text used to ignore its `trackId` and make a new
 * text track; now a named track is the lane, and a wrong one is refused.
 */

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: { getState: vi.fn(() => ({})) },
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: vi.fn(() => ({ activeProject: { id: "project-1", fps: 30 } })),
	},
}));
vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: { getState: vi.fn(() => ({ mediaItems: [] })) },
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
			{ id: "titles", name: "文字测试", type: "text", elements: [] },
			{ id: "main", name: "Main", type: "media", isMain: true, elements: [] },
		],
		findOrCreateTrack: vi.fn(() => "made-text"),
		addElementToTrack: vi.fn(() => "el-1"),
	} as unknown as TimelineStoreState;
}

describe("single text add and its track", () => {
	it("puts the text on the named text track", () => {
		const store = makeStore();
		const id = addClaudeTextElement({
			element: {
				type: "text",
				trackId: "titles",
				content: "门的计划",
				startTime: 1,
				duration: 2,
			},
			timelineStore: store,
		});
		expect(id).toBe("el-1");
		expect(store.findOrCreateTrack).not.toHaveBeenCalled();
		expect(store.addElementToTrack).toHaveBeenCalledWith(
			"titles",
			expect.objectContaining({ type: "text", content: "门的计划" }),
			expect.any(Object)
		);
	});

	it("picks or makes a text track only when none is named", () => {
		const store = makeStore();
		addClaudeTextElement({
			element: { type: "text", content: "x", startTime: 0, duration: 1 },
			timelineStore: store,
		});
		expect(store.findOrCreateTrack).toHaveBeenCalledWith("text");
		expect(store.addElementToTrack).toHaveBeenCalledWith(
			"made-text",
			expect.any(Object),
			expect.any(Object)
		);
	});

	it("refuses a missing track and a track of another kind", () => {
		const store = makeStore();
		expect(() =>
			addClaudeTextElement({
				element: { type: "text", trackId: "nope", startTime: 0, duration: 1 },
				timelineStore: store,
			})
		).toThrow("Track not found: nope");
		expect(() =>
			addClaudeTextElement({
				element: { type: "text", trackId: "main", startTime: 0, duration: 1 },
				timelineStore: store,
			})
		).toThrow(
			'Track "Main" is a media track; a text element needs a text track'
		);
		expect(store.addElementToTrack).not.toHaveBeenCalled();
	});
});
