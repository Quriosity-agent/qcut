import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import { ComposeFilterStackError } from "../native-pipeline/compose/compose-filter-stack-resolver.js";
import {
	NO_PRESET_FILTER,
	elementColor,
	elementFilter,
} from "../native-pipeline/editor/editor-handlers-element-grade.js";

/** A client that records PATCH bodies and serves one timeline snapshot. */
function fakeClient({ timeline }: { timeline?: unknown } = {}) {
	const patches: Array<{ path: string; body: unknown }> = [];
	const client = {
		get: vi.fn(async (path: string) => {
			if (path.startsWith("/api/claude/timeline/")) return timeline;
			throw new Error(`Unexpected GET ${path}`);
		}),
		patch: vi.fn(async (path: string, body: unknown) => {
			patches.push({ path, body });
			if (path.endsWith("/elements/batch")) {
				const updates = (body as { updates: unknown[] }).updates;
				return {
					updatedCount: updates.length,
					failedCount: 0,
					results: updates.map((_, index) => ({ index, success: true })),
				};
			}
			return { updated: true };
		}),
	} as unknown as EditorApiClient;
	return { client, patches };
}

function opts(overrides: Partial<CLIRunOptions>): CLIRunOptions {
	return {
		command: "editor:element:color",
		projectId: "p1",
		outputDir: "./output",
		json: true,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		...overrides,
	} as CLIRunOptions;
}

describe("editor element color", () => {
	it("needs a target and at least one control", async () => {
		const { client } = fakeClient();
		expect(await elementColor(client, opts({ elementId: "e1" }))).toMatchObject(
			{ success: false, error: expect.stringContaining("--reset") }
		);
		expect(await elementColor(client, opts({ contrast: 20 }))).toMatchObject({
			success: false,
			error: expect.stringContaining("--element-id"),
		});
	});

	it("patches one clip's grade with the colour panel's basic controls", async () => {
		const { client, patches } = fakeClient();
		const result = await elementColor(
			client,
			opts({ elementId: "e1", contrast: 20, saturation: -35, temperature: -25 })
		);
		expect(result.success).toBe(true);
		expect(patches).toEqual([
			{
				path: "/api/claude/timeline/p1/elements/e1",
				body: {
					color: {
						enabled: true,
						basic: {
							enabled: true,
							contrast: 20,
							saturation: -35,
							temperature: -25,
						},
					},
				},
			},
		]);
	});

	it("grades every video clip on a track in one batch, and --reset zeroes the controls", async () => {
		const { client, patches } = fakeClient({
			timeline: {
				tracks: [
					{
						id: "main",
						elements: [
							{ id: "a", type: "media" },
							{ id: "t", type: "text" },
							{ id: "b", type: "media" },
						],
					},
				],
			},
		});
		const result = await elementColor(
			client,
			opts({ trackId: "main", reset: true })
		);
		expect(result.success).toBe(true);
		expect(result.data).toMatchObject({ elementIds: ["a", "b"], updated: 2 });
		expect(patches).toHaveLength(1);
		expect(patches[0].path).toBe("/api/claude/timeline/p1/elements/batch");
		const updates = (
			patches[0].body as {
				updates: Array<{
					elementId: string;
					changes: { color: { basic: Record<string, number | boolean> } };
				}>;
			}
		).updates;
		expect(updates.map((u) => u.elementId)).toEqual(["a", "b"]);
		expect(updates[0].changes.color.basic).toMatchObject({
			enabled: true,
			exposure: 0,
			contrast: 0,
			vignette: 0,
		});
	});
});

