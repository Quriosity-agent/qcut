import { describe, expect, it } from "vitest";
import {
	applySimilarity,
	fitSimilarity,
	type PlanePoint,
	type SimilarityTransform,
} from "../similarity-fit";

const grid: PlanePoint[] = [];
for (let y = 0; y < 5; y += 1) {
	for (let x = 0; x < 5; x += 1) grid.push({ x: x * 40 + 10, y: y * 30 + 20 });
}

describe("fitSimilarity", () => {
	it("recovers an exact similarity from clean correspondences", () => {
		const truth: SimilarityTransform = {
			scale: 1.02,
			rotation: 0.03,
			translationX: -7.5,
			translationY: 4.25,
		};
		const to = grid.map((point) =>
			applySimilarity({ transform: truth, point })
		);
		const fitted = fitSimilarity({ from: grid, to });
		expect(fitted).not.toBeNull();
		expect(fitted?.scale).toBeCloseTo(truth.scale, 10);
		expect(fitted?.rotation).toBeCloseTo(truth.rotation, 10);
		expect(fitted?.translationX).toBeCloseTo(truth.translationX, 8);
		expect(fitted?.translationY).toBeCloseTo(truth.translationY, 8);
	});

	it("returns the identity for identical point sets", () => {
		const fitted = fitSimilarity({ from: grid, to: grid });
		expect(fitted?.scale).toBeCloseTo(1, 12);
		expect(fitted?.rotation).toBeCloseTo(0, 12);
		expect(fitted?.translationX).toBeCloseTo(0, 10);
		expect(fitted?.translationY).toBeCloseTo(0, 10);
	});

	it("stays close to the truth under zero-mean noise", () => {
		const truth: SimilarityTransform = {
			scale: 1,
			rotation: 0,
			translationX: 3,
			translationY: -2,
		};
		let seed = 12345;
		const noise = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			return ((seed >>> 8) / 16777216 - 0.5) * 1;
		};
		const to = grid.map((point) => {
			const moved = applySimilarity({ transform: truth, point });
			return { x: moved.x + noise(), y: moved.y + noise() };
		});
		const fitted = fitSimilarity({ from: grid, to });
		expect(Math.abs((fitted?.translationX ?? 0) - 3)).toBeLessThan(0.25);
		expect(Math.abs((fitted?.translationY ?? 0) + 2)).toBeLessThan(0.25);
		expect(Math.abs(fitted?.rotation ?? 1)).toBeLessThan(0.003);
		expect(Math.abs((fitted?.scale ?? 0) - 1)).toBeLessThan(0.005);
	});

	it("rejects degenerate input", () => {
		expect(
			fitSimilarity({ from: [{ x: 1, y: 1 }], to: [{ x: 2, y: 2 }] })
		).toBeNull();
		expect(
			fitSimilarity({
				from: [
					{ x: 1, y: 1 },
					{ x: 1, y: 1 },
				],
				to: [
					{ x: 2, y: 2 },
					{ x: 3, y: 3 },
				],
			})
		).toBeNull();
	});
});
