// @vitest-environment node
import { readFile, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JianyingPortraitHostRenderCommand } from "../jianying-portrait-adjustment-runtime/host-process.js";
import {
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER,
} from "../jianying-portrait-adjustment-runtime/catalog.js";

const mocks = vi.hoisted(() => ({ start: vi.fn(), missingModels: vi.fn() }));
vi.mock("../jianying-filter-local-runtime/runtime-discovery.js", () => ({
	inspectJianyingFilterLocalRuntime: async () => ({
		status: {
			state: "ready",
			runtimeSource: "qcut-private",
			modelSource: "qcut-private",
		},
		frameworkDirectory: "/runtime/Frameworks",
		modelDirectory: "/runtime/Models",
	}),
}));
vi.mock("../jianying-portrait-adjustment-runtime/bridge-resolver.js", () => ({
	resolveJianyingPortraitAdjustmentHost: async () => "/host",
}));
vi.mock("../jianying-portrait-adjustment-runtime/nose-models.js", () => ({
	missingJianyingNoseModels: mocks.missingModels,
}));
vi.mock("../jianying-portrait-adjustment-runtime/host-process.js", () => ({
	startJianyingPortraitHostProcess: mocks.start,
}));
vi.mock("../jianying-portrait-adjustment-runtime/makeup-resolver.js", () => ({
	resolveJianyingPortraitMakeupCards: async () => [],
}));
vi.mock("../jianying-portrait-adjustment-runtime/package-resolver.js", () => ({
	resolveJianyingPortraitPackages: async () =>
		JIANYING_PORTRAIT_RUNTIME_PACKAGE_ORDER.map((runtimePackage) => ({
			runtimePackage,
			group: JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage].group,
			packagePath: `/packages/${runtimePackage}`,
			source: "qcut-private",
		})),
}));

import { createJianyingPortraitAdjustmentProvider } from "../jianying-portrait-adjustment-runtime/provider.js";

