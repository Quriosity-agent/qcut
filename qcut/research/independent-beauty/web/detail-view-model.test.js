import { describe, expect, test } from "bun:test";
import { boundedIntensity, controlGroup, differencePixels, pixelComparison, visibleControls } from "./detail-view-model.js";

const controls = [
	{ name: "Whiten", title: "美白", min: 0, max: 100 },
	{ name: "underjaw", title: "双下巴", min: -50, max: 50 },
	{ name: "XiaHeXian", title: "下颌线（阴影与形变）", min: 0, max: 100 },
	{ name: "lip-soft-pink", title: "淡粉口红", min: 0, max: 100 },
];

describe("single effect detail view model", () => {
	test("category and search filtering keeps catalog order and signed controls", () => {
		expect(controls.map((control) => controlGroup({ control }))).toEqual(["skin", "face", "face", "makeup"]);
		expect(visibleControls({ controls, group: "face" })).toEqual(controls.slice(1, 3));
		expect(visibleControls({ controls, group: "face", query: "  xIaHe " })).toEqual([controls[2]]);
		expect(visibleControls({ controls, group: "makeup", query: "口红" })).toEqual([controls[3]]);
		expect(visibleControls({ controls, group: "skin", query: "口红" })).toEqual([]);
	});

	test("integer input clamps each control without turning an incomplete value into zero", () => {
		const control = controls[1];
		expect(boundedIntensity({ value: "-500", control })).toBe(-50);
		expect(boundedIntensity({ value: "500", control })).toBe(50);
		expect(boundedIntensity({ value: "-20", control })).toBe(-20);
		expect(boundedIntensity({ value: "10.8", control })).toBe(11);
		expect(boundedIntensity({ value: "", control, previous: -20 })).toBe(-20);
		expect(boundedIntensity({ value: "-", control, previous: -20 })).toBe(-20);
		expect(boundedIntensity({ value: "Infinity", control, previous: 10 })).toBe(10);
		expect(boundedIntensity({ value: -20, control: controls[0] })).toBe(0);
		expect(boundedIntensity({ value: "0", control })).toBe(0);
	});

	test("activity measures owned versus original independently of native parity", () => {
		const original = Uint8Array.from([20, 30, 40, 255, 50, 60, 70, 255]);
		const owned = Uint8Array.from([30, 30, 40, 255, 50, 60, 70, 255]);
		const metrics = pixelComparison({ original, owned, reference: owned });
		expect(metrics).toEqual({ maximum: 0, mae: 0, changed: 1, total: 2, alphaMaximum: 0, alphaExact: true, passed: true });
		expect(pixelComparison({ original, owned: original, reference: original }).changed).toBe(0);
	});

	test("native gate includes mean RGB error and exact alpha", () => {
		const original = new Uint8Array(100 * 4).fill(255);
		const owned = original.slice(); owned[0] = 254;
		expect(pixelComparison({ original, owned, reference: original }).passed).toBe(true);
		const largerError = original.slice(); largerError[0] = 253;
		expect(pixelComparison({ original, owned: largerError, reference: original }).passed).toBe(false);
		const widespread = original.slice();
		for (let index = 0; index < widespread.length; index += 4) widespread[index] = 254;
		expect(pixelComparison({ original, owned: widespread, reference: original }).passed).toBe(false);
		const alpha = original.slice(); alpha[3] = 254;
		const metrics = pixelComparison({ original, owned: alpha, reference: original });
		expect(metrics.maximum).toBe(0);
		expect(metrics.alphaExact).toBe(false);
		expect(metrics.alphaMaximum).toBe(1);
		expect(metrics.passed).toBe(false);
		expect(metrics.changed).toBe(1);
	});

	test("difference is absolute RGB multiplied by four with display alpha", () => {
		const baseline = Uint8Array.from([100, 100, 100, 255, 255, 0, 10, 255]);
		const owned = Uint8Array.from([101, 90, 200, 250, 0, 10, 10, 200]);
		expect(Array.from(differencePixels({ baseline, owned }))).toEqual([4, 40, 255, 255, 255, 40, 0, 255]);
		expect(Array.from(differencePixels({ baseline: owned, owned }))).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
		expect(Array.from(differencePixels({ baseline, owned, gain: 32 }))).toEqual([32, 255, 255, 255, 255, 255, 0, 255]);
	});

	test("invalid pixel shapes and gain are rejected", () => {
		for (const owned of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(8)]) {
			expect(() => pixelComparison({ original: new Uint8Array(4), owned, reference: new Uint8Array(4) })).toThrow("尺寸");
			expect(() => differencePixels({ baseline: new Uint8Array(4), owned })).toThrow("尺寸");
		}
		expect(() => differencePixels({ baseline: new Uint8Array(4), owned: new Uint8Array(4), gain: 0 })).toThrow("倍率");
	});
});
