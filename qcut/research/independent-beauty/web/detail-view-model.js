const SKIN_CONTROLS = new Set([
	"Smooth",
	"Whiten",
	"SpotAcne",
	"yunfu",
	"fuling",
]);

export function controlGroup({ control }) {
	if (SKIN_CONTROLS.has(control.name)) return "skin";
	return control.name.includes("-") ? "makeup" : "face";
}

export function visibleControls({ controls, group, query = "" }) {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	return controls.filter(
		(control) =>
			controlGroup({ control }) === group &&
			`${control.title} ${control.name}`
				.toLocaleLowerCase()
				.includes(normalizedQuery)
	);
}

export function boundedIntensity({ value, control, previous = 0 }) {
	const number =
		typeof value === "string" && value.trim() === "" ? NaN : Number(value);
	const candidate = Number.isFinite(number) ? Math.round(number) : previous;
	return Math.min(control.max, Math.max(control.min, candidate)) || 0;
}

function matchingPixels({ arrays }) {
	const length = arrays[0]?.length;
	if (
		!length ||
		length % 4 !== 0 ||
		arrays.some((array) => array.length !== length)
	) {
		throw new Error("对比图片尺寸不一致，请重新计算");
	}
	return length;
}

export function pixelComparison({ original, owned, reference }) {
	const length = matchingPixels({ arrays: [original, owned, reference] });
	let maximum = 0,
		absolute = 0,
		changed = 0,
		alphaMaximum = 0;
	for (let index = 0; index < length; index += 4) {
		let pixelChanged = false;
		for (let channel = 0; channel < 3; channel++) {
			const delta = Math.abs(
				owned[index + channel] - reference[index + channel]
			);
			maximum = Math.max(maximum, delta);
			absolute += delta;
			pixelChanged ||= owned[index + channel] !== original[index + channel];
		}
		alphaMaximum = Math.max(
			alphaMaximum,
			Math.abs(owned[index + 3] - reference[index + 3])
		);
		if (pixelChanged || owned[index + 3] !== original[index + 3]) changed++;
	}
	const total = length / 4;
	const mae = absolute / (total * 3);
	return {
		maximum,
		mae,
		changed,
		total,
		alphaMaximum,
		alphaExact: alphaMaximum === 0,
		passed: maximum <= 1 && mae <= 0.025 && alphaMaximum === 0,
	};
}

export function differencePixels({ baseline, owned, gain = 4 }) {
	const length = matchingPixels({ arrays: [baseline, owned] });
	if (!Number.isFinite(gain) || gain <= 0)
		throw new Error("差异倍率必须大于零");
	const difference = new Uint8ClampedArray(length);
	for (let index = 0; index < length; index += 4) {
		for (let channel = 0; channel < 3; channel++) {
			difference[index + channel] =
				Math.abs(owned[index + channel] - baseline[index + channel]) * gain;
		}
		difference[index + 3] = 255;
	}
	return difference;
}
