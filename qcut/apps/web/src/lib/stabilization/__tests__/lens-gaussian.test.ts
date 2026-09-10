import { describe, expect, it } from "vitest";
import { gaussianKernel, gaussianSmooth } from "../lens-gaussian";

// Expectations mirror research/independent-lens-contract/contract_tests.cpp
// (kernels_and_smoothing), which were pinned against the native library.
describe("lens gaussian kernel", () => {
	it("reproduces the pinned length-three shape", () => {
		const weights = gaussianKernel({ length: 3, sigma: 1 });
		expect(weights).not.toBeNull();
		const native = [
			0.087049355438259091, 0.82590128912348182, 0.087049355438259091,
		];
		for (const [index, expected] of native.entries()) {
			expect(
				Math.abs((weights as Float64Array)[index] - expected)
			).toBeLessThan(2e-15);
		}
	});

	it("duplicates the centre for even lengths", () => {
		const weights = gaussianKernel({ length: 4, sigma: 1 });
		expect(weights?.length).toBe(4);
		expect(
			Math.abs((weights as Float64Array)[0] - 0.047674732449554745)
		).toBeLessThan(2e-15);
		expect((weights as Float64Array)[1]).toBe((weights as Float64Array)[2]);
	});

	it("stays normalised and symmetric for every length up to 65", () => {
		for (let length = 1; length <= 65; length += 1) {
			const weights = gaussianKernel({ length, sigma: 0.7 });
			expect(weights?.length).toBe(length);
			const total = (weights as Float64Array).reduce((sum, w) => sum + w, 0);
			expect(Math.abs(total - 1)).toBeLessThan(1e-12);
			const reversed = Array.from(weights as Float64Array).reverse();
			expect(Array.from(weights as Float64Array)).toEqual(reversed);
		}
	});

	it("rejects out-of-domain requests", () => {
		expect(gaussianKernel({ length: 0, sigma: 1 })).toBeNull();
		expect(gaussianKernel({ length: 4096, sigma: 1 })).toBeNull();
		expect(gaussianKernel({ length: 3, sigma: 0 })).toBeNull();
		expect(gaussianKernel({ length: 3, sigma: Number.NaN })).toBeNull();
		expect(gaussianKernel({ length: 2.5, sigma: 1 })).toBeNull();
	});
});

describe("lens gaussian smoothing", () => {
	it("matches the native impulse response", () => {
		const output = gaussianSmooth({
			input: [0, 0, 1, 0, 0],
			request: { length: 3, sigma: 1 },
		});
		expect(Array.from(output as Float32Array)).toEqual([
			0, 0.08704935759305954, 0.82590126991271973, 0.08704935759305954, 0,
		]);
	});

	it("replicates the nearest sample at the boundary", () => {
		const output = gaussianSmooth({
			input: [1, 0, 0],
			request: { length: 3, sigma: 1 },
		});
		expect(
			Math.abs((output as Float32Array)[0] - 0.91295063495635986)
		).toBeLessThan(1e-7);
		expect((output as Float32Array)[2]).toBe(0);
	});

	it("leaves a constant untouched when the window is wider than the input", () => {
		const output = gaussianSmooth({
			input: [4.5],
			request: { length: 65, sigma: 3 },
		});
		expect(Array.from(output as Float32Array)).toEqual([4.5]);
	});

	it("handles the empty sequence and rejects even lengths and NaN", () => {
		expect(
			Array.from(
				gaussianSmooth({ input: [], request: { length: 3, sigma: 1 } }) ?? [1]
			)
		).toEqual([]);
		expect(
			gaussianSmooth({ input: [1, 2], request: { length: 4, sigma: 1 } })
		).toBeNull();
		expect(
			gaussianSmooth({
				input: [1, Number.NaN],
				request: { length: 3, sigma: 1 },
			})
		).toBeNull();
	});
});
