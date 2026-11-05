export function rgbBounds({
	frame,
	width,
	height,
	matches,
}: {
	frame: Uint8Array;
	width: number;
	height: number;
	matches: (pixel: { r: number; g: number; b: number }) => boolean;
}) {
	let left = width;
	let right = -1;
	let top = height;
	let bottom = -1;
	let count = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * 3;
			if (!matches({ r: frame[at], g: frame[at + 1], b: frame[at + 2] }))
				continue;
			left = Math.min(left, x);
			right = Math.max(right, x);
			top = Math.min(top, y);
			bottom = Math.max(bottom, y);
			count++;
		}
	}
	return { left, right, top, bottom, count };
}
