export function validateGluteSelection({ selection }) {
	const exact = ({ value, keys }) => value && typeof value === "object" && !Array.isArray(value) &&
		Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
	if (!exact({ value: selection, keys: ["view", "anchors"] }) ||
		!["side-left", "side-right", "rear"].includes(selection.view) || !Array.isArray(selection.anchors) ||
		selection.anchors.length !== (selection.view === "rear" ? 2 : 1))
		throw new Error("侧面需要一组臀峰与臀下缘，背面需要左右两组。");
	const anchors = selection.anchors.map((anchor) => {
		if (!exact({ value: anchor, keys: ["peak", "fold"] })) throw new Error("臀部定位点无效。");
		for (const point of [anchor.peak, anchor.fold]) {
			if (!Array.isArray(point) || point.length !== 2 ||
				!point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
				throw new Error("臀部定位点必须在原图内部。");
		}
		if (anchor.fold[1] <= anchor.peak[1]) throw new Error("臀下缘必须位于臀峰下方。");
		return { peak: [...anchor.peak], fold: [...anchor.fold] };
	});
	if (selection.view === "rear") {
		anchors.sort((left, right) => left.peak[0] - right.peak[0]);
		if (anchors[0].peak[0] >= anchors[1].peak[0] || anchors[0].fold[0] >= anchors[1].fold[0])
			throw new Error("背面左右两组定位点不能重叠或交叉。");
	}
	return { view: selection.view, anchors };
}

export function automaticGluteDetection({ photo }) {
	if (!photo || !Object.hasOwn(photo, "buttocksDetection")) return null;
	const detection = photo.buttocksDetection;
	const unavailable = { available: false, reason: typeof detection?.reason === "string" && detection.reason.trim()
		? detection.reason : "没有获得可靠的臀部轮廓，请展开手动校正。" };
	if (detection?.available !== true) return unavailable;
	try {
		return { available: true, selection: validateGluteSelection({ selection: detection.selection }),
			...(Number.isFinite(detection.confidence) && detection.confidence >= 0 && detection.confidence <= 1
				? { confidence: detection.confidence } : {}) };
	} catch {
		return { available: false, reason: "自动定位点无效，请展开手动校正。" };
	}
}
