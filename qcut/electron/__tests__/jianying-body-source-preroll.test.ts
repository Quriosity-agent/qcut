// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	JianyingPortraitAdjustmentRenderRequest,
	MediaPortraitManualBody,
} from "../jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract.js";
import type { JianyingPortraitHostRenderCommand } from "../jianying-portrait-adjustment-runtime/host-process.js";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request.js";

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
vi.mock("../jianying-portrait-adjustment-runtime/package-resolver.js", () => ({
	resolveJianyingPortraitPackage: vi.fn(),
	resolveJianyingPortraitPackages: async () =>
		["manual-stretch", "manual-slim", "manual-zoom", "body"].map(
			(runtimePackage) => ({
				runtimePackage,
				group: "body",
				packagePath: `/packages/${runtimePackage}`,
				source: "qcut-private",
			})
		),
}));
import { createJianyingPortraitAdjustmentProvider } from "../jianying-portrait-adjustment-runtime/provider.js";

function manualBody(): MediaPortraitManualBody {
	return {
		stretch: { intensity: 10, upper: 0.7, bottom: 0.2 },
		slim: {
			intensity: 20,
			x: 0.5,
			y: 0.4,
			width: 0.3,
			height: 0.5,
			rotation: 18,
		},
		zoom: { intensity: 30, x: 0.6, y: 0.5, radius: 0.2 },
	};
}

function request({
	history = true,
	automatic = true,
	manual = true,
}: {
	history?: boolean;
	automatic?: boolean;
	manual?: boolean;
} = {}): JianyingPortraitAdjustmentRenderRequest {
	return {
		width: 1,
		height: 1,
		rgba: new Uint8Array([80, 90, 100, 255]),
		sourceKey: "body-source",
		timestampSeconds: 2.2,
		adjustments: {
			enabled: true,
			values: automatic ? { body_adjust_SlimBody: 35 } : {},
			...(manual ? { manualBody: manualBody() } : {}),
		},
		...(history
			? {
					sourcePreRoll: {
						sourceKey: "body-source",
						frames: [
							{ timestampSeconds: 2, rgba: new Uint8Array([10, 20, 30, 255]) },
							{
								timestampSeconds: 2.1,
								rgba: new Uint8Array([40, 50, 60, 255]),
							},
						],
					},
				}
			: {}),
	};
}

