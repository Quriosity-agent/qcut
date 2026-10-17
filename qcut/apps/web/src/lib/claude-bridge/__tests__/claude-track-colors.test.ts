import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ClaudeTrackOperationRequest,
	ClaudeTrackOperationResponse,
} from "../../../../../../electron/types/claude-api";
import { clearAutoSaveTimer } from "@/stores/timeline/timeline-store-autosave";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import type { ClaudeTimelineBridgeAPI } from "../claude-timeline-bridge";
import { setupTrackHandlers } from "../claude-timeline-bridge-tracks";

/**
 * Track and clip colours through the editor API, on the real store: the same
 * actions the track and clip menus use, with every result read back.
 */

function clip(id: string, colorLabel?: string): MediaElement {
	return {
		id,
		name: id,
		type: "media",
		mediaId: `${id}-media`,
		startTime: 0,
		duration: 2,
		trimStart: 0,
		trimEnd: 0,
		...(colorLabel ? { colorLabel } : {}),
	};
}

function tracks(): TimelineTrack[] {
	return [
		{
			id: "guns",
			name: "SFX · Guns",
			type: "audio",
			elements: [clip("shot-1"), clip("shot-2", "blue")],
		},
		{
			id: "ambience",
			name: "SFX · Ambience",
			type: "audio",
			locked: true,
			elements: [clip("wind")],
		},
	];
}

function setupHandler() {
	let handler:
		| ((data: { requestId: string; request: unknown }) => void)
		| undefined;
	const responses: ClaudeTrackOperationResponse[] = [];
	setupTrackHandlers({
		claudeAPI: {
			onTrackOperation: vi.fn((callback) => {
				handler = callback;
			}),
			sendTrackOperationResponse: vi.fn(
				(_requestId: string, response: ClaudeTrackOperationResponse) => {
					responses.push(response);
				}
			),
		} as unknown as ClaudeTimelineBridgeAPI,
	});
	return (request: ClaudeTrackOperationRequest) => {
		handler?.({ requestId: "r", request });
		const response = responses.at(-1);
		if (!response) throw new Error("No response");
		return response;
	};
}

function clipColors(trackId: string): Array<string | undefined> {
	return (
		useTimelineStore
			.getState()
			.tracks.find((track) => track.id === trackId)
			?.elements.map((element) => element.colorLabel) ?? []
	);
}

function trackColor(trackId: string): string | undefined {
	return useTimelineStore
		.getState()
		.tracks.find((track) => track.id === trackId)?.colorLabel;
}

describe("track and clip colours over the editor API", () => {
	beforeEach(() => {
		const initial = tracks();
		useTimelineStore.setState({
			_tracks: initial,
			tracks: initial,
			history: [],
			redoStack: [],
			selectedElements: [],
		});
	});
	afterEach(() => clearAutoSaveTimer());

	it("creates a track with a colour and reports it", () => {
		const run = setupHandler();
		const response = run({
			action: "create",
			type: "audio",
			name: "SFX · Mecha",
			colorLabel: "yellow",
		});

		expect(response.success).toBe(true);
		expect(trackColor(response.trackId as string)).toBe("yellow");
		expect(
			response.tracks.find((track) => track.id === response.trackId)?.colorLabel
		).toBe("yellow");
	});

	it("puts a new overlay lane where the editor would: text above the clips, audio below", () => {
		const run = setupHandler();
		const text = run({ action: "create", type: "text" });
		expect(text.success).toBe(true);
		const order = useTimelineStore.getState().tracks.map((track) => track.id);
		// Index 0 is the top row, painted last, so the text is not hidden.
		expect(order[0]).toBe(text.trackId);
		const audio = run({ action: "create", type: "audio" });
		expect(useTimelineStore.getState().tracks.at(-1)?.id).toBe(audio.trackId);
	});

	it("refuses an unknown colour before creating anything", () => {
		const run = setupHandler();
		const before = useTimelineStore.getState().tracks.length;
		const response = run({
			action: "create",
			type: "audio",
			colorLabel: "teal",
		});

		expect(response.success).toBe(false);
		expect(response.error).toContain("colorLabel must be one of");
		expect(useTimelineStore.getState().tracks).toHaveLength(before);
	});

	it("sets and clears a track colour with update", () => {
		const run = setupHandler();
		expect(
			run({ action: "update", trackId: "guns", colorLabel: "red" }).success
		).toBe(true);
		expect(trackColor("guns")).toBe("red");

		expect(
			run({ action: "update", trackId: "guns", colorLabel: null }).success
		).toBe(true);
		expect(trackColor("guns")).toBeUndefined();
	});

	it("says a locked track cannot take a colour", () => {
		const run = setupHandler();
		const response = run({
			action: "update",
			trackId: "ambience",
			colorLabel: "green",
		});
		expect(response).toMatchObject({
			success: false,
			error: 'Track "SFX · Ambience" is locked',
		});
	});

	it("colours every clip on a track in one undo step", () => {
		const run = setupHandler();
		const response = run({
			action: "color-clips",
			trackId: "guns",
			colorLabel: "red",
		});

		expect(response).toMatchObject({
			success: true,
			updatedCount: 2,
			skipped: [],
		});
		expect(clipColors("guns")).toEqual(["red", "red"]);
		expect(useTimelineStore.getState().history).toHaveLength(1);
	});

	it("reports listed clips it could not colour", () => {
		const run = setupHandler();
		const response = run({
			action: "color-clips",
			elementIds: ["shot-1", "wind", "ghost"],
			colorLabel: "rose",
		});

		expect(response).toMatchObject({
			success: true,
			updatedCount: 1,
			skipped: [
				{ elementId: "wind", reason: 'track "SFX · Ambience" is locked' },
				{ elementId: "ghost", reason: "not on the timeline" },
			],
		});
	});

	it("clears the clips' own colour with null", () => {
		const run = setupHandler();
		const response = run({
			action: "color-clips",
			elementIds: ["shot-2"],
			colorLabel: null,
		});

		expect(response.updatedCount).toBe(1);
		expect(clipColors("guns")).toEqual([undefined, undefined]);
	});
});
