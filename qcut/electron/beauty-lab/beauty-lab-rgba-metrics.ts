export function compareRgbaPixels({
	actual,
	expected,
	width,
	height,
}: {
	actual: Uint8Array;
	expected: Uint8Array;
	width: number;
	height: number;
}): {
	changedPixels: number;
	maxDelta: number;
	bbox: [number, number, number, number] | null;
} {
	const byteLength = width * height * 4;
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width <= 0 ||
		height <= 0 ||
		!Number.isSafeInteger(byteLength) ||
		actual.byteLength !== byteLength ||
		expected.byteLength !== byteLength
	) {
		throw new Error("RGBA dimensions or byte count differ");
	}
	const actualBytes = Buffer.from(
		actual.buffer,
		actual.byteOffset,
		actual.byteLength
	);
	const expectedBytes = Buffer.from(
		expected.buffer,
		expected.byteOffset,
		expected.byteLength
	);
	if (actualBytes.equals(expectedBytes)) {
		return { changedPixels: 0, maxDelta: 0, bbox: null };
	}
	let changedPixels = 0;
	let maxDelta = 0;
	let x0 = width;
	let y0 = height;
	let x1 = 0;
	let y1 = 0;
	const rowBytes = width * 4;
	for (let y = 0; y < height; y++) {
		const start = y * rowBytes;
		const end = start + rowBytes;
		// Native byte comparison avoids per-channel work on unchanged rows.
		if (
			actualBytes
				.subarray(start, end)
				.equals(expectedBytes.subarray(start, end))
		) {
			continue;
		}
		for (let offset = start; offset < end; offset += 4) {
			if (
				actualBytes[offset] === expectedBytes[offset] &&
				actualBytes[offset + 1] === expectedBytes[offset + 1] &&
				actualBytes[offset + 2] === expectedBytes[offset + 2] &&
				actualBytes[offset + 3] === expectedBytes[offset + 3]
			) {
				continue;
			}
			changedPixels++;
			for (let channel = 0; channel < 4; channel++) {
				maxDelta = Math.max(
					maxDelta,
					Math.abs(
						actualBytes[offset + channel] - expectedBytes[offset + channel]
					)
				);
			}
			const x = (offset - start) / 4;
			x0 = Math.min(x0, x);
			y0 = Math.min(y0, y);
			x1 = Math.max(x1, x + 1);
			y1 = Math.max(y1, y + 1);
		}
	}
	return { changedPixels, maxDelta, bbox: [x0, y0, x1, y1] };
}