describe("body source history preserves manual-to-skeleton stage inputs", () => {
	let provider: ReturnType<typeof createJianyingPortraitAdjustmentProvider>;
	let commands: {
		packagePath: string;
		timestamp: number;
		pixels: number[];
		parameters: string;
	}[];
	let disposals: ReturnType<typeof vi.fn>[];
	let failAt: number | undefined;
	let manualPassthrough: boolean;

	beforeEach(() => {
		vi.clearAllMocks();
		commands = [];
		disposals = [];
		failAt = undefined;
		manualPassthrough = false;
		mocks.start.mockImplementation(
			async ({ packagePath }: { packagePath: string }) => {
				let skeletonAcquired = false;
				const dispose = vi.fn(async () => {});
				disposals.push(dispose);
				return {
					dispose,
					detect: vi.fn(),
					stroke: vi.fn(),
					render: async ({
						inputPath,
						outputPath,
						timestampSeconds,
						featureParameters,
					}: JianyingPortraitHostRenderCommand) => {
						const pixels = await readFile(inputPath);
						commands.push({
							packagePath,
							timestamp: timestampSeconds,
							pixels: [...pixels],
							parameters: featureParameters,
						});
						if (packagePath === "/packages/body") {
							if (timestampSeconds === failAt)
								throw new Error("injected skeleton failure");
							if (pixels[0] >= 10 && pixels[0] <= 16) skeletonAcquired = true;
							if (skeletonAcquired) pixels[1] += 100;
						} else if (!manualPassthrough) {
							const parameters = JSON.parse(featureParameters) as {
								effects_adjust_intensity: number;
							};
							pixels[0] += Math.round(parameters.effects_adjust_intensity * 10);
						}
						await writeFile(outputPath, pixels);
					},
				};
			}
		);
		provider = createJianyingPortraitAdjustmentProvider();
	});
	afterEach(async () => provider.clear());

	it("replays all manual stages before the body detector on every original frame", async () => {
		const value = request();
		expect(parseJianyingPortraitRenderRequest({ request: value })).toEqual(
			value
		);
		const result = await provider.render(value);
		expect(result.rgba).toEqual(new Uint8Array([86, 190, 100, 255]));
		expect(
			commands.map(({ timestamp, packagePath, pixels }) => [
				timestamp,
				packagePath.slice("/packages/".length),
				pixels[0],
			])
		).toEqual([
			[2, "manual-stretch", 10],
			[2, "manual-slim", 11],
			[2, "manual-zoom", 13],
			[2, "body", 16],
			[2.1, "manual-stretch", 40],
			[2.1, "manual-slim", 41],
			[2.1, "manual-zoom", 43],
			[2.1, "body", 46],
			[2.2, "manual-stretch", 80],
			[2.2, "manual-slim", 81],
			[2.2, "manual-zoom", 83],
			[2.2, "body", 86],
		]);
		expect(
			new Set(
				commands
					.filter(({ packagePath }) => packagePath.endsWith("manual-slim"))
					.map(({ parameters }) => parameters)
			).size
		).toBe(1);
		expect(value.rgba).toEqual(new Uint8Array([80, 90, 100, 255]));
		expect(value.sourcePreRoll?.frames[0].rgba).toEqual(
			new Uint8Array([10, 20, 30, 255])
		);
	});

	it.each([
		false,
		true,
	])("recovers a cold skeleton miss with manual enabled=%s", async (manual) => {
		const cold = await provider.render(request({ history: false, manual }));
		expect(cold.needsSourcePreRoll).toBe(true);
		const result = await provider.render(request({ manual }));
		expect(result.needsSourcePreRoll).toBeUndefined();
		expect(result.rgba[1]).toBe(190);
	});

	it("replays manual-only geometry without treating a legitimate identity as a tracker miss", async () => {
		manualPassthrough = true;
		const value = request({ automatic: false });
		const result = await provider.render(value);
		expect(result.rgba).toEqual(value.rgba);
		expect(result.needsSourcePreRoll).toBeUndefined();
		expect(commands).toHaveLength(9);
		expect(mocks.start).toHaveBeenCalledTimes(3);
	});

	it("keeps retained zero geometry inert and still recovers automatic body", async () => {
		const value = request();
		for (const tool of Object.values(value.adjustments.manualBody ?? {}))
			tool.intensity = 0;
		expect((await provider.render(value)).rgba[1]).toBe(190);
		expect(
			commands.every(({ packagePath }) => packagePath === "/packages/body")
		).toBe(true);
		const count = commands.length;
		value.adjustments.values = { body_adjust_SlimBody: 0 };
		expect((await provider.render(value)).rgba).toEqual(value.rgba);
		expect(commands).toHaveLength(count);
		expect(disposals[0]).toHaveBeenCalledOnce();
	});
	it("returns legitimate no-body pixels after bounded recovery without inventing an effect", async () => {
		const value = request({ manual: false });
		value.sourcePreRoll!.frames[0].rgba[0] = 30;
		const result = await provider.render(value);
		expect(result.rgba).toEqual(value.rgba);
		expect(commands).toHaveLength(3);
		expect(mocks.start).toHaveBeenCalledOnce();
	});

	it("rebuilds the requested geometry after backward seeks and prior histories", async () => {
		const baseline = await provider.render(request());
		const early = request();
		early.timestampSeconds = 1.2;
		early.sourcePreRoll!.frames = [
			{ timestampSeconds: 1, rgba: new Uint8Array([30, 20, 30, 255]) },
		];
		early.adjustments.manualBody!.stretch!.intensity = 40;
		const sought = await provider.render(early);
		expect(sought.rgba).toEqual(new Uint8Array([89, 90, 100, 255]));
		expect((await provider.render(request())).rgba).toEqual(baseline.rgba);
		expect(mocks.start).toHaveBeenCalledTimes(12);
	});

	it("discards partially replayed stages after failure and reconstructs the next attempt", async () => {
		failAt = 2.1;
		await expect(provider.render(request())).rejects.toThrow(
			"skeleton failure"
		);
		expect(disposals).toHaveLength(4);
		expect(disposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(
			true
		);
		failAt = undefined;
		expect((await provider.render(request())).rgba).toEqual(
			new Uint8Array([86, 190, 100, 255])
		);
		expect(mocks.start).toHaveBeenCalledTimes(8);
	});

	it("keeps the complete source window atomic against another body's request", async () => {
		const other = request({ history: false });
		other.sourceKey = "body-source-B";
		const [recovered, independent] = await Promise.all([
			provider.render(request()),
			provider.render(other),
		]);
		expect(recovered.rgba[1]).toBe(190);
		expect(independent.rgba[1]).toBe(90);
		expect(commands.slice(12).map(({ timestamp }) => timestamp)).toEqual([
			2.2, 2.2, 2.2, 2.2,
		]);
	});
});
