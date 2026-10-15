import { beforeEach, describe, expect, it, vi } from "vitest";
import { addClaudeMediaElement } from "../claude-timeline-bridge-helpers";

/**
 * A clip whose length is not known yet used to land at a silent 10 s guess.
 * Video and audio now need a real length; a still keeps the default.
 */

const storeMocks = vi.hoisted(() => ({
	mediaItems: [
		{ id: "m-fresh", name: "fresh.mp4", type: "video" as const },
		{ id: "m-voice", name: "voice.wav", type: "audio" as const },
		{ id: "m-still", name: "still.png", type: "image" as const },
	],
}));

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: { getState: vi.fn(() => ({})) },
}));

vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: vi.fn(() => ({ activeProject: { id: "project-1" } })),
	},
}));

vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: {
		getState: vi.fn(() => ({ mediaItems: storeMocks.mediaItems })),
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

function makeTimelineStore() {
	return {
		findOrCreateTrack: vi.fn(() => "track-x"),
		addElementToTrack: vi.fn(() => "element-added"),
	};
}

describe("media of unknown length", () => {
	beforeEach(() => vi.clearAllMocks());

	it("asks for a length instead of guessing for video and audio", async () => {
		for (const sourceId of ["m-fresh", "m-voice"]) {
			const timelineStore = makeTimelineStore();
			await expect(
				addClaudeMediaElement({
					element: { type: "media", sourceId, startTime: 0 },
					timelineStore: timelineStore as never,
					projectId: "project-1",
				})
			).rejects.toThrow("is not known yet; pass duration");
			expect(timelineStore.addElementToTrack).not.toHaveBeenCalled();
		}
	});

	it("uses a length the request gives", async () => {
		const timelineStore = makeTimelineStore();
		await addClaudeMediaElement({
			element: {
				type: "media",
				sourceId: "m-fresh",
				startTime: 0,
				duration: 4,
			},
			timelineStore: timelineStore as never,
			projectId: "project-1",
		});
		expect(timelineStore.addElementToTrack).toHaveBeenCalledWith(
			"track-x",
			expect.objectContaining({ duration: 4 }),
			expect.anything()
		);
	});

	it("keeps the default length for a still", async () => {
		const timelineStore = makeTimelineStore();
		await addClaudeMediaElement({
			element: { type: "media", sourceId: "m-still", startTime: 0 },
			timelineStore: timelineStore as never,
			projectId: "project-1",
		});
		expect(timelineStore.addElementToTrack).toHaveBeenCalledWith(
			"track-x",
			expect.objectContaining({ duration: 10 }),
			expect.anything()
		);
	});
});
