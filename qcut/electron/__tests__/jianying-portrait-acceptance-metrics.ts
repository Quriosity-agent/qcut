import assert from "node:assert/strict";
import type { JianyingPortraitDetectedFace } from "../jianying-portrait-adjustment-contract";
import { compareRgbaPixels } from "../beauty-lab-rgba-metrics";

export function fixedGainDifference({
	actual,
	expected,
	width,
	height,
}: {
	actual: Uint8Array;
	expected: Uint8Array;
	width: number;
	height: number;
}) {
	compareRgbaPixels({ actual, expected, width, height });
	const pixels = new Uint8Array(actual.length);
	for (let offset = 0; offset < actual.length; offset += 4) {
		const value = Math.min(
			255,
			8 *
				Math.max(
					...[0, 1, 2].map((channel) =>
						Math.abs(actual[offset + channel] - expected[offset + channel])
					)
				)
		);
		pixels.set([value, value, value, 255], offset);
	}
	return pixels;
}

export function faceSpecificity({
	actual,
	original,
	faces,
	selectedIds,
	width,
	height,
}: {
	actual: Uint8Array;
	original: Uint8Array;
	faces: JianyingPortraitDetectedFace[];
	selectedIds: string[];
	width: number;
	height: number;
}) {
	const effect = compareRgbaPixels({
		actual,
		expected: original,
		width,
		height,
	});
	assert(
		faces.length >= 2 && faces.length <= 5,
		"Specificity requires 2..5 detected faces"
	);
	assert(
		new Set(faces.map(({ personBindingId }) => personBindingId)).size ===
			faces.length,
		"Duplicate person binding"
	);
	assert(
		new Set(faces.map(({ trackId }) => trackId)).size === faces.length,
		"Duplicate track ID"
	);
	assert(
		selectedIds.length > 0 &&
			selectedIds.every((id) =>
				faces.some(({ personBindingId }) => id === personBindingId)
			),
		"Unknown selected identity"
	);
	const regions = faces.map((face) => {
		const { x, y, width: w, height: h } = face.rect;
		assert(
			[x, y, w, h].every(Number.isFinite) &&
				x >= 0 &&
				y >= 0 &&
				w > 0 &&
				h > 0 &&
				x + w <= 1 &&
				y + h <= 1,
			"Invalid normalized face box"
		);
		const box = [
			Math.floor(x * width),
			// Raw FaceBuffer rectangles are bottom-left; decoded RGBA rows are top-left.
			Math.floor((1 - (y + h)) * height),
			Math.ceil((x + w) * width),
			Math.ceil((1 - y) * height),
		];
		let changedPixels = 0;
		for (let row = box[1]; row < box[3]; row++) {
			for (let column = box[0]; column < box[2]; column++) {
				const offset = (row * width + column) * 4;
				if (
					[0, 1, 2, 3].some(
						(channel) => actual[offset + channel] !== original[offset + channel]
					)
				)
					changedPixels++;
			}
		}
		return {
			personBindingId: face.personBindingId,
			trackId: face.trackId,
			freidTrackId: face.freidTrackId,
			box,
			selected: selectedIds.includes(face.personBindingId),
			changedPixels,
		};
	});
	assert(
		regions.every((region, index) =>
			regions
				.slice(index + 1)
				.every(
					(other) =>
						region.box[2] <= other.box[0] ||
						other.box[2] <= region.box[0] ||
						region.box[3] <= other.box[1] ||
						other.box[3] <= region.box[1]
				)
		),
		"Overlapping face boxes cannot prove isolated specificity"
	);
	const violations = regions.flatMap(({ selected, changedPixels }) =>
		selected
			? changedPixels === 0
				? ["selected-face-no-op"]
				: []
			: changedPixels > 0
				? ["unselected-face-changed"]
				: []
	);
	const outsideFaceChangedPixels =
		effect.changedPixels -
		regions.reduce((sum, { changedPixels }) => sum + changedPixels, 0);
	if (outsideFaceChangedPixels > 0) violations.push("outside-face-changed");
	if (
		actual.some((value, index) => index % 4 === 3 && value !== original[index])
	)
		violations.push("alpha-changed");
	return {
		effect,
		regions,
		outsideFaceChangedPixels,
		coordinateSpaces: {
			nativeRect: "normalized-bottom-left",
			rgba: "top-left",
		},
		violations,
		passed: violations.length === 0,
		scope:
			"static-frame detected boxes and anchored project IDs; not semantic identity or multi-face motion acceptance",
	};
}
