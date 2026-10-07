import { describe, expect, it } from "vitest";
import catalog from "../../research/independent-beauty/research/independent-pipeline-catalog.json";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../electron/jianying-portrait-adjustment-runtime/catalog";
import { JIANYING_PORTRAIT_MAKEUP_CARDS } from "../../electron/jianying-portrait-adjustment-runtime/makeup-catalog";
import { beautyMatrixCases, matrixSelection } from "../beauty-lab-matrix-cases";
import { beautyPixelDifference } from "../beauty-lab-matrix-metrics";
import { beautyMatrixGallery } from "../beauty-lab-matrix-gallery";

describe("real-provider matrix plan", () => {
	it("covers every numeric positive and negative boundary using native keys", () => {
		const cases = beautyMatrixCases();
		expect(new Set(cases.map(({ id }) => id)).size).toBe(cases.length);
		for (const control of catalog.controls) {
			const key = `face_adjust_${control.name}`;
			const native = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
				(entry) => entry.key === key
			);
			expect(native, key).toBeDefined();
			expect(
				cases.some(
					({ adjustments, kind }) =>
						kind === "control" &&
						Object.entries(adjustments.values).some(
							([name, value]) => name === key && value === control.max
						)
				)
			).toBe(true);
			if (control.min < 0)
				expect(
					cases.some(
						({ adjustments, kind }) =>
							kind === "control" &&
							Object.entries(adjustments.values).some(
								([name, value]) => name === key && value === control.min
							)
					)
				).toBe(true);
		}
	});
	it("covers all imported makeup cards in their actual native categories", () => {
		const cases = beautyMatrixCases();
		for (const card of catalog.makeup) {
			expect(
				JIANYING_PORTRAIT_MAKEUP_CARDS.some(
					(entry) => entry.id === card.id && entry.category === card.category
				)
			).toBe(true);
			expect(
				cases.some(
					({ id, kind }) => kind === "makeup" && id === `makeup-${card.id}-100`
				)
			).toBe(true);
		}
	});
	it("adds intermediate strength coverage without removing boundary cases", () => {
		const full = beautyMatrixCases({ includeMidpoints: true });
		const boundary = beautyMatrixCases();
		expect(full.length).toBeGreaterThan(boundary.length);
		for (const entry of boundary) expect(full).toContainEqual(entry);
		expect(full.some(({ id }) => id === "control-CutFace--25")).toBe(true);
		expect(full.some(({ id }) => id === "makeup-lip-soft-pink-35")).toBe(true);
	});
	it("stress suites retain zero and cross-stage combinations", () => {
		expect(matrixSelection({ suite: "stress" }).map(({ id }) => id)).toContain(
			"skin-shape-lip"
		);
		expect(matrixSelection({ suite: "shape" }).map(({ id }) => id)).toEqual([
			"zero",
			"shape-features",
			"local-six",
			"face-local",
		]);
	});
	it("includes seven-category makeup and six signed local controls", () => {
		const cases = beautyMatrixCases();
		expect(
			Object.keys(
				cases.find(({ id }) => id === "pigment-seven")?.adjustments.makeup ?? {}
			)
		).toHaveLength(7);
		expect(
			Object.keys(
				cases.find(({ id }) => id === "local-six")?.adjustments.values ?? {}
			)
		).toHaveLength(6);
	});
});

describe("matrix pixel evidence", () => {
	it("computes RGB and alpha differences separately without mutating inputs", () => {
		const left = new Uint8Array([10, 20, 30, 255, 50, 50, 50, 255]);
		const right = new Uint8Array([11, 22, 30, 255, 50, 50, 50, 254]);
		const before = left.slice();
		const { metrics, difference } = beautyPixelDifference({ left, right });
		expect(metrics).toEqual({
			meanRGB: 0.5,
			maximumRGB: 2,
			maximumAlpha: 1,
			changedPixels: 2,
			withinOneRGB: false,
			identity: false,
		});
		expect(difference).toEqual(new Uint8Array([8, 16, 0, 255, 0, 0, 0, 255]));
		expect(left).toEqual(before);
	});
	it("does not classify alpha-only drift as identity or close parity", () => {
		const { metrics } = beautyPixelDifference({
			left: new Uint8Array([0, 0, 0, 255]),
			right: new Uint8Array([0, 0, 0, 254]),
		});
		expect(metrics.maximumRGB).toBe(0);
		expect(metrics.withinOneRGB).toBe(false);
		expect(metrics.identity).toBe(false);
	});
	it("rejects empty, mismatched and partial RGBA buffers", () => {
		for (const [left, right] of [
			[new Uint8Array(), new Uint8Array()],
			[new Uint8Array(4), new Uint8Array(8)],
			[new Uint8Array(3), new Uint8Array(3)],
		])
			expect(() => beautyPixelDifference({ left, right })).toThrow();
	});
	it("keeps one-level RGB drift distinct from pixel identity", () => {
		const { metrics } = beautyPixelDifference({
			left: new Uint8Array([1, 2, 3, 255]),
			right: new Uint8Array([2, 2, 3, 255]),
		});
		expect(metrics.withinOneRGB).toBe(true);
		expect(metrics.identity).toBe(false);
	});
	it("escapes captured worker errors in the gallery", () => {
		const html = beautyMatrixGallery({
			rows: [
				{
					id: "sample--zero",
					inputId: "sample",
					caseId: "zero",
					kind: "zero",
					executed: false,
					inputSha256: "hash",
					milliseconds: 1,
					error: '<script>alert("secret")</script>',
				},
			],
			summary: {
				completed: 1,
				planned: 1,
				executed: 0,
				withinOneRGB: 0,
				outsideOneRGB: 0,
				renderErrors: 1,
			},
		});
		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain('<script>alert("secret")</script>');
		expect(html).toContain('data-state="error"');
	});
});
