import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import { ComposeFilterStackError } from "../native-pipeline/compose/compose-filter-stack-resolver.js";
import {
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
