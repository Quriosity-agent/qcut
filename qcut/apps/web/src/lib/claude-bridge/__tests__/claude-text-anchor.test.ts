import { describe, expect, it, vi } from "vitest";
import {
	addClaudeTextElement,
	resolveClaudeTextAnchor,
} from "../claude-timeline-bridge-helpers";
import type { TimelineStoreState } from "../claude-timeline-bridge-helpers";

/**
 * `anchor` places a title against a canvas edge without the caller working
 * out pixel offsets from the centre; the box sits an inset inside the edge.
 */

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: { getState: vi.fn(() => ({})) },
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: vi.fn(() => ({
			activeProject: {
				id: "project-1",
				fps: 30,
				canvasSize: { width: 1280, height: 720 },
			},
		})),
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

const canvas = { width: 1280, height: 720 };

describe("resolveClaudeTextAnchor", () => {
	it("puts the default 640 × 180 box an inset inside the named edge", () => {
		// Inset 5 % of 720 = 36 px.
		expect(
			resolveClaudeTextAnchor({
				element: { anchor: "bottom-center" },
				properties: {},
				canvas,
			})
		).toEqual({ x: 0, y: 360 - 36 - 90 });
		expect(
			resolveClaudeTextAnchor({
				element: { anchor: "top-left" },
				properties: { width: 400, height: 100 },
				canvas,
			})
		).toEqual({ x: -640 + 36 + 200, y: -360 + 36 + 50 });
		expect(
			resolveClaudeTextAnchor({
				element: { anchor: "center-right", anchorInset: 0 },
				properties: {},
				canvas,
			})
		).toEqual({ x: 640 - 320, y: 0 });
		expect(
			resolveClaudeTextAnchor({
				element: { anchor: "center" },
				properties: {},
				canvas,
			})
		).toEqual({ x: 0, y: 0 });
	});

	it("leaves an explicit x or y alone and refuses an unknown anchor", () => {
		expect(
			resolveClaudeTextAnchor({
				element: { anchor: "bottom-left" },
				properties: { x: 12 },
				canvas,
			})
		).toEqual({ y: 234 });
		expect(
			resolveClaudeTextAnchor({ element: {}, properties: { x: 1 }, canvas })
		).toEqual({});
		expect(() =>
			resolveClaudeTextAnchor({
				element: { anchor: "lower-third" },
				properties: {},
				canvas,
			})
		).toThrow('Unsupported text anchor "lower-third"');
	});
});

describe("single text add with an anchor", () => {
	it("stores the anchored offsets as x and y", () => {
		const store = {
			tracks: [{ id: "titles", name: "Titles", type: "text", elements: [] }],
			findOrCreateTrack: vi.fn(() => "titles"),
			addElementToTrack: vi.fn(() => "el-1"),
		} as unknown as TimelineStoreState;
		addClaudeTextElement({
			element: {
				type: "text",
				content: "门的计划",
				startTime: 0,
				duration: 2,
				anchor: "bottom-center",
			} as never,
			timelineStore: store,
		});
		expect(store.addElementToTrack).toHaveBeenCalledWith(
			"titles",
			expect.objectContaining({ x: 0, y: 234 }),
			expect.any(Object)
		);
	});
});
