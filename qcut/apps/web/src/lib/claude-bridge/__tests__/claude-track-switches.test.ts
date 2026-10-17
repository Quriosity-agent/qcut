import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ClaudeTrackOperationRequest,
	ClaudeTrackOperationResponse,
} from "../../../../../../electron/types/claude-api";
import { clearAutoSaveTimer } from "@/stores/timeline/timeline-store-autosave";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { TimelineTrack } from "@/types/timeline";
import type { ClaudeTimelineBridgeAPI } from "../claude-timeline-bridge";
import { setupTrackHandlers } from "../claude-timeline-bridge-tracks";

/**
 * A track's mute, visibility and lock over the editor API, on the real store:
 * the same toggles the track header uses, with every result read back. This
 * is what lets `timeline apply` put a track back the way an export shows it.
 */

function tracks(): TimelineTrack[] {
	return [
		{ id: "voice", name: "Voice", type: "audio", elements: [] },
		{
			id: "sfx",
			name: "SFX",
			type: "audio",
			muted: true,
			hidden: true,
			elements: [],
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

function track(trackId: string): TimelineTrack | undefined {
	return useTimelineStore
		.getState()
		.tracks.find((candidate) => candidate.id === trackId);
}

describe("track switches over the editor API", () => {
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

	it("creates a track muted and hidden, and reports the switches", () => {
		const run = setupHandler();
		const response = run({
			action: "create",
			type: "audio",
			name: "Ambience",
			muted: true,
			hidden: true,
		});
		expect(response.success).toBe(true);
		const created = track(response.trackId as string);
		expect(created?.muted).toBe(true);
		expect(created?.hidden).toBe(true);
		expect(created?.locked).toBeFalsy();
		expect(
			response.tracks.find((entry) => entry.id === response.trackId)
		).toMatchObject({ muted: true, hidden: true, locked: false });
	});

	it("sets and clears switches with update, touching only what differs", () => {
		const run = setupHandler();
		expect(
			run({ action: "update", trackId: "voice", locked: true }).success
		).toBe(true);
		expect(track("voice")?.locked).toBe(true);
		// Already muted and hidden: asking for the same leaves them alone.
		expect(
			run({ action: "update", trackId: "sfx", muted: true, hidden: true })
				.success
		).toBe(true);
		expect(track("sfx")).toMatchObject({ muted: true, hidden: true });
		expect(
			run({ action: "update", trackId: "sfx", muted: false, hidden: false })
				.success
		).toBe(true);
		expect(track("sfx")?.muted).toBe(false);
		expect(track("sfx")?.hidden).toBe(false);
		expect(
			run({ action: "update", trackId: "voice", locked: false }).success
		).toBe(true);
		expect(track("voice")?.locked).toBe(false);
	});

	it("still refuses an update that changes nothing", () => {
		const run = setupHandler();
		const response = run({ action: "update", trackId: "voice" });
		expect(response.success).toBe(false);
		expect(response.error).toBe(
			"Track update needs index, name, colorLabel, muted, hidden or locked"
		);
	});
});
