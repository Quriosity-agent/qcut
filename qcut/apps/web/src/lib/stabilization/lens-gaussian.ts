/**
 * Gaussian trajectory smoothing, ported from the recovered lens contract
 * (`research/independent-lens-contract/gaussian.cpp`).
 *
 * The native kernel samples a Gaussian at `index * 3σ / radius`, so every
 * kernel spans ±3σ regardless of length; σ only feeds the normalisation
 * constant, which is divided out again. Length is therefore the shape knob.
 * Weights are accumulated in double precision; the smoothed samples are
 * binary32 like the native output.
 */

export interface GaussianRequest {
	length: number;
	sigma: number;
}

export const MAX_GAUSSIAN_KERNEL_LENGTH = 4095;
export const MAX_GAUSSIAN_SAMPLE_COUNT = 1 << 20;

const TWO_PI = 6.2831854820251465;

function validRequest({ length, sigma }: GaussianRequest): boolean {
	const square = sigma * sigma;
	return (
		Number.isInteger(length) &&
		length > 0 &&
		length <= MAX_GAUSSIAN_KERNEL_LENGTH &&
		Number.isFinite(sigma) &&
		sigma > 0 &&
		Number.isFinite(4 * square) &&
		square > 0
	);
}

function gaussianWeight({
	sigma,
	position,
}: {
	sigma: number;
	position: number;
}): number {
	// Native calls libm pow; `x * x` changes some kernel bits, so keep pow.
	const exponent = -1 * (position ** 2 / (2 * sigma) ** 2);
	return (1 / Math.sqrt(TWO_PI * sigma ** 2)) * Math.exp(exponent);
}

/** Normalised kernel weights, or null when the request is out of domain. */
export function gaussianKernel(request: GaussianRequest): Float64Array | null {
	if (!validRequest(request)) return null;
	const even = request.length % 2 === 0;
	const radius = (request.length - (even ? 2 : 1)) / 2;
	const spacing = radius === 0 ? 0 : (3 * request.sigma) / radius;
	const candidate: number[] = [];
	for (let index = radius; index >= 1; index -= 1) {
		candidate.push(
			gaussianWeight({ sigma: request.sigma, position: index * spacing * -1 })
		);
	}
	candidate.push(gaussianWeight({ sigma: request.sigma, position: 0 }));
	if (even)
		candidate.push(gaussianWeight({ sigma: request.sigma, position: 0 }));
	for (let index = 1; index <= radius; index += 1) {
		candidate.push(
			gaussianWeight({ sigma: request.sigma, position: index * spacing })
		);
	}
	let total = 0;
	for (const weight of candidate) total += weight;
	if (!Number.isFinite(total) || total <= 0) return null;
	return Float64Array.from(candidate, (weight) => weight / total);
}

/**
 * Smooths a sample sequence with edge clamping. Only odd lengths are in
 * domain: native smoothing reads `length + 1` weights for even lengths.
 */
export function gaussianSmooth({
	input,
	request,
}: {
	input: ArrayLike<number>;
	request: GaussianRequest;
}): Float32Array | null {
	if (request.length % 2 === 0 || input.length > MAX_GAUSSIAN_SAMPLE_COUNT) {
		return null;
	}
	for (let index = 0; index < input.length; index += 1) {
		if (!Number.isFinite(input[index])) return null;
	}
	const weights = gaussianKernel(request);
	if (!weights) return null;
	const radius = Math.trunc(request.length / 2);
	const count = input.length;
	const output = new Float32Array(count);
	for (let index = 0; index < count; index += 1) {
		let sum = 0;
		for (let offset = -radius; offset <= radius; offset += 1) {
			const source = Math.min(Math.max(index + offset, 0), count - 1);
			sum += input[source] * weights[offset + radius];
		}
		const value = Math.fround(sum);
		if (!Number.isFinite(value)) return null;
		output[index] = value;
	}
	return output;
}
