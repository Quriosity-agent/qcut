import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
	loadProject: vi.fn(),
	saveProject: vi.fn(async () => {}),
}));
vi.mock("@/lib/storage/storage-service", () => ({ storageService: storage }));

import type {
	ClaudeAudioMixRequest,
	ClaudeAudioMixResponse,
} from "../../../../../../electron/types/claude-audio-mix-api";
import { createDefaultProjectAudioMixSettings } from "@/lib/audio/audio-mix-settings";
import { useProjectStore } from "@/stores/project-store";
import { clearAutoSaveTimer } from "@/stores/timeline/timeline-store-autosave";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { TimelineTrack } from "@/types/timeline";
import { setupAudioMixHandlers } from "../claude-audio-mix-bridge";
import type { ClaudeTimelineBridgeAPI } from "../claude-timeline-bridge";

/**
 * The mixer over the editor API, on the real stores: the same actions the
 * track headers use, with every answer read back.
 */

function tracks(): TimelineTrack[] {
	return [
		{ id: "guns", name: "SFX · Guns", type: "audio", elements: [] },
		{ id: "ambience", name: "Ambience", type: "audio", elements: [] },
		{ id: "captions", name: "Captions", type: "text", elements: [] },
	];
}

function setup() {
	let handler:
		| ((data: { requestId: string; request: unknown }) => Promise<void>)
		| undefined;
	const responses: ClaudeAudioMixResponse[] = [];
	setupAudioMixHandlers({
		claudeAPI: {
			onAudioMixOperation: (callback: typeof handler) => {
				handler = callback;
			},
			sendAudioMixOperationResponse: (
				_requestId: string,
				response: ClaudeAudioMixResponse
			) => {
				responses.push(response);
			},
		} as unknown as ClaudeTimelineBridgeAPI,
	});
	return async (request: ClaudeAudioMixRequest) => {
		await handler?.({ requestId: "r", request });
		const response = responses.at(-1);
		if (!response) throw new Error("No response");
		return response;
	};
}

const track = (response: ClaudeAudioMixResponse, trackId: string) =>
	response.mix?.tracks.find((candidate) => candidate.trackId === trackId);

