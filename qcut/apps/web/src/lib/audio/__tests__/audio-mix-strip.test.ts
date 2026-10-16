import { describe, expect, it } from "vitest";
import { createDefaultAudioBusEffectsSettings } from "../audio-mix-settings";
import { applyMixStripEffects, createMixStripNodes } from "../audio-mix-strip";
import { FLAT_CUTOFF_Q_DB } from "../audio-properties";

function param(value: number) {
	return { value };
}

function biquad() {
	return {
		type: "lowpass",
		frequency: param(350),
		Q: param(1),
		gain: param(0),
		connect: () => {},
	};
}

function fakeContext() {
	return {
		sampleRate: 48_000,
		createGain: () => ({ gain: param(1), connect: () => {} }),
		createBiquadFilter: biquad,
		createDynamicsCompressor: () => ({
			threshold: param(-24),
			knee: param(30),
			ratio: param(12),
			attack: param(0.003),
			release: param(0.25),
			connect: () => {},
		}),
		createStereoPanner: () => ({ pan: param(0), connect: () => {} }),
	} as unknown as BaseAudioContext;
}

describe("createMixStripNodes", () => {
	it("gives the low and high cut a flat (Butterworth) response", () => {
		const strip = createMixStripNodes({ context: fakeContext() });
		expect(strip.lowCut.type).toBe("highpass");
		expect(strip.lowCut.Q.value).toBe(FLAT_CUTOFF_Q_DB);
		expect(strip.highCut.type).toBe("lowpass");
		expect(strip.highCut.Q.value).toBe(FLAT_CUTOFF_Q_DB);
		for (const band of strip.bands) expect(band.Q.value).toBe(1);
	});

	it("parks an unused cut where it passes everything, and applies a wanted one", () => {
		const strip = createMixStripNodes({ context: fakeContext() });
		const set = (parameter: AudioParam, value: number) => {
			parameter.value = value;
		};
		const effects = createDefaultAudioBusEffectsSettings();

		applyMixStripEffects({ strip, effects, set });
		expect(strip.lowCut.frequency.value).toBe(0);
		expect(strip.highCut.frequency.value).toBe(24_000);

		applyMixStripEffects({
			strip,
			effects: {
				...effects,
				parametricEqualizer: {
					...effects.parametricEqualizer,
					enabled: true,
					lowCutHz: 20,
					highCutHz: 20_000,
				},
			},
			set,
		});
		expect(strip.lowCut.frequency.value).toBe(0);
		expect(strip.highCut.frequency.value).toBe(24_000);

		applyMixStripEffects({
			strip,
			effects: {
				...effects,
				parametricEqualizer: {
					...effects.parametricEqualizer,
					enabled: true,
					lowCutHz: 80,
					highCutHz: 12_000,
				},
			},
			set,
		});
		expect(strip.lowCut.frequency.value).toBe(80);
		expect(strip.highCut.frequency.value).toBe(12_000);
	});
});
