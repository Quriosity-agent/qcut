import { describe, expect, it } from "vitest";
import {
	AudioMixBusError,
	createAudioBus,
	mergeAudioBusPatch,
	mergeTrackAudioPatch,
	removeAudioBus,
	updateAudioBus,
} from "../audio-mix-patch";
import {
	createDefaultAudioMixBus,
	createDefaultProjectAudioMixSettings,
	createDefaultTrackAudioSettings,
} from "../audio-mix-settings";

const mixWith = (...ids: string[]) => ({
	...createDefaultProjectAudioMixSettings(),
	buses: ids.map((id) =>
		createDefaultAudioMixBus({ id, name: id.toUpperCase() })
	),
});

function refusal(run: () => unknown) {
	try {
		run();
	} catch (error) {
		if (error instanceof AudioMixBusError) {
			return { reason: error.reason, message: error.message };
		}
		throw error;
	}
	throw new Error("expected a refusal");
}

describe("mixer patches", () => {
	it("changes only the given fields, however deep", () => {
		const settings = createDefaultTrackAudioSettings();
		settings.effects.compressor.thresholdDb = -24;
		settings.ducking.sourceTrackIds = ["voice"];

		const next = mergeTrackAudioPatch({
			settings,
			patch: {
				gainDb: -6,
				ducking: { enabled: true, reductionDb: -9 },
				effects: {
					compressor: { enabled: true },
					parametricEqualizer: { bands: [{ id: "air", gainDb: 2 }] },
				},
			},
		});

		expect(next.gainDb).toBe(-6);
		expect(next.pan).toBe(0);
		expect(next.ducking).toMatchObject({
			enabled: true,
			reductionDb: -9,
			sourceTrackIds: ["voice"],
			thresholdDb: -30,
		});
		expect(next.effects.compressor).toMatchObject({
			enabled: true,
			thresholdDb: -24,
		});
		const air = next.effects.parametricEqualizer.bands.find(
			(band) => band.id === "air"
		);
		expect(air).toMatchObject({ gainDb: 2, frequencyHz: 10_000 });
		expect(next.effects.parametricEqualizer.bands).toHaveLength(4);
		expect(settings.effects.compressor.enabled).toBe(false);
	});

	it("adds a band past the end with sensible defaults", () => {
		const next = mergeTrackAudioPatch({
			settings: createDefaultTrackAudioSettings(),
			patch: {
				effects: {
					parametricEqualizer: {
						bands: [{ id: "hum", type: "notch", frequencyHz: 50 }],
					},
				},
			},
		});
		expect(next.effects.parametricEqualizer.bands.at(-1)).toEqual({
			id: "hum",
			enabled: true,
			type: "notch",
			frequencyHz: 50,
			gainDb: 0,
			q: 1,
		});
	});
});

describe("automation patches", () => {
	it("replaces a curve, keeps the other, and removes one with null", () => {
		const settings = mergeTrackAudioPatch({
			settings: createDefaultTrackAudioSettings(),
			patch: {
				automation: {
					gainDb: [{ time: 1, value: -3 }],
					pan: [
						{ time: 0, value: -1 },
						{ time: 2, value: 1 },
					],
				},
			},
		});
		const replaced = mergeTrackAudioPatch({
			settings,
			patch: { automation: { gainDb: [{ time: 5, value: 0 }] } },
		});
		expect(replaced.automation).toEqual({
			gainDb: [{ time: 5, value: 0 }],
			pan: [
				{ time: 0, value: -1 },
				{ time: 2, value: 1 },
			],
		});
		const cleared = mergeTrackAudioPatch({
			settings: replaced,
			patch: { automation: { gainDb: null, pan: null } },
		});
		expect(cleared.automation).toBeUndefined();
	});

	it("gives a bus a curve the same way", () => {
		const bus = mergeAudioBusPatch({
			bus: createDefaultAudioMixBus({ id: "music", name: "Music" }),
			patch: { automation: { pan: [{ time: 1, value: 0.5 }] } },
		});
		expect(bus.automation).toEqual({ pan: [{ time: 1, value: 0.5 }] });
	});
});

describe("bus operations", () => {
	it("makes an id from the name, or bus-N when the name has no letters to use", () => {
		const first = createAudioBus({
			audioMix: createDefaultProjectAudioMixSettings(),
			patch: { name: "Hard SFX", gainDb: -3 },
		});
		expect(first.bus).toMatchObject({
			id: "hard-sfx",
			name: "Hard SFX",
			gainDb: -3,
		});

		const second = createAudioBus({
			audioMix: first.audioMix,
			patch: { name: "硬音效" },
		});
		expect(second.bus.id).toBe("bus-1");
		expect(second.audioMix.buses.map((bus) => bus.id)).toEqual([
			"hard-sfx",
			"bus-1",
		]);
	});

	it("refuses a second bus with the same name or id", () => {
		const audioMix = mixWith("sfx");
		expect(
			refusal(() => createAudioBus({ audioMix, patch: { name: "sfx" } }))
		).toEqual({
			reason: "invalid",
			message: 'A bus named "SFX" already exists (id sfx)',
		});
		expect(
			refusal(() =>
				createAudioBus({ audioMix, id: "sfx", patch: { name: "Other" } })
			).message
		).toBe('Bus id "sfx" is taken');
	});

	it("changes the master, but never its name or solo", () => {
		const audioMix = mixWith("sfx");
		expect(
			updateAudioBus({ audioMix, busId: "master", patch: { gainDb: -1 } })
				.master.gainDb
		).toBe(-1);
		expect(
			refusal(() =>
				updateAudioBus({ audioMix, busId: "master", patch: { solo: true } })
			).message
		).toBe("The master cannot be soloed");
	});

	it("names the buses there are when one is missing", () => {
		expect(
			refusal(() =>
				updateAudioBus({
					audioMix: mixWith("sfx", "music"),
					busId: "fx",
					patch: { gainDb: -3 },
				})
			)
		).toEqual({
			reason: "not-found",
			message: 'No bus "fx"; buses: master, sfx, music',
		});
	});

	it("removes a bus but not the master", () => {
		expect(
			removeAudioBus({
				audioMix: mixWith("sfx", "music"),
				busId: "sfx",
			}).buses.map((bus) => bus.id)
		).toEqual(["music"]);
		expect(
			refusal(() => removeAudioBus({ audioMix: mixWith(), busId: "master" }))
				.message
		).toBe("The master cannot be removed");
	});
});
