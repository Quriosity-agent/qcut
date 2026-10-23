import { validateGluteSelection } from "./glute-contract.js";

export function emptyEdits() {
	return { backgroundProtection: false, strokes: [] };
}

export function copyEdits({ edits }) {
	return {
		backgroundProtection: edits.backgroundProtection,
		strokes: edits.strokes.map(({ start, end, radius }) => ({ start: [...start], end: [...end], radius })),
		...(Object.hasOwn(edits, "autoButtocks") ? { autoButtocks: edits.autoButtocks } : {}),
		...(edits.buttocks ? { buttocks: validateGluteSelection({ selection: edits.buttocks }) } : {}),
	};
}

export function hasEdits({ edits }) {
	return edits.backgroundProtection || edits.strokes.length > 0 || Boolean(edits.buttocks) ||
		Object.hasOwn(edits, "autoButtocks");
}

function exactKeys({ value, keys }) {
	return value !== null && typeof value === "object" && !Array.isArray(value) &&
		Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function validateEdits({ edits, photo }) {
	const keys = ["backgroundProtection", "strokes", ...(edits && Object.hasOwn(edits, "buttocks") ? ["buttocks"] : []),
		...(edits && Object.hasOwn(edits, "autoButtocks") ? ["autoButtocks"] : [])];
	if (!exactKeys({ value: edits, keys }) ||
		typeof edits.backgroundProtection !== "boolean" || !Array.isArray(edits.strokes) || edits.strokes.length > 32)
		throw new Error("局部调整参数无效，最多保留 32 笔。");
	if (Object.hasOwn(edits, "autoButtocks") && typeof edits.autoButtocks !== "boolean")
		throw new Error("自动提臀定位参数必须为布尔值。");
	if (Object.hasOwn(edits, "buttocks")) validateGluteSelection({ selection: edits.buttocks });
	if (edits.strokes.length > 0 && (!Number.isFinite(photo?.width) || !Number.isFinite(photo?.height) ||
		photo.width <= 0 || photo.height <= 0)) throw new Error("请先载入原图再添加局部调整。");
	for (const stroke of edits.strokes) {
		if (!exactKeys({ value: stroke, keys: ["start", "end", "radius"] }) ||
			!Number.isFinite(stroke.radius) || stroke.radius < 0.02 || stroke.radius > 0.3)
			throw new Error("局部笔刷半径必须为照片短边的 2% 至 30%。");
		for (const point of [stroke.start, stroke.end]) {
			if (!Array.isArray(point) || point.length !== 2 ||
				!point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
				throw new Error("局部调整坐标必须在原图范围内。");
		}
		const distance = Math.hypot((stroke.end[0] - stroke.start[0]) * photo.width,
			(stroke.end[1] - stroke.start[1]) * photo.height);
		if (distance > stroke.radius * Math.min(photo.width, photo.height) * 0.5 + 1e-7)
			throw new Error("单笔移动不能超过笔刷半径的一半。");
	}
	return copyEdits({ edits });
}

export function sameEdits({ left, right, photo }) {
	try {
		const a = validateEdits({ edits: left === undefined ? emptyEdits() : left, photo });
		const b = validateEdits({ edits: right === undefined ? emptyEdits() : right, photo });
		return JSON.stringify(a.buttocks) === JSON.stringify(b.buttocks) &&
			a.autoButtocks === b.autoButtocks &&
			a.backgroundProtection === b.backgroundProtection && a.strokes.length === b.strokes.length &&
			a.strokes.every((stroke, index) => stroke.radius === b.strokes[index].radius &&
				stroke.start.every((value, axis) => value === b.strokes[index].start[axis]) &&
				stroke.end.every((value, axis) => value === b.strokes[index].end[axis]));
	} catch {
		return false;
	}
}

export function clampStroke({ start, end, radius, width, height }) {
	const clippedStart = start.map((value) => Math.max(0, Math.min(1, value)));
	const clippedEnd = end.map((value) => Math.max(0, Math.min(1, value)));
	const distance = Math.hypot((clippedEnd[0] - clippedStart[0]) * width,
		(clippedEnd[1] - clippedStart[1]) * height);
	const maxDistance = radius * Math.min(width, height) * 0.499999;
	const scale = distance > maxDistance ? maxDistance / distance : 1;
	return { start: clippedStart, end: clippedEnd.map((value, axis) =>
		clippedStart[axis] + (value - clippedStart[axis]) * scale), radius };
}

export function imageContentRect({ bounds, width, height }) {
	const scale = Math.min(bounds.width / width, bounds.height / height);
	const contentWidth = width * scale;
	const contentHeight = height * scale;
	return { left: bounds.left + (bounds.width - contentWidth) / 2,
		top: bounds.top + (bounds.height - contentHeight) / 2, width: contentWidth, height: contentHeight };
}

export function pointInImage({ point, rect, clamp = false }) {
	if (!rect.width || !rect.height) return null;
	const x = (point.x - rect.left) / rect.width;
	const y = (point.y - rect.top) / rect.height;
	if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
	return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
}
