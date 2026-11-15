import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectAdjustmentLayers } from "../claude/handlers/claude-export-handler/adjustment-layer-pass.js";
import { readClipColorSettings } from "../claude/handlers/claude-export-handler/clip-color-settings.js";
import { collectExportSegments } from "../claude/handlers/claude-export-handler/export-engine.js";
import type { ClaudeTimeline, MediaFile } from "../types/claude-api.js";
import { materializeVideoCubeLut } from "../ffmpeg/color-lut-file.js";
import {
	readCubeLut,
	readGradeCubeLuts,
	withCubeLutDomain,
} from "../types/color-cube-lut.js";

function identityValues({ size }: { size: number }): number[] {
	const values: number[] = [];
	for (let blue = 0; blue < size; blue += 1) {
		for (let green = 0; green < size; green += 1) {
			for (let red = 0; red < size; red += 1) {
				values.push(red / (size - 1), green / (size - 1), blue / (size - 1));
			}
		}
	}
	return values;
}

describe("a 3D LUT cube as the editor API takes it", () => {
	it("gives a cube without a domain the .cube default, 0..1", () => {
		const cube = readCubeLut({
			value: { size: 2, values: identityValues({ size: 2 }) },
			path: "color.lut.cube",
		});
		expect(cube.domainMin).toEqual([0, 0, 0]);
		expect(cube.domainMax).toEqual([1, 1, 1]);
	});

	it("keeps a domain the cube names", () => {
		const cube = readCubeLut({
			value: {
				size: 2,
				values: identityValues({ size: 2 }),
				domainMin: [0, 0, 0],
				domainMax: [2, 2, 2],
			},
			path: "color.lut.cube",
		});
		expect(cube.domainMax).toEqual([2, 2, 2]);
	});

	it("refuses a cube whose values do not fill its size, with both counts", () => {
		expect(() =>
			readCubeLut({
				value: { size: 3, values: identityValues({ size: 2 }) },
				path: "color.lut.cube",
			})
		).toThrow(
			"color.lut.cube.values must hold 81 numbers (size³ × 3 for size 3); it holds 24"
		);
	});

	it("refuses a size, a value or a domain that is not what it must be", () => {
		const values = identityValues({ size: 2 });
		expect(() =>
			readCubeLut({ value: { size: 2.5, values }, path: "cube" })
		).toThrow("cube.size must be a whole number from 2 to 256 (got 2.5)");
		expect(() => readCubeLut({ value: { size: 2 }, path: "cube" })).toThrow(
			"cube.values must be a list of 24 numbers"
		);
		expect(() =>
			readCubeLut({
				value: { size: 2, values: [...values.slice(0, 23), "1"] },
				path: "cube",
			})
		).toThrow('cube.values[23] must be a number (got "1")');
		expect(() =>
			readCubeLut({
				value: { size: 2, values, domainMin: [0, 0] },
				path: "cube",
			})
		).toThrow("cube.domainMin must be three numbers, like [0, 0, 0]");
		expect(() =>
			readCubeLut({
				value: { size: 2, values, domainMin: [0, 1, 0], domainMax: [1, 1, 1] },
				path: "cube",
			})
		).toThrow(
			"cube.domainMax must be above domainMin on every channel (channel 1: 1..1)"
		);
		expect(() => readCubeLut({ value: [], path: "cube" })).toThrow(
			"cube must be an object"
		);
	});

	it("fills a stored cube's missing domain without copying a complete one", () => {
		const complete = {
			size: 2,
			values: identityValues({ size: 2 }),
			domainMin: [0, 0, 0] as [number, number, number],
			domainMax: [1, 1, 1] as [number, number, number],
		};
		expect(withCubeLutDomain(complete)).toBe(complete);
		const bare = { size: 2, values: complete.values };
		const filled = withCubeLutDomain(bare);
		expect(filled.domainMin).toEqual([0, 0, 0]);
		expect(filled.domainMax).toEqual([1, 1, 1]);
		expect(filled.values).toBe(bare.values);
		expect(bare).not.toHaveProperty("domainMin");
	});
});

describe("the cubes a grade carries", () => {
	const values = identityValues({ size: 2 });

	it("checks the LUT, the skin LUT and LUT passes, and completes each", () => {
		const color = {
			enabled: true,
			lut: {
				enabled: true,
				cube: { size: 2, values },
				dual: { maskKind: "skin-tone-v1", skinCube: { size: 2, values } },
			},
			multiPass: {
				passes: [
					{ kind: "sharpen", amount: 1 },
					{ kind: "lut", intensity: 100, cube: { size: 2, values } },
				],
			},
		};
		const read = readGradeCubeLuts({ color });
		expect(read.lut.cube).toMatchObject({
			domainMin: [0, 0, 0],
			domainMax: [1, 1, 1],
		});
		expect(read.lut.dual.skinCube).toHaveProperty("domainMax", [1, 1, 1]);
		expect(read.multiPass.passes[1].cube).toHaveProperty(
			"domainMin",
			[0, 0, 0]
		);
		// The caller's grade is left as it was given.
		expect(color.lut.cube).not.toHaveProperty("domainMin");
		expect(read.lut.cube.values).toBe(values);
	});

	it("names the cube that is wrong", () => {
		expect(() =>
			readGradeCubeLuts({
				color: {
					multiPass: {
						passes: [{ kind: "lut", cube: { size: 3, values } }],
					},
				},
			})
		).toThrow("color.multiPass.passes[0].cube.values must hold 81 numbers");
	});

	it("returns a grade without cubes untouched", () => {
		const color = { enabled: true, lut: { enabled: false, presetId: "none" } };
		expect(readGradeCubeLuts({ color })).toBe(color);
	});
});

