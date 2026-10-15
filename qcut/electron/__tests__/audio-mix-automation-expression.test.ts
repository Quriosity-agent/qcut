import { describe, expect, it } from "vitest";
import {
	automatedLevelFilters,
	automatedPanFilters,
	automationExpression,
} from "../ffmpeg/audio-mix-automation";

/** The FFmpeg expression for a curve: what the real-render tests hear, in text. */

/** Evaluates the expression's if/lt/gte arithmetic the way FFmpeg would. */
function evaluate(expression: string, t: number): number {
	const js = expression
		.replace(/if\(/g, "IF(")
		.replace(/lt\(/g, "LT(")
		.replace(/gte\(/g, "GTE(");
	const IF = (c: number, a: number, b: number) => (c ? a : b);
	const LT = (a: number, b: number) => (a < b ? 1 : 0);
	const GTE = (a: number, b: number) => (a >= b ? 1 : 0);
	// A test-only evaluator for arithmetic the test itself built.
	return new Function("IF", "LT", "GTE", "t", `return ${js};`)(IF, LT, GTE, t);
}

describe("automation expressions", () => {
	it("is a constant for one point", () => {
		expect(automationExpression([{ time: 3, value: -6 }])).toBe("(-6)");
	});

	it("holds outside the curve and ramps inside it", () => {
		const expression = automationExpression([
			{ time: 1, value: 0 },
			{ time: 2, value: -12 },
			{ time: 4, value: -12 },
			{ time: 5, value: 6 },
		]);
		expect(evaluate(expression, 0)).toBe(0);
		expect(evaluate(expression, 1.5)).toBeCloseTo(-6, 10);
		expect(evaluate(expression, 3)).toBe(-12);
		expect(evaluate(expression, 4.5)).toBeCloseTo(-3, 10);
		expect(evaluate(expression, 9)).toBe(6);
	});

	it("nests segments as a balanced tree so long curves stay shallow", () => {
		const points = Array.from({ length: 65 }, (_, index) => ({
			time: index,
			value: index % 2 === 0 ? 0 : -10,
		}));
		const expression = automationExpression(points);
		const depth = Math.max(
			...expression.split("").map((_, index) => {
				const prefix = expression.slice(0, index);
				return (
					(prefix.match(/if\(/g) ?? []).length -
					(prefix.match(/\)/g) ?? []).length
				);
			})
		);
		expect(depth).toBeLessThan(12);
		expect(evaluate(expression, 10.5)).toBeCloseTo(-5, 10);
	});

	it("re-reads the level every 10 ms frame and pans with the editor's law", () => {
		expect(automatedLevelFilters([{ time: 0, value: -6 }])).toEqual([
			"asetnsamples=n=480:p=0",
			"volume=volume='pow(10,((-6))/20)':eval=frame",
		]);
		const [format, pan] = automatedPanFilters([{ time: 0, value: 0 }]);
		expect(format).toBe("aformat=channel_layouts=stereo");
		expect(pan).toContain("cos((ld(0)+1)*PI/2)");
		expect(pan).toContain("sin(ld(0)*PI/2)");
	});
});
