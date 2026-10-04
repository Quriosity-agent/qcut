// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JianyingPortraitAdjustmentRenderRequest } from "../jianying-portrait-adjustment-contract.js";
import type { JianyingPortraitHostRenderCommand } from "../jianying-portrait-adjustment-runtime/host-process.js";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request.js";
import {
	parsePortraitSourcePreRoll,
	canRecoverPortraitSource,
} from "../jianying-portrait-adjustment-runtime/source-preroll.js";

const mocks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("../jianying-filter-local-runtime/runtime-discovery.js", () => ({
	inspectJianyingFilterLocalRuntime: async () => ({
		status: { state: "ready" },
		frameworkDirectory: "/runtime/Frameworks",
		modelDirectory: "/models",
	}),
}));
vi.mock("../jianying-portrait-adjustment-runtime/bridge-resolver.js", () => ({
	resolveJianyingPortraitAdjustmentHost: async () => "/host",
}));
vi.mock(
	"../jianying-portrait-adjustment-runtime/nose-models.js",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../jianying-portrait-adjustment-runtime/nose-models.js")
		>()),
		missingJianyingNoseModels: async () => [],
	})
);
vi.mock("../jianying-portrait-adjustment-runtime/host-process.js", () => ({
	startJianyingPortraitHostProcess: mocks.start,
}));
vi.mock("../jianying-portrait-adjustment-runtime/makeup-resolver.js", () => ({
	resolveJianyingPortraitMakeupCards: async () => [],
}));
vi.mock(
	"../jianying-portrait-adjustment-runtime/package-resolver.js",
	async () => {
		const {
			JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
			JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER,
		} = await import("../jianying-portrait-adjustment-runtime/catalog.js");
		return {
			resolveJianyingPortraitPackage: vi.fn(),
			resolveJianyingPortraitPackages: async () =>
				JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER.map((runtimePackage) => ({
					runtimePackage,
					group: JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage].group,
					packagePath: `/packages/${runtimePackage}`,
					source: "qcut-private",
				})),
		};
	}
);
import { createJianyingPortraitAdjustmentProvider } from "../jianying-portrait-adjustment-runtime/provider.js";

function request(): JianyingPortraitAdjustmentRenderRequest {
	return {
		width: 1,
		height: 1,
		rgba: new Uint8Array([80, 90, 100, 255]),
		sourceKey: "source-A",
		timestampSeconds: 2.2,
		frameNumber: 66,
		adjustments: { enabled: true, values: { face_adjust_EnlargeEye: 60 } },
	};
}
function recovered(): JianyingPortraitAdjustmentRenderRequest {
	return {
		...request(),
		sourcePreRoll: {
			sourceKey: "source-A",
			frames: [
				{ timestampSeconds: 2, rgba: new Uint8Array([10, 20, 30, 255]) },
				{ timestampSeconds: 2.1, rgba: new Uint8Array([40, 50, 60, 255]) },
			],
		},
	};
}

describe("portrait causal source pre-roll contract", () => {
	it("rejects memory overflow before accepting historical pixels", () => {
		const value = recovered();
		expect(() =>
			parsePortraitSourcePreRoll({
				value: value.sourcePreRoll,
				request: { ...value, width: 4096, height: 4096 },
			})
		).toThrow("size");
	});
	it("does not recover manual-body or disabled operations", () => {
		const value = request();
		value.adjustments.manualBody = {};
		expect(canRecoverPortraitSource({ request: value })).toBe(false);
		value.adjustments = {
			enabled: false,
			values: { face_adjust_EnlargeEye: 60 },
		};
		expect(canRecoverPortraitSource({ request: value })).toBe(false);
	});
	it("preserves source pixels and real timestamps without inventing frame numbers", () => {
		expect(
			parseJianyingPortraitRenderRequest({ request: recovered() })
		).toEqual(recovered());
		expect(
			parseJianyingPortraitRenderRequest({ request: request() })
		).not.toHaveProperty("sourcePreRoll");
	});
	it.each([
		[
			"source mismatch",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.sourcePreRoll!.sourceKey = "source-B";
			},
		],
		[
			"no source",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.sourceKey = undefined;
			},
		],
		[
			"no timestamp",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.timestampSeconds = undefined;
			},
		],
		[
			"empty history",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.sourcePreRoll!.frames = [];
			},
		],
		[
			"future frame",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.sourcePreRoll!.frames[1].timestampSeconds = 2.3;
			},
		],
		[
			"target frame",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.sourcePreRoll!.frames[1].timestampSeconds = 2.2;
			},
		],
		[
			"old frame",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.sourcePreRoll!.frames[0].timestampSeconds = 1.6;
			},
		],
		[
			"duplicate timestamp",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.sourcePreRoll!.frames[1].timestampSeconds = 2;
			},
		],
		[
			"reverse timestamps",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.sourcePreRoll!.frames.reverse();
			},
		],
		[
			"nan timestamp",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.sourcePreRoll!.frames[1].timestampSeconds = Number.NaN;
			},
		],
		[
			"bad pixels",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.sourcePreRoll!.frames[0].rgba = new Uint8Array(3);
			},
		],
		[
			"too many frames",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.sourcePreRoll!.frames = Array.from(
					{ length: 17 },
					(_, index) => ({
						timestampSeconds: 2 + index / 100,
						rgba: new Uint8Array(4),
					})
				);
			},
		],
		[
			"single-face target",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.adjustments.faceTarget = { mode: "single", faceId: 1 };
			},
		],
		[
			"per-face bindings",
			(value: JianyingPortraitAdjustmentRenderRequest) => {
				value.adjustments.faces = [
					{
						trackId: 1,
						personBindingId: "person-1",
						values: { face_adjust_EnlargeEye: 60 },
					},
				];
			},
		],
	] as const)("rejects %s", (_label, mutate) => {
		const value = recovered();
		mutate(value);
		expect(() =>
			parseJianyingPortraitRenderRequest({ request: value })
		).toThrow();
	});
});

