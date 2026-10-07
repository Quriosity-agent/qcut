export function beautyPixelDifference({
	left,
	right,
}: {
	left: Uint8Array;
	right: Uint8Array;
}) {
	if (!left.length || left.length !== right.length || left.length % 4)
		throw new Error("Matching nonempty RGBA frames required");
	const difference = new Uint8Array(left.length);
	let totalRGB = 0,
		maximumRGB = 0,
		maximumAlpha = 0,
		changedPixels = 0;
	for (let index = 0; index < left.length; index += 4) {
		let changed = false;
		for (let channel = 0; channel < 3; channel++) {
			const delta = Math.abs(left[index + channel] - right[index + channel]);
			totalRGB += delta;
			maximumRGB = Math.max(maximumRGB, delta);
			difference[index + channel] = Math.min(255, delta * 8);
			changed ||= delta !== 0;
		}
		const alpha = Math.abs(left[index + 3] - right[index + 3]);
		maximumAlpha = Math.max(maximumAlpha, alpha);
		if (changed || alpha) changedPixels++;
		difference[index + 3] = 255;
	}
	return {
		difference,
		metrics: {
			meanRGB: totalRGB / ((left.length / 4) * 3),
			maximumRGB,
			maximumAlpha,
			changedPixels,
			withinOneRGB: maximumRGB <= 1 && maximumAlpha === 0,
			identity: changedPixels === 0,
		},
	};
}
