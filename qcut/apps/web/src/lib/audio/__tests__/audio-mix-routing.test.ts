import { describe, expect, it } from "vitest";
import type { TimelineTrack } from "@/types/timeline";
import {
	createDefaultAudioMixBus,
	createDefaultProjectAudioMixSettings,
	normalizeTrackAudioSettings,
} from "../audio-mix-settings";
import {
	audioMixIsNeutral,
	resolveAudioMixRouting,
} from "../audio-mix-routing";

function track(
	id: string,
	audio: Parameters<typeof normalizeTrackAudioSettings>[0]["audio"] = {},
	fields: Partial<TimelineTrack> = {}
): TimelineTrack {
	return {
		id,
		name: id,
		type: "audio",
		elements: [],
		audio: normalizeTrackAudioSettings({ audio }),
		...fields,
	};
}

const bus = (id: string, fields = {}) => ({
	...createDefaultAudioMixBus({ id, name: id }),
	...fields,
});

function silenced(routing: ReturnType<typeof resolveAudioMixRouting>) {
	return Object.fromEntries(
		routing.tracks.map((route) => [route.trackId, route.silenced])
	);
}

describe("audio mix routing", () => {
	it("silences every track but the soloed ones, and muted tracks", () => {
		const routing = resolveAudioMixRouting({
			tracks: [
				track("dialogue", { solo: true }),
				track("music"),
				track("sfx", { solo: true }, { muted: true }),
			],
		});
		expect(silenced(routing)).toEqual({
			dialogue: false,
			music: true,
			sfx: true,
		});
	});

	it("silences tracks off a soloed bus, master included", () => {
		const routing = resolveAudioMixRouting({
			tracks: [
				track("guns", { busId: "sfx" }),
				track("score", { busId: "music" }),
				track("voice"),
			],
			audioMix: {
				...createDefaultProjectAudioMixSettings(),
				buses: [bus("sfx", { solo: true }), bus("music")],
			},
		});
		expect(silenced(routing)).toEqual({
			guns: false,
			score: true,
			voice: true,
		});
		expect(routing.buses.map((route) => route.silenced)).toEqual([false, true]);
	});

	it("sends a track whose bus does not exist to the master", () => {
		const routing = resolveAudioMixRouting({
			tracks: [track("a", { busId: "gone" }), track("b", { busId: "sfx" })],
			audioMix: {
				...createDefaultProjectAudioMixSettings(),
				buses: [bus("sfx")],
			},
		});
		expect(routing.tracks.map((route) => route.busId)).toEqual([
			"master",
			"sfx",
		]);
	});

	it("leaves out tracks that carry no audio", () => {
		const routing = resolveAudioMixRouting({
			tracks: [track("a"), track("captions", {}, { type: "text" })],
		});
		expect(routing.tracks.map((route) => route.trackId)).toEqual(["a"]);
	});

	it("calls a default mix neutral, muted tracks or not", () => {
		expect(
			audioMixIsNeutral(
				resolveAudioMixRouting({
					tracks: [track("a"), track("b", {}, { muted: true })],
					audioMix: createDefaultProjectAudioMixSettings(),
				})
			)
		).toBe(true);
	});

	it.each([
		["a track gain", [track("a", { gainDb: -3 })], undefined],
		["a track pan", [track("a", { pan: 0.5 })], undefined],
		["a solo", [track("a", { solo: true })], undefined],
		[
			"ducking",
			[
				track("a", {
					ducking: {
						...normalizeTrackAudioSettings({}).ducking,
						enabled: true,
						sourceTrackIds: ["b"],
					},
				}),
			],
			undefined,
		],
		[
			"a bus",
			[track("a", { busId: "sfx" })],
			{ ...createDefaultProjectAudioMixSettings(), buses: [bus("sfx")] },
		],
		[
			"a master limiter",
			[track("a")],
			{
				...createDefaultProjectAudioMixSettings(),
				master: {
					...createDefaultProjectAudioMixSettings().master,
					effects: {
						...createDefaultProjectAudioMixSettings().master.effects,
						limiter: { enabled: true, ceilingDb: -1, releaseMs: 50 },
					},
				},
			},
		],
	])("does not call a mix with %s neutral", (_name, tracks, audioMix) => {
		expect(
			audioMixIsNeutral(resolveAudioMixRouting({ tracks, audioMix }))
		).toBe(false);
	});
});
