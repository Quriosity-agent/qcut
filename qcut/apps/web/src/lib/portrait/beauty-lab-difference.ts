export interface BeautyLabFrame {
	name: string;
	width: number;
	height: number;
	rgba: Uint8Array;
}

const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16_777_216;

export function validateBeautyLabFrame({ frame }: { frame: BeautyLabFrame }) {
	if (!frame || typeof frame !== "object" || typeof frame.name !== "string") {
		throw new TypeError("Beauty Lab frames require a string name.");
	}
	const validDimensions = [frame.width, frame.height].every(
		(dimension) =>
			Number.isInteger(dimension) && dimension > 0 && dimension <= MAX_DIMENSION
	);
	if (!validDimensions) {
		throw new RangeError(
			"Beauty Lab dimensions must be integers from 1 to 4096."
		);
	}
	const pixelCount = frame.width * frame.height;
	if (pixelCount > MAX_PIXELS) {
		throw new RangeError("Beauty Lab frames exceed the pixel limit.");
	}
	if (!(frame.rgba instanceof Uint8Array)) {
		throw new TypeError("Beauty Lab RGBA data must be a Uint8Array.");
	}
	if (frame.rgba.byteLength !== pixelCount * 4) {
		throw new RangeError(
			"Beauty Lab RGBA byte count must match the dimensions."
		);
	}
}

export function compareBeautyLabFrames({
	reference,
	candidate,
	gain,
}: {
	reference: BeautyLabFrame;
	candidate: BeautyLabFrame;
	gain: number;
}): {
	difference: BeautyLabFrame;
	metrics: {
		changedPixels: number;
		pixelCount: number;
		rgbMae: number;
		rgbMax: number;
		alphaMax: number;
	};
} {
	if (!Number.isInteger(gain) || gain < 1 || gain > 32) {
		throw new RangeError("Beauty Lab gain must be an integer from 1 to 32.");
	}
	validateBeautyLabFrame({ frame: reference });
	validateBeautyLabFrame({ frame: candidate });
	if (
		reference.width !== candidate.width ||
		reference.height !== candidate.height
	) {
		throw new RangeError("Beauty Lab frames must have the same dimensions.");
	}

	const rgba = new Uint8Array(reference.rgba.byteLength);
	const pixelCount = reference.width * reference.height;
	let changedPixels = 0;
	let rgbTotal = 0;
	let rgbMax = 0;
	let alphaMax = 0;
	for (let offset = 0; offset < rgba.length; offset += 4) {
		const red = Math.abs(reference.rgba[offset] - candidate.rgba[offset]);
		const green = Math.abs(
			reference.rgba[offset + 1] - candidate.rgba[offset + 1]
		);
		const blue = Math.abs(
			reference.rgba[offset + 2] - candidate.rgba[offset + 2]
		);
		const alpha = Math.abs(
			reference.rgba[offset + 3] - candidate.rgba[offset + 3]
		);
		const pixelRgbMax = Math.max(red, green, blue);
		const gray = Math.min(255, pixelRgbMax * gain);
		rgba[offset] = gray;
		rgba[offset + 1] = gray;
		rgba[offset + 2] = gray;
		rgba[offset + 3] = 255;
		if (pixelRgbMax > 0 || alpha > 0) changedPixels += 1;
		rgbTotal += red + green + blue;
		rgbMax = Math.max(rgbMax, pixelRgbMax);
		alphaMax = Math.max(alphaMax, alpha);
	}

	return {
		difference: {
			name: `${reference.name} -> ${candidate.name}`,
			width: reference.width,
			height: reference.height,
			rgba,
		},
		metrics: {
			changedPixels,
			pixelCount,
			rgbMae: rgbTotal / (pixelCount * 3),
			rgbMax,
			alphaMax,
		},
	};
}