describe("portrait causal recovery provider", () => {
	let provider: ReturnType<typeof createJianyingPortraitAdjustmentProvider>;
	let commands: { timestamp: number; pixels: number[]; packagePath: string }[];
	let disposals: ReturnType<typeof vi.fn>[];
	let failAt: number | undefined;
	beforeEach(() => {
		vi.clearAllMocks();
		commands = [];
		disposals = [];
		failAt = undefined;
		mocks.start.mockImplementation(
			async ({ packagePath }: { packagePath: string }) => {
				let acquired = false;
				const dispose = vi.fn(async () => {});
				disposals.push(dispose);
				return {
					dispose,
					render: async ({
						inputPath,
						outputPath,
						timestampSeconds,
					}: JianyingPortraitHostRenderCommand) => {
						const pixels = await readFile(inputPath);
						commands.push({
							timestamp: timestampSeconds,
							pixels: [...pixels],
							packagePath,
						});
						if (timestampSeconds === failAt)
							throw new Error("injected render failure");
						if (pixels[0] === 10) acquired = true;
						if (acquired) pixels[1] += 1;
						await writeFile(outputPath, pixels);
					},
					detect: vi.fn(async () => JSON.stringify({ faces: [] })),
					stroke: vi.fn(),
				};
			}
		);
		provider = createJianyingPortraitAdjustmentProvider();
	});
	afterEach(async () => {
		await provider.clear();
	});
	it("preserves cold misses, then replays actual history and the unchanged target", async () => {
		const cold = await provider.render(request());
		expect(cold.rgba).toEqual(request().rgba);
		expect(cold.needsSourcePreRoll).toBe(true);
		const result = await provider.render(recovered());
		expect(commands.map(({ timestamp }) => timestamp)).toEqual([
			2.2, 2, 2.1, 2.2,
		]);
		expect(commands.at(-1)?.pixels).toEqual([...request().rgba]);
		expect(result.rgba).toEqual(new Uint8Array([80, 91, 100, 255]));
		expect(result.needsSourcePreRoll).toBeUndefined();
		expect(disposals[0]).toHaveBeenCalledOnce();
	});
	it("preserves recovery eligibility when the stable-frame path reuses a paused miss", async () => {
		expect((await provider.render(request())).needsSourcePreRoll).toBe(true);
		expect((await provider.render(request())).needsSourcePreRoll).toBe(true);
		expect(commands).toHaveLength(1);
	});
	it("bypasses historical caches during explicit recovery, then retains exact paused hits", async () => {
		await provider.render(recovered());
		const count = commands.length;
		await provider.render(request());
		expect(commands).toHaveLength(count);
		await provider.render(recovered());
		expect(commands).toHaveLength(count + 3);
	});
	it("serializes other sources after the complete replay and does not share acquisition", async () => {
		const [result, other] = await Promise.all([
			provider.render(recovered()),
			provider.render({ ...request(), sourceKey: "source-B" }),
		]);
		expect(result.rgba[1]).toBe(91);
		expect(other.rgba).toEqual(request().rgba);
		expect(commands.map(({ timestamp }) => timestamp)).toEqual([
			2, 2.1, 2.2, 2.2,
		]);
	});
	it("retires partial recovery on failure and leaves other source scopes intact", async () => {
		await provider.render({
			...recovered(),
			sourceKey: "source-B",
			sourcePreRoll: { ...recovered().sourcePreRoll!, sourceKey: "source-B" },
		});
		failAt = 2.1;
		await expect(provider.render(recovered())).rejects.toThrow("injected");
		expect(disposals[1]).toHaveBeenCalledOnce();
		expect(disposals[0]).not.toHaveBeenCalled();
		failAt = undefined;
		expect((await provider.render(request())).rgba).toEqual(request().rgba);
	});
	it("validates direct provider callers before native work", async () => {
		const value = recovered();
		value.sourcePreRoll!.sourceKey = "wrong";
		await expect(provider.render(value)).rejects.toThrow("identity");
		expect(mocks.start).not.toHaveBeenCalled();
	});
	it("replays combined stages on each preceding frame, never substitutes a prior output", async () => {
		const value = recovered();
		value.adjustments.values.face_adjust_Smooth = 30;
		const result = await provider.render(value);
		expect(result.rgba[0]).toBe(80);
		expect(
			commands.filter(({ timestamp }) => timestamp === 2.2).length
		).toBeGreaterThan(1);
	});
	it("keeps None and disabled values inert", async () => {
		const value = request();
		value.adjustments = {
			enabled: true,
			skinToneResourceId: null,
			values: { face_adjust_skin_Intensity: 60, face_adjust_skin_ColdWarm: 25 },
		};
		expect((await provider.render(value)).rgba).toEqual(value.rgba);
		expect(mocks.start).not.toHaveBeenCalled();
	});
});