describe("editor element filter", () => {
	const effect = {
		id: "filter-x-1",
		enabled: true,
		resourceId: "7596691154008132915",
		version: "abc",
		intensity: 70,
		implementation: "lut",
		fidelity: "lut" as const,
		color: { lut: { enabled: true, cube: { size: 2 } } },
	};

	it("resolves the resource id and patches the clip's filter stack", async () => {
		const { client, patches } = fakeClient();
		const resolve = vi.fn(async () => ({ effects: [effect], warnings: [] }));
		const result = await elementFilter(
			client,
			opts({
				command: "editor:element:filter",
				elementId: "e1",
				resourceIds: ["7596691154008132915"],
				intensity: 70,
			}),
			{ resolve }
		);
		expect(result.success).toBe(true);
		expect(resolve).toHaveBeenCalledTimes(1);
		const steps = resolve.mock.calls[0][0].steps;
		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({
			asset: { assetId: "7596691154008132915", assetType: "filter" },
			intensity: 70,
			enabled: true,
		});
		// Filter stacks carry LUT cubes, so they always take the batch route (64 MB cap).
		expect(patches[0].path).toBe("/api/claude/timeline/p1/elements/batch");
		expect(patches[0].body).toEqual({
			updates: [
				{
					elementId: "e1",
					changes: { filterStack: { enabled: true, effects: [effect] } },
				},
			],
		});
		expect(result.data).toMatchObject({
			effects: [{ resourceId: "7596691154008132915", intensity: 70 }],
		});
	});

	it("falls back to QCut's own catalogue for an id the Jianying catalogue lacks", async () => {
		const { client } = fakeClient();
		const resolve = vi.fn(
			async ({ dependencies }: { dependencies?: unknown }) => {
				if (!dependencies) {
					throw new ComposeFilterStackError({
						code: "filter-not-catalogued",
						resourceId: "7160594413847203085",
						message: "not in the Jianying catalogue",
					});
				}
				return { effects: [effect], warnings: [] };
			}
		);
		const result = await elementFilter(
			client,
			opts({
				command: "editor:element:filter",
				elementId: "e1",
				resourceIds: ["7160594413847203085"],
			}),
			{ resolve }
		);
		expect(result.success).toBe(true);
		expect(resolve).toHaveBeenCalledTimes(2);
		expect(resolve.mock.calls[1][0].dependencies).toBeDefined();
	});

	it("appends to the clip's existing stack and --clear empties it", async () => {
		const existing = { ...effect, id: "old" };
		const { client, patches } = fakeClient({
			timeline: {
				tracks: [
					{
						id: "main",
						elements: [
							{ id: "e1", type: "media", filterStack: { effects: [existing] } },
						],
					},
				],
			},
		});
		const resolve = vi.fn(async () => ({ effects: [effect], warnings: [] }));
		await elementFilter(
			client,
			opts({
				command: "editor:element:filter",
				elementId: "e1",
				resourceIds: ["7596691154008132915"],
				append: true,
			}),
			{ resolve }
		);
		expect(patches[0].body).toEqual({
			updates: [
				{
					elementId: "e1",
					changes: {
						filterStack: { enabled: true, effects: [existing, effect] },
					},
				},
			],
		});
		await elementFilter(
			client,
			opts({ command: "editor:element:filter", elementId: "e1", clear: true }),
			{ resolve }
		);
		expect(patches[1].body).toEqual({
			updates: [
				{
					elementId: "e1",
					changes: { filterStack: { enabled: false, effects: [] } },
				},
			],
		});
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it("refuses an intensity outside 0–100", async () => {
		const { client } = fakeClient();
		expect(
			await elementFilter(
				client,
				opts({
					command: "editor:element:filter",
					elementId: "e1",
					resourceIds: ["1"],
					intensity: 140,
				})
			)
		).toMatchObject({
			success: false,
			error: expect.stringContaining("0 and 100"),
		});
	});
});

/** 问题 5 (2026-11-14): a custom LUT had no entry but hand-built JSON in --set. */
describe("editor element color --lut-file", () => {
	const dir = mkdtempSync(join(tmpdir(), "qcut-lut-file-"));
	const cubeRows = ({ size }: { size: number }) => {
		const rows: string[] = [];
		for (let blue = 0; blue < size; blue += 1) {
			for (let green = 0; green < size; green += 1) {
				for (let red = 0; red < size; red += 1) {
					rows.push(
						`${red / (size - 1)} ${green / (size - 1)} ${blue / (size - 1)}`
					);
				}
			}
		}
		return rows;
	};
	const writeCube = ({
		name,
		lines,
	}: {
		name: string;
		lines: string[];
	}): string => {
		const filePath = join(dir, name);
		writeFileSync(filePath, `${lines.join("\n")}\n`);
		return filePath;
	};
	const twoPoint = writeCube({
		name: "warm.cube",
		lines: [
			"# made by a grading tool",
			'TITLE "Warm show grade"',
			"LUT_3D_SIZE 2",
			...cubeRows({ size: 2 }),
		],
	});

	it("puts a .cube file on one clip as its custom LUT", async () => {
		const { client, patches } = fakeClient();
		const result = await elementColor(
			client,
			opts({ elementId: "e1", lutFile: twoPoint })
		);
		expect(result.success).toBe(true);
		expect(patches).toHaveLength(1);
		const body = patches[0].body as {
			color: {
				enabled: boolean;
				lut: Record<string, unknown> & { cube: { values: number[] } };
			};
		};
		expect(body.color.enabled).toBe(true);
		expect(body.color.lut).toMatchObject({
			enabled: true,
			presetId: "custom",
			name: "Warm show grade",
			intensity: 100,
			cube: { size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] },
		});
		// .cube order: red changes fastest.
		expect(body.color.lut.cube.values.slice(0, 6)).toEqual([0, 0, 0, 1, 0, 0]);
		expect(body.color.lut.cube.values).toHaveLength(24);
		// The answer counts the cube's values instead of printing them.
		expect(
			(result.data as { color: { lut: { cube: unknown } } }).color.lut.cube
		).toEqual({
			size: 2,
			domainMin: [0, 0, 0],
			domainMax: [1, 1, 1],
			valueCount: 24,
		});
	});

	it("takes a built-in preset off the clip when it sets or removes a LUT", async () => {
		// The preset is rendered in the LUT's place; left on, it would hide the
		// LUT the command just set (and keep showing after --lut-clear).
		const { DEFAULT_COLOR_FILTER_APPLICATION } = await import(
			"../../apps/web/src/lib/filters/filter-resolver"
		);
		expect(NO_PRESET_FILTER).toEqual(DEFAULT_COLOR_FILTER_APPLICATION);

		const { client, patches } = fakeClient();
		await elementColor(client, opts({ elementId: "e1", lutFile: twoPoint }));
		await elementColor(client, opts({ elementId: "e1", lutClear: true }));
		await elementColor(
			client,
			opts({
				elementId: "e1",
				lutFile: twoPoint,
				set: JSON.stringify({ filter: { presetId: "vivid" } }),
			})
		);
		for (const patch of patches) {
			expect(
				(patch.body as { color: { filter: unknown } }).color.filter
			).toEqual({ presetId: "none", presetVersion: 1, intensity: 100 });
		}

		// A change that leaves the LUT's data alone leaves the preset alone.
		const untouched = fakeClient();
		await elementColor(
			untouched.client,
			opts({ elementId: "e1", lutIntensity: 60, contrast: 5 })
		);
		expect(
			(untouched.patches[0].body as { color: Record<string, unknown> }).color
		).not.toHaveProperty("filter");
	});

	it("grades a whole track with a LUT and basic controls in one command", async () => {
		const { client, patches } = fakeClient({
			timeline: {
				tracks: [
					{
						id: "t1",
						elements: [
							{ id: "a", type: "media" },
							{ id: "b", type: "media" },
							{ id: "title", type: "text" },
						],
					},
				],
			},
		});
		const result = await elementColor(
			client,
			opts({
				trackId: "t1",
				lutFile: twoPoint,
				lutName: "全片调色",
				lutIntensity: 80,
				contrast: 10,
			})
		);
		expect(result.success).toBe(true);
		expect(patches).toHaveLength(1);
		expect(patches[0].path).toBe("/api/claude/timeline/p1/elements/batch");
		const updates = (
			patches[0].body as {
				updates: Array<{
					elementId: string;
					changes: {
						color: { basic: unknown; lut: Record<string, unknown> };
					};
				}>;
			}
		).updates;
		expect(updates.map((update) => update.elementId)).toEqual(["a", "b"]);
		expect(updates[0].changes.color.basic).toEqual({
			enabled: true,
			contrast: 10,
		});
		expect(updates[0].changes.color.lut).toMatchObject({
			name: "全片调色",
			intensity: 80,
		});
	});

	it("sends a large cube to fewer clips per request, under the body limit", async () => {
		const large = writeCube({
			name: "large.cube",
			lines: ["LUT_3D_SIZE 48", ...cubeRows({ size: 48 })],
		});
		const { client, patches } = fakeClient({
			timeline: {
				tracks: [
					{
						id: "t1",
						elements: Array.from({ length: 12 }, (_, index) => ({
							id: `clip-${index}`,
							type: "media",
						})),
					},
				],
			},
		});
		const result = await elementColor(
			client,
			opts({ trackId: "t1", lutFile: large })
		);
		expect(result).toMatchObject({ success: true, data: { updated: 12 } });
		expect(patches.length).toBeGreaterThan(1);
		for (const patch of patches) {
			expect(patch.path).toBe("/api/claude/timeline/p1/elements/batch");
			expect(JSON.stringify(patch.body).length).toBeLessThan(64 * 1024 * 1024);
		}
		const sent = patches.flatMap((patch) =>
			(patch.body as { updates: Array<{ elementId: string }> }).updates.map(
				(update) => update.elementId
			)
		);
		expect(sent).toEqual(
			Array.from({ length: 12 }, (_, index) => `clip-${index}`)
		);
	});

	it("reads a .json cube without a domain and names it after the file", async () => {
		const filePath = join(dir, "调色LUT_2.json");
		writeFileSync(
			filePath,
			JSON.stringify({ size: 2, values: new Array(24).fill(0.25) })
		);
		const { client, patches } = fakeClient();
		await elementColor(client, opts({ elementId: "e1", lutFile: filePath }));
		expect(
			(patches[0].body as { color: { lut: unknown } }).color.lut
		).toMatchObject({
			name: "调色LUT_2",
			cube: { size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] },
		});
	});

	it("removes the LUT, cube included, with --lut-clear", async () => {
		const { client, patches } = fakeClient();
		const result = await elementColor(
			client,
			opts({ elementId: "e1", lutClear: true })
		);
		expect(result.success).toBe(true);
		expect((patches[0].body as { color: { lut: unknown } }).color.lut).toEqual({
			enabled: false,
			presetId: "none",
			name: "无",
			cube: null,
		});
	});

	it("says what is wrong with a file it cannot use, sending nothing", async () => {
		const { client, patches } = fakeClient();
		const cases: Array<[Partial<CLIRunOptions>, string]> = [
			[{ lutFile: join(dir, "missing.cube") }, "Could not read the LUT file"],
			[
				{
					lutFile: writeCube({
						name: "one-d.cube",
						lines: ["LUT_1D_SIZE 4", "0 0 0", "1 1 1"],
					}),
				},
				"one-d.cube is a 1D LUT; QCut takes a 3D .cube (LUT_3D_SIZE)",
			],
			[
				{ lutFile: writeCube({ name: "bare.cube", lines: ["0 0 0"] }) },
				"bare.cube has no LUT_3D_SIZE line",
			],
			[
				{
					lutFile: writeCube({
						name: "short.cube",
						lines: ["LUT_3D_SIZE 3", ...cubeRows({ size: 2 })],
					}),
				},
				"short.cube does not hold 27 rows of three numbers after LUT_3D_SIZE 3",
			],
			[{ lutFile: twoPoint, lutIntensity: 140 }, "--lut-intensity must be"],
			[{ lutFile: twoPoint, lutClear: true }, "not both"],
			[{ lutName: "orphan" }, "--lut-name names the LUT of --lut-file"],
		];
		for (const [flags, message] of cases) {
			const result = await elementColor(
				client,
				opts({ elementId: "e1", ...flags })
			);
			expect(result.success, message).toBe(false);
			expect(result.error).toContain(message);
		}
		expect(patches).toEqual([]);
	});

	it("parses the LUT flags from the command line", async () => {
		const { parseCliArgs } = await import("../native-pipeline/cli/cli.js");
		expect(
			parseCliArgs([
				"editor",
				"element",
				"color",
				"--track-id",
				"t1",
				"--lut-file",
				"./grade.cube",
				"--lut-name",
				"Show",
				"--lut-intensity",
				"80",
			])
		).toMatchObject({
			command: "editor:element:color",
			trackId: "t1",
			lutFile: "./grade.cube",
			lutName: "Show",
			lutIntensity: 80,
			lutClear: false,
		});
		// "50oops" is not 50: the handler refuses what is not a number.
		const sloppy = parseCliArgs([
			"editor:element:color",
			"--project-id",
			"p1",
			"--element-id",
			"e1",
			"--lut-intensity",
			"50oops",
		]);
		expect(sloppy.lutIntensity).toBeNaN();
		const { client, patches } = fakeClient();
		expect(await elementColor(client, sloppy)).toMatchObject({
			success: false,
			error: "--lut-intensity must be between 0 and 100",
		});
		expect(patches).toEqual([]);
		expect(
			parseCliArgs(["editor:element:color", "--lut-intensity", "0"])
				.lutIntensity
		).toBe(0);
	});
});
