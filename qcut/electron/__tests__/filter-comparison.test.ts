// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createFogComparison,
	parseFogComparison,
} from "../qcut-independent-filter/comparison.js";
import { compareRgba } from "../qcut-independent-filter/comparison-images.js";
import {
	QCUT_FOG_RESOURCE,
	QCUT_FOG_VERSION,
} from "../qcut-independent-filter/contract.js";

const mocks = vi.hoisted(() => ({
	render: vi.fn(),
	cpu: vi.fn(),
	dispose: vi.fn(),
	create: vi.fn(),
}));
vi.mock("../qcut-independent-filter/assets.js", async (original) => ({
	...(await original<typeof import("../qcut-independent-filter/assets.js")>()),
	resolveIndependentFogLut: async () => "/verified-lut",
	loadIndependentFogLut: async () => new Uint8Array([4, 5]),
}));
vi.mock("../qcut-independent-filter/bridge.js", () => ({
	resolveIndependentFilterHost: async () => import.meta.filename,
}));
vi.mock("../qcut-independent-filter/session.js", () => ({
	createIndependentFilterSession: mocks.create,
}));
vi.mock("../qcut-independent-filter/fog-cpu-reference.js", () => ({
	renderFogCpuReference: mocks.cpu,
}));
const rgba = new Uint8Array([10, 20, 30, 255]);
const request = {
	resourceId: QCUT_FOG_RESOURCE,
	version: QCUT_FOG_VERSION,
	width: 1,
	height: 1,
	intensity: 25,
	rgba,
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.create.mockResolvedValue({
		render: mocks.render,
		dispose: mocks.dispose,
	});
	mocks.dispose.mockResolvedValue(undefined);
	mocks.render.mockResolvedValue({
		provider: "qcut-metal-fog-v1",
		width: 1,
		height: 1,
		rgba,
	});
	mocks.cpu.mockResolvedValue({
		rgba,
		binarySha256: "test-binary",
		stages: [{ name: "04-lut", rgba }],
	});
});

describe("comparison input and byte metrics", () => {
	it("snapshots bytes and strips renderer paths", () => {
		const pixels = new Uint8Array(rgba);
		const parsed = parseFogComparison({
			request: {
				...request,
				rgba: pixels,
				lutPath: "/bad",
				executable: "/bad",
			},
		});
		pixels.fill(0);
		expect(parsed.rgba).toEqual(rgba);
		expect(parsed).not.toHaveProperty("lutPath");
		expect(parsed).not.toHaveProperty("executable");
	});
	it.each([
		{ version: "wrong" },
		{ resourceId: "other" },
		{ intensity: NaN },
		{ intensity: 101 },
		{ width: 641, rgba: new Uint8Array(641 * 4) },
		{ width: 0 },
		{ rgba: new Uint8Array([1, 2, 3, 254]) },
		{ rgba: [1, 2, 3, 255] },
	])("rejects an unsupported request before rendering: %j", (change) => {
		expect(() =>
			parseFogComparison({ request: { ...request, ...change } })
		).toThrow();
		expect(mocks.create).not.toHaveBeenCalled();
	});
	it("separates RGB, alpha, changed pixels, and amplified display bytes", () => {
		const value = compareRgba({
			candidate: new Uint8Array([10, 20, 30, 255, 255, 0, 1, 10]),
			reference: new Uint8Array([8, 24, 30, 255, 0, 0, 1, 11]),
		});
		expect(value.metrics).toEqual({
			rgbMae: 261 / 6,
			rgbRmse: Math.sqrt(65045 / 6),
			rgbMax: 255,
			alphaMax: 1,
			changedPixels: 2,
			pixelCount: 2,
		});
		expect([...value.difference]).toEqual([16, 32, 0, 255, 255, 0, 0, 255]);
		expect(
			compareRgba({ candidate: rgba, reference: rgba }).metrics.rgbRmse
		).toBe(0);
		expect(() =>
			compareRgba({ candidate: rgba, reference: new Uint8Array(8) })
		).toThrow();
	});
});

describe.skipIf(process.platform !== "darwin")(
	"comparison orchestration",
	() => {
		it("renders identical input and intensity, returns images and hashes, and disposes", async () => {
			const result = await createFogComparison()({ request });
			expect(mocks.render).toHaveBeenCalledWith(request);
			expect(mocks.cpu).toHaveBeenCalledWith({
				request,
				lut: new Uint8Array([4, 5]),
			});
			expect(result.metrics.changedPixels).toBe(0);
			expect(result.input.sha256).toHaveLength(64);
			expect(result.input.png).toMatch(/^data:image\/png;base64,/);
			expect(result.referenceStages[0].name).toBe("04-lut");
			expect(mocks.dispose).toHaveBeenCalledOnce();
		});
		it("keeps the gate until both workers settle, cleans failures, then allows retry", async () => {
			let finish: (value: unknown) => void = () => {};
			mocks.cpu.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					})
			);
			mocks.render.mockRejectedValueOnce(new Error("Metal failed"));
			const compare = createFogComparison();
			const pending = compare({ request });
			const failure = expect(pending).rejects.toThrow("Metal failed");
			await vi.waitFor(() => expect(mocks.cpu).toHaveBeenCalled());
			await expect(compare({ request })).rejects.toThrow("正在运行");
			expect(mocks.dispose).not.toHaveBeenCalled();
			finish({ rgba, binarySha256: "x", stages: [] });
			await failure;
			expect(mocks.dispose).toHaveBeenCalledOnce();
			await expect(compare({ request })).resolves.toMatchObject({
				metrics: { rgbMax: 0 },
			});
		});
		it("rejects wrong output dimensions and cleans the session", async () => {
			mocks.render.mockResolvedValueOnce({
				width: 2,
				height: 1,
				provider: "qcut-metal-fog-v1",
				rgba,
			});
			await expect(createFogComparison()({ request })).rejects.toThrow("尺寸");
			expect(mocks.dispose).toHaveBeenCalledOnce();
		});
	}
);