describe("3D LUTs in the native export", () => {
	const values = identityValues({ size: 2 });

	/** 问题 2 (2026-11-14): `reading 'join'` when the cube named no domain. */
	it("writes a .cube file for a cube stored without a domain", () => {
		const filePath = materializeVideoCubeLut({
			name: "no domain",
			cube: { size: 2, values } as never,
			intensity: 100,
			skinProtection: 0,
		});
		const text = readFileSync(filePath, "utf8");
		expect(text).toContain("LUT_3D_SIZE 2");
		expect(text).toContain("DOMAIN_MIN 0 0 0");
		expect(text).toContain("DOMAIN_MAX 1 1 1");
		expect(text.trim().split("\n")).toHaveLength(4 + 8);
	});

	it("says how many values a wrong-sized cube holds", () => {
		expect(() =>
			materializeVideoCubeLut({
				name: "short",
				cube: {
					size: 3,
					values,
					domainMin: [0, 0, 0],
					domainMax: [1, 1, 1],
				},
				intensity: 100,
				skinProtection: 0,
			})
		).toThrow('"short" holds 24 values, size 3 needs 81');
	});

	it("names the clip whose LUT cannot be exported", () => {
		expect(() =>
			readClipColorSettings({
				element: {
					id: "clip-7",
					name: "07 萨满救场",
					colorSettings: {
						enabled: true,
						lut: { enabled: true, cube: { size: 3, values } },
					},
				},
			})
		).toThrow(
			'Clip "07 萨满救场" (clip-7) has a 3D LUT that cannot be exported: color.lut.cube.values must hold 81 numbers (size³ × 3 for size 3); it holds 24'
		);
	});

	it("hands the export a complete cube for a clip stored without a domain", () => {
		const color = readClipColorSettings({
			element: {
				id: "clip-1",
				colorSettings: {
					enabled: true,
					lut: { enabled: true, cube: { size: 2, values } },
				},
			},
		});
		expect(color?.lut.cube).toMatchObject({
			domainMin: [0, 0, 0],
			domainMax: [1, 1, 1],
		});
		expect(readClipColorSettings({ element: { id: "plain" } })).toBeUndefined();
	});

	const badLut = {
		enabled: true,
		lut: { enabled: true, cube: { size: 3, values } },
	};
	const timelineOf = (tracks: Array<Record<string, unknown>>): ClaudeTimeline =>
		({
			name: "LUT export",
			duration: 4,
			width: 320,
			height: 180,
			fps: 24,
			tracks,
		}) as unknown as ClaudeTimeline;

	it("lets the clip's error out of the segment collection instead of an empty export", async () => {
		const mediaFiles: MediaFile[] = [
			{
				id: "media-1",
				name: "clip.mp4",
				type: "video",
				path: "/tmp/clip.mp4",
				size: 1000,
				duration: 10,
				createdAt: 0,
				modifiedAt: 0,
			},
		];
		await expect(
			collectExportSegments({
				mediaFiles,
				timeline: timelineOf([
					{
						id: "main",
						index: 0,
						name: "Main",
						type: "media",
						elements: [
							{
								id: "clip-7",
								name: "07 萨满救场",
								trackIndex: 0,
								type: "media",
								sourceId: "media-1",
								startTime: 0,
								endTime: 2,
								duration: 2,
								colorSettings: badLut,
							},
						],
					},
				]),
			})
		).rejects.toThrow(
			'Clip "07 萨满救场" (clip-7) has a 3D LUT that cannot be exported'
		);
	});

	it("does not fail the export for an adjustment layer that draws nothing", () => {
		const layer = (overrides: Record<string, unknown>) =>
			timelineOf([
				{
					id: "grade",
					index: 0,
					name: "Grade",
					type: "adjustment",
					elements: [
						{
							id: "layer-1",
							name: "Look",
							type: "adjustment",
							startTime: 0,
							endTime: 2,
							colorSettings: badLut,
							...overrides,
						},
					],
				},
			]);
		expect(
			collectAdjustmentLayers({ timeline: layer({ opacity: 0 }) })
		).toEqual([]);
		expect(() =>
			collectAdjustmentLayers({ timeline: layer({ opacity: 1 }) })
		).toThrow('Clip "Look" (layer-1) has a 3D LUT that cannot be exported');
	});
});