describe("mixer over the editor API", () => {
	beforeEach(() => {
		const initial = tracks();
		useTimelineStore.setState({
			_tracks: initial,
			tracks: initial,
			history: [],
			redoStack: [],
		});
		useProjectStore.setState({
			loadedProjectId: "p",
			activeProject: {
				id: "p",
				name: "Doors",
				audioMix: createDefaultProjectAudioMixSettings(),
			} as never,
		});
	});
	afterEach(() => clearAutoSaveTimer());

	it("lists only tracks that carry audio, with what is heard", async () => {
		const run = setup();
		const response = await run({ action: "get", projectId: "p" });
		expect(response.success).toBe(true);
		expect(response.mix?.tracks.map((entry) => entry.trackId)).toEqual([
			"guns",
			"ambience",
		]);
		expect(track(response, "guns")).toMatchObject({
			muted: false,
			audio: { gainDb: 0, busId: "master" },
			effective: { silenced: false, busId: "master" },
		});
	});

	it("refuses a project that is not the one open", async () => {
		const run = setup();
		expect(await run({ action: "get", projectId: "other" })).toMatchObject({
			success: false,
			reason: "not-open",
		});
	});

	it("sets a track's level, pan and ducking and reads them back", async () => {
		const run = setup();
		const response = await run({
			action: "set-track",
			projectId: "p",
			trackId: "ambience",
			patch: {
				gainDb: -6,
				pan: -0.5,
				ducking: { enabled: true, sourceTrackIds: ["guns"], reductionDb: -6 },
			},
		});
		expect(track(response, "ambience")?.audio).toMatchObject({
			gainDb: -6,
			pan: -0.5,
			ducking: {
				enabled: true,
				sourceTrackIds: ["guns"],
				reductionDb: -6,
				thresholdDb: -30,
			},
		});
		expect(
			useTimelineStore.getState().tracks.find((t) => t.id === "ambience")?.audio
				?.gainDb
		).toBe(-6);
	});

	it("mutes and solos, and reports who is silenced", async () => {
		const run = setup();
		await run({
			action: "set-track",
			projectId: "p",
			trackId: "guns",
			patch: { solo: true },
		});
		const muted = await run({
			action: "set-track",
			projectId: "p",
			trackId: "guns",
			patch: { muted: true },
		});
		expect(track(muted, "guns")).toMatchObject({
			muted: true,
			audio: { solo: true },
			effective: { silenced: true },
		});
		expect(track(muted, "ambience")?.effective.silenced).toBe(true);

		const unmuted = await run({
			action: "set-track",
			projectId: "p",
			trackId: "guns",
			patch: { muted: false },
		});
		expect(track(unmuted, "guns")?.muted).toBe(false);
	});

	it("refuses a missing bus, a self-duck and a track with no audio", async () => {
		const run = setup();
		expect(
			await run({
				action: "set-track",
				projectId: "p",
				trackId: "guns",
				patch: { busId: "sfx" },
			})
		).toMatchObject({
			success: false,
			reason: "not-found",
			error: 'No bus "sfx"; buses: master',
		});
		expect(
			await run({
				action: "set-track",
				projectId: "p",
				trackId: "guns",
				patch: { ducking: { sourceTrackIds: ["guns"] } },
			})
		).toMatchObject({
			success: false,
			error: "A track cannot duck under itself",
		});
		expect(
			await run({
				action: "set-track",
				projectId: "p",
				trackId: "captions",
				patch: { gainDb: -3 },
			})
		).toMatchObject({
			success: false,
			error: 'Track "Captions" is a text track and carries no audio',
		});
	});

	it("sets and clears a track's curves, reading them back sorted", async () => {
		const run = setup();
		const set = await run({
			action: "set-track",
			projectId: "p",
			trackId: "ambience",
			patch: {
				automation: {
					gainDb: [
						{ time: 3, value: -30 },
						{ time: 2.5, value: -10 },
					],
				},
			},
		});
		expect(track(set, "ambience")?.audio.automation).toEqual({
			gainDb: [
				{ time: 2.5, value: -10 },
				{ time: 3, value: -30 },
			],
		});
		const cleared = await run({
			action: "set-track",
			projectId: "p",
			trackId: "ambience",
			patch: { automation: { gainDb: null } },
		});
		expect(track(cleared, "ambience")?.audio.automation).toBeUndefined();
	});

	it("creates a bus, routes a track to it, and sends it back to the master on removal", async () => {
		const run = setup();
		const created = await run({
			action: "create-bus",
			projectId: "p",
			busId: "sfx",
			bus: { name: "Hard SFX", gainDb: -3 },
		});
		expect(created).toMatchObject({ success: true, busId: "sfx" });
		expect(created.mix?.buses).toEqual([
			expect.objectContaining({ id: "sfx", name: "Hard SFX", gainDb: -3 }),
		]);
		expect(storage.saveProject).toHaveBeenCalled();

		const routed = await run({
			action: "set-track",
			projectId: "p",
			trackId: "guns",
			patch: { busId: "sfx" },
		});
		expect(track(routed, "guns")?.effective.busId).toBe("sfx");

		const removed = await run({
			action: "remove-bus",
			projectId: "p",
			busId: "sfx",
		});
		expect(removed).toMatchObject({
			success: true,
			reroutedTrackIds: ["guns"],
		});
		expect(removed.mix?.buses).toEqual([]);
		expect(track(removed, "guns")?.audio.busId).toBe("master");
	});

	it("changes the master", async () => {
		const run = setup();
		const response = await run({
			action: "update-bus",
			projectId: "p",
			busId: "master",
			patch: { gainDb: -1, effects: { limiter: { enabled: true } } },
		});
		expect(response.mix?.master).toMatchObject({
			gainDb: -1,
			effects: { limiter: { enabled: true, ceilingDb: -1 } },
		});
	});
});
