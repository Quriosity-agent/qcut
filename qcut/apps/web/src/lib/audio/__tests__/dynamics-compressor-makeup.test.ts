import { describe, expect, it } from "vitest";
import {
	compressorOutputGain,
	dynamicsCompressorMakeupGain,
	limiterOutputGain,
} from "../dynamics-compressor-makeup";

const toDb = (gain: number) => 20 * Math.log10(gain);

/**
 * [thresholdDb, kneeDb, ratio, gain in dB]: what a DynamicsCompressorNode did
 * to a −80 dBFS constant (below every threshold here, so the gain is its
 * makeup alone) in Chromium 152's OfflineAudioContext. The constant's own
 * float32 rounding reads −0.00013 dB.
 */
const CHROMIUM_152: Array<[number, number, number, number]> = [
	[-1, 0, 20, 0.56987],
	[-3, 0, 20, 1.70987],
	[-0.8, 0, 20, 0.45587],
	[-12, 0, 20, 6.83987],
	[0, 0, 20, -0.00013],
	[0, 0, 1, -0.00013],
	[0, 30, 1, -0.00013],
	[-18, 30, 1, 0.19699],
	[-18, 30, 3, 0.90753],
	[-24, 30, 12, 3.66038],
	[-10, 30, 2, 0.15097],
	[-30, 30, 20, 7.22306],
	[-50, 30, 4, 13.58752],
	[-6, 30, 1.5, 0.06404],
	[-40, 10, 8, 18.82095],
	[-20, 5, 4, 8.06014],
];

describe("dynamicsCompressorMakeupGain", () => {
	it("matches the makeup gain Chromium applies", () => {
		for (const [thresholdDb, kneeDb, ratio, measuredDb] of CHROMIUM_152) {
			const gain = dynamicsCompressorMakeupGain({ thresholdDb, kneeDb, ratio });
			expect(toDb(gain), `${thresholdDb}/${kneeDb}/${ratio}`).toBeCloseTo(
				measuredDb,
				2
			);
		}
	});

	it("is 1 for the neutral settings a switched-off stage uses", () => {
		for (const [kneeDb, ratio] of [
			[0, 1],
			[0, 20],
			[30, 1],
		])
			expect(
				dynamicsCompressorMakeupGain({ thresholdDb: 0, kneeDb, ratio })
			).toBeCloseTo(1, 6);
	});
});

describe("stage output gains", () => {
	it("keeps only the user's makeup after a compressor", () => {
		const gain = compressorOutputGain({
			thresholdDb: -18,
			ratio: 3,
			makeupGain: 10 ** (4 / 20),
		});
		expect(toDb(gain)).toBeCloseTo(4 - 0.90753, 2);
	});

	it("brings a limiter's output back to its ceiling's scale", () => {
		expect(toDb(limiterOutputGain({ thresholdDb: -1, ratio: 20 }))).toBeCloseTo(
			-0.56987,
			2
		);
		expect(limiterOutputGain({ thresholdDb: 0, ratio: 1 })).toBeCloseTo(1, 6);
	});
});
