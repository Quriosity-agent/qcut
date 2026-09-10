import { describe, expect, it } from "vitest";
import {
	constrainMotion,
	type MotionConstraint,
	type RigidTransform,
} from "../lens-motion-constraint";

// Goldens mirror research/independent-lens-contract/motion_constraint_tests.cpp.
const square: MotionConstraint = {
	width: 100,
	height: 100,
	center: { x: 50, y: 50 },
	minimumScale: 0.2,
};

function run(constraint: MotionConstraint, input: RigidTransform) {
	const output = constrainMotion({ constraint, input });
	expect(output).not.toBeNull();
	return output as RigidTransform;
}

describe("lens motion constraint", () => {
	it("crops before translating and treats the last pixel as inclusive", () => {
		const output = run(square, {
			translationX: 100,
			translationY: -100,
			degrees: 0,
			scale: 0.5,
		});
		expect(output.translationX).toBe(24.5);
		expect(output.translationY).toBe(-25);
		expect(output.scale).toBe(0.5);
	});

	it("clamps the scale into [minimum, 1]", () => {
		expect(
			run(square, { translationX: 0, translationY: 0, degrees: 0, scale: -4 })
				.scale
		).toBe(Math.fround(0.2));
		expect(
			run(square, { translationX: 0, translationY: 0, degrees: 0, scale: 4 })
				.scale
		).toBe(1);
	});

	it("skips clipping for a degenerate polygon but still clamps scale", () => {
		const output = run(
			{ width: 1, height: 4, center: { x: 0.5, y: 2 }, minimumScale: 0.2 },
			{ translationX: 4, translationY: 8, degrees: 45, scale: 0 }
		);
		expect(output.translationX).toBe(4);
		expect(output.translationY).toBe(8);
		expect(output.degrees).toBe(45);
		expect(output.scale).toBe(Math.fround(0.2));
	});

	it("passes values inside the epsilon band through unchanged", () => {
		const epsilon = Math.fround(1.0e-5);
		for (const value of [-epsilon, -0, 0, epsilon]) {
			const output = run(square, {
				translationX: value,
				translationY: value,
				degrees: value,
				scale: 1,
			});
			expect(Object.is(output.translationX, value)).toBe(true);
			expect(Object.is(output.translationY, value)).toBe(true);
			expect(Object.is(output.degrees, value)).toBe(true);
		}
		const next = Math.fround(1.0e-5) + 2 ** -40;
		expect(
			run(square, { translationX: next, translationY: 0, degrees: 0, scale: 1 })
				.translationX
		).toBe(0);
	});

	it("bisects the rotation and orders centre before translation", () => {
		const output = run(square, {
			translationX: 100,
			translationY: -100,
			degrees: 45,
			scale: 0.8,
		});
		expect(Math.abs(output.degrees - 16.61317444)).toBeLessThan(1e-4);
		expect(Math.abs(output.translationX - -0.00001525878906)).toBeLessThan(
			1e-4
		);
		expect(Math.abs(output.translationY - -0.2333755493)).toBeLessThan(1e-4);
	});

	it("handles an off-axis centre", () => {
		const output = run(
			{ width: 257, height: 145, center: { x: 80, y: 50 }, minimumScale: 0.2 },
			{ translationX: 500, translationY: -200, degrees: 23, scale: 0.7 }
		);
		expect(Math.abs(output.degrees - 14.19368362)).toBeLessThan(1e-4);
		expect(Math.abs(output.translationX - 47.97898865)).toBeLessThan(1e-4);
		expect(Math.abs(output.translationY - -2.337230682)).toBeLessThan(1e-4);
	});

	it("rejects out-of-domain requests instead of guessing", () => {
		const input = { translationX: 0, translationY: 0, degrees: 0, scale: 1 };
		expect(
			constrainMotion({ constraint: { ...square, width: 0 }, input })
		).toBeNull();
		expect(
			constrainMotion({ constraint: { ...square, minimumScale: 0 }, input })
		).toBeNull();
		expect(
			constrainMotion({
				constraint: { ...square, center: { x: 101, y: 50 } },
				input,
			})
		).toBeNull();
		expect(
			constrainMotion({ constraint: square, input: { ...input, degrees: 181 } })
		).toBeNull();
		expect(
			constrainMotion({ constraint: square, input: { ...input, scale: 4.5 } })
		).toBeNull();
		expect(
			constrainMotion({
				constraint: square,
				input: { ...input, translationX: Number.NaN },
			})
		).toBeNull();
	});
});