describe("stateful portrait fitting provider", () => {
	let provider: ReturnType<typeof createJianyingPortraitAdjustmentProvider>;
	const hosts: {
		render: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	}[] = [];
	beforeEach(() => {
		vi.clearAllMocks();
		hosts.length = 0;
		mocks.missingModels.mockResolvedValue([]);
		mocks.start.mockImplementation(async () => {
			let fittingUpdates = 0;
			const host = {
				pid: hosts.length + 1,
				render: vi.fn(
					async ({
						inputPath,
						outputPath,
					}: JianyingPortraitHostRenderCommand) => {
						const pixels = await readFile(inputPath);
						pixels[0] += ++fittingUpdates;
						await writeFile(outputPath, pixels);
					}
				),
				detect: vi.fn(async () => "[]"),
				stroke: vi.fn(),
				dispose: vi.fn(async () => undefined),
			};
			hosts.push(host);
			return host;
		});
		provider = createJianyingPortraitAdjustmentProvider();
	});
	afterEach(async () => {
		await provider.clear();
	});
	const rgba = new Uint8Array([100, 120, 140, 255, 100, 120, 140, 255]);
	const request = ({
		value = -48,
		timestampSeconds = 0,
		pixels = rgba,
	}: {
		value?: number;
		timestampSeconds?: number;
		pixels?: Uint8Array;
	} = {}) => ({
		width: 2,
		height: 1,
		rgba: pixels,
		timestampSeconds,
		sourceKey: "test-portrait",
		adjustments: { enabled: true, values: { face_adjust_3DNose_Big: value } },
	});

	it("renders the dedicated package and freezes identical image frames without advancing fitting", async () => {
		const first = await provider.render(request());
		const next = await provider.render(request({ timestampSeconds: 1 / 30 }));
		expect(next.rgba).toEqual(first.rgba);
		expect(hosts).toHaveLength(1);
		expect(hosts[0].render).toHaveBeenCalledTimes(1);
		expect(mocks.start).toHaveBeenCalledWith(
			expect.objectContaining({ packagePath: "/packages/nose-3d" })
		);
		expect(
			JSON.parse(hosts[0].render.mock.calls[0][0].featureParameters)
		).toEqual({ face_adjust_3DNose_Big: [{ id: -1, intensity: -0.48 }] });
	});
	it("cold starts changed slider values and passes zero through without rendering", async () => {
		await provider.render(request());
		const changed = await provider.render(request({ value: 50 }));
		expect(changed.rgba[0]).toBe(101);
		expect(hosts).toHaveLength(2);
		expect(hosts[0].dispose).toHaveBeenCalledTimes(1);
		const reset = await provider.render(request({ value: 0 }));
		expect(reset.rgba).toEqual(rgba);
		expect(reset.rgba).not.toBe(rgba);
		expect(reset.activeGroups).toEqual([]);
		expect(hosts[1].dispose).toHaveBeenCalledTimes(1);
		const restored = await provider.render(request({ timestampSeconds: 0.1 }));
		expect(restored.rgba[0]).toBe(101);
		expect(hosts).toHaveLength(3);
	});
	it("preserves history for moving frames but rebuilds after reverse seeks", async () => {
		await provider.render(request({ timestampSeconds: 1 }));
		const pixels = new Uint8Array(rgba);
		pixels[1] = 122;
		const next = await provider.render(
			request({ timestampSeconds: 1.033, pixels })
		);
		expect(next.rgba[0]).toBe(102);
		expect(hosts).toHaveLength(1);
		const reverse = await provider.render(
			request({ timestampSeconds: 0.5, pixels })
		);
		expect(reverse.rgba[0]).toBe(101);
		expect(hosts).toHaveLength(2);
	});
	it("rebuilds smile fitting after an upstream mouth edit on the same frame", async () => {
		const base = request();
		await provider.render({
			...base,
			adjustments: { enabled: true, values: { face_adjust_Smile: 50 } },
		});
		const combinedRequest = {
			...base,
			adjustments: {
				enabled: true,
				values: { face_adjust_Smile: 50, face_adjust_mouse_corner: -25 },
			},
		};
		const warm = await provider.render(combinedRequest);
		expect(hosts).toHaveLength(3);
		expect(hosts[0].dispose).toHaveBeenCalledTimes(1);
		expect(warm.rgba[0]).toBe(102);
		await provider.clear();
		const cold = await provider.render(combinedRequest);
		expect(cold.rgba).toEqual(warm.rgba);
	});
	it("freezes identical smile frames and preserves tracking for moving frames", async () => {
		const base = {
			...request(),
			adjustments: { enabled: true, values: { face_adjust_Smile: 50 } },
		};
		const first = await provider.render(base);
		const held = await provider.render({ ...base, timestampSeconds: 1 / 30 });
		expect(held.rgba).toEqual(first.rgba);
		expect(hosts[0].render).toHaveBeenCalledTimes(1);
		const pixels = new Uint8Array(rgba);
		pixels[1] += 2;
		const moving = await provider.render({
			...base,
			rgba: pixels,
			timestampSeconds: 2 / 30,
		});
		expect(moving.rgba[0]).toBe(102);
		expect(hosts).toHaveLength(1);
		const changed = await provider.render({
			...base,
			adjustments: { enabled: true, values: { face_adjust_Smile: -50 } },
			timestampSeconds: 2 / 30,
		});
		expect(changed.rgba[0]).toBe(101);
		expect(hosts).toHaveLength(2);
	});
	it("disables only the unavailable 3D control and refuses uncached rendering without its model", async () => {
		mocks.missingModels.mockResolvedValue(["tt_facefitting1220"]);
		const status = await provider.inspect();
		expect(status.available).toBe(true);
		expect(
			status.packages.find(({ runtimePackage }) => runtimePackage === "nose-3d")
		).toMatchObject({
			ready: false,
			message: expect.stringContaining("tt_facefitting1220"),
		});
		expect(
			status.packages.find(
				({ runtimePackage }) => runtimePackage === "features"
			)?.ready
		).toBe(true);
		await expect(provider.render(request())).rejects.toThrow(
			"tt_facefitting1220"
		);
		expect(mocks.start).not.toHaveBeenCalled();
	});
	it("rebuilds face tracking after bright eyes changes its paused input", async () => {
		const base = request();
		await provider.render({
			...base,
			adjustments: { enabled: true, values: { face_adjust_EnlargeEye: 50 } },
		});
		const combined = {
			...base,
			adjustments: {
				enabled: true,
				values: { face_adjust_EnlargeEye: 50, face_adjust_BrightEye: 100 },
			},
		};
		const warm = await provider.render(combined);
		expect(hosts).toHaveLength(3);
		expect(hosts[0].dispose).toHaveBeenCalledTimes(1);
		expect(warm.rgba[0]).toBe(102);
		const held = await provider.render({
			...combined,
			timestampSeconds: 1 / 30,
		});
		expect(held.rgba).toEqual(warm.rgba);
		expect(hosts[1].render).toHaveBeenCalledTimes(1);
		expect(hosts[2].render).toHaveBeenCalledTimes(1);
		await provider.clear();
		const cold = await provider.render(combined);
		expect(cold.rgba).toEqual(warm.rgba);
	});
	it.each([
		"face_adjust_EnlargeEye",
		"face_adjust_BrightEye",
	] as const)("keeps moving frames but resets %s parameter history", async (key) => {
		const base = {
			...request(),
			adjustments: { enabled: true, values: { [key]: 50 } },
		};
		const first = await provider.render(base);
		const held = await provider.render({ ...base, timestampSeconds: 1 / 30 });
		expect(held.rgba).toEqual(first.rgba);
		expect(hosts[0].render).toHaveBeenCalledTimes(1);
		const pixels = new Uint8Array(rgba);
		pixels[1] += 2;
		const moving = await provider.render({
			...base,
			rgba: pixels,
			timestampSeconds: 2 / 30,
		});
		expect(moving.rgba[0]).toBe(102);
		expect(hosts).toHaveLength(1);
		const changed = await provider.render({
			...base,
			rgba: pixels,
			timestampSeconds: 2 / 30,
			adjustments: { enabled: true, values: { [key]: 100 } },
		});
		expect(changed.rgba[0]).toBe(101);
		expect(hosts).toHaveLength(2);
	});
});
