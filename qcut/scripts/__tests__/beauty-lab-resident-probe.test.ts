import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BeautyLabIndependentResult } from "../../electron/beauty-lab/beauty-lab-independent-contract";
import {
	comparePixels,
	cropVertical,
	encodePng,
	exactOutput,
	median,
	readFrame,
	residentIdentity,
	serial,
	type ProbeFrame,
} from "../beauty-lab-resident-probe-utils";

function result({
	png = new Uint8Array([1]),
	rgba = new Uint8Array([1, 2, 3, 255]),
	report = {},
}: {
	png?: Uint8Array;
	rgba?: Uint8Array;
	report?: Record<string, unknown>;
} = {}): BeautyLabIndependentResult {
	return {
		provider: "qcut-independent-photo-v1",
		requestId: "probe",
		sourceKey: "source",
		width: 1,
		height: 1,
		rgba,
		png,
		report,
		inputSha256: "input",
		outputSha256: "output",
	};
}

describe("resident probe evidence", () => {
	it("keeps byte identity stricter than a native one-RGB gate", () => {
		const source = result(),
			changed = result({ rgba: new Uint8Array([2, 2, 3, 255]) });
		expect(exactOutput({ actual: changed, expected: source }).rgbaEqual).toBe(
			false
		);
		expect(
			comparePixels({ actual: changed, expected: source }).metrics
		).toMatchObject({
			maximumRGB: 1,
			maximumAlpha: 0,
			changedPixels: 1,
			withinOneRgb: true,
		});
		expect(
			exactOutput({
				actual: result({ png: new Uint8Array([2]) }),
				expected: source,
			})
		).toEqual({ rgbaEqual: true, pngEqual: false, dimensionsEqual: true });
	});
	it("rejects mismatched geometry and includes alpha in the native gate", () => {
		const source = result(),
			changed = result({ rgba: new Uint8Array([1, 2, 3, 254]) });
		expect(
			comparePixels({ actual: changed, expected: source }).metrics
		).toMatchObject({ maximumRGB: 0, maximumAlpha: 1, withinOneRgb: false });
		expect(() =>
			comparePixels({ actual: { ...changed, width: 2 }, expected: source })
		).toThrow("dimensions");
	});
	it("binds real crash injection to a valid resident process receipt", () => {
		for (const pid of [0, -5, 1, "123", 12.5])
			expect(() =>
				residentIdentity({
					result: result({ report: { residentRuntime: { pid } } }),
				})
			).toThrow("process id");
		expect(
			residentIdentity({
				result: result({
					report: { residentRuntime: { pid: 123, sessionCache: { hits: 8 } } },
				}),
			})
		).toMatchObject({ pid: 123, sessionCache: { hits: 8 } });
	});
	it("loads PNG pixels exactly and rejects alpha instead of flattening", async () => {
		const directory = await mkdtemp(
			path.join(os.tmpdir(), "beauty-probe-tests-")
		);
		try {
			const file = path.join(directory, "photo.png");
			const frame: ProbeFrame = {
				width: 2,
				height: 1,
				rgba: new Uint8Array([11, 22, 33, 255, 33, 22, 11, 255]),
			};
			await writeFile(file, encodePng({ frame }));
			expect((await readFrame({ file, maxEdge: 1280 })).rgba).toEqual(
				frame.rgba
			);
			frame.rgba[7] = 254;
			await writeFile(file, encodePng({ frame }));
			await expect(readFrame({ file, maxEdge: 1280 })).rejects.toThrow(
				"opaque"
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("records a centered aspect-preserving 9:16 crop and keeps source untouched", () => {
		const rgba = new Uint8Array(1200 * 2000 * 4).fill(255);
		const cropped = cropVertical({
			frame: { width: 1200, height: 2000, rgba },
		});
		expect(cropped.crop).toMatchObject({
			left: 37.5,
			top: 0,
			width: 1125,
			height: 2000,
			resizedTo: [1080, 1920],
		});
		expect(cropped.rgba.length).toBe(1080 * 1920 * 4);
		expect(rgba.every((value) => value === 255)).toBe(true);
	});
	it("serializes real provider jobs and summarizes both odd and even runs", async () => {
		const order: number[] = [];
		await serial({
			entries: [1, 2, 3],
			run: async (value) => {
				order.push(value);
				await Promise.resolve();
				order.push(value * 10);
			},
		});
		expect(order).toEqual([1, 10, 2, 20, 3, 30]);
		expect(median({ values: [9, 1, 3] })).toBe(3);
		expect(median({ values: [9, 1] })).toBe(5);
	});
});
