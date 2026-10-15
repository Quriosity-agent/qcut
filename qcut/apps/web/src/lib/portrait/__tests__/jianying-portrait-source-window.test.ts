import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JianyingPortraitAdjustmentRenderRequest } from "@/types/electron/api-jianying-portrait-adjustment";
import { renderJianyingPortraitAdjustmentPreview } from "../jianying-portrait-adjustment-preview";
import { NativePortraitSourceWindowError } from "../portrait-temporal-policy";
import type { PortraitSourcePreRollReader } from "../portrait-source-preroll";

const render = vi.fn(
	async (_request: JianyingPortraitAdjustmentRenderRequest) => ({
		provider: "jianying-local-swing-v1" as const,
		width: 1,
		height: 1,
		rgba: new Uint8Array([20, 30, 40, 255]),
		activeGroups: ["face" as const],
	})
);
const readSourcePreRoll = vi.fn<PortraitSourcePreRollReader>(
	async ({ sourceKey, timestampSeconds }) => ({
		sourceKey,
		frames:
			timestampSeconds > 0
				? [
						{
							timestampSeconds: timestampSeconds - 0.1,
							rgba: new Uint8Array([5, 6, 7, 255]),
						},
					]
				: [],
	})
);

function request({ timestampSeconds = 1 } = {}) {
	return {
		source: {
			width: 1,
			height: 1,
			data: new Uint8ClampedArray([10, 20, 30, 255]),
			colorSpace: "srgb",
		} as ImageData,
		adjustments: { enabled: true, values: { face_adjust_TotalFace: 25 } },
		sourceKey: "video:A",
		timestampSeconds,
		readSourcePreRoll,
		portraitTemporalMode: "source-window" as const,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		"ImageData",
		class {
			constructor(
				public data: Uint8ClampedArray,
				public width: number,
				public height: number
			) {}
		}
	);
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: { jianyingPortraitAdjustment: { render } },
	});
});
afterEach(() => vi.unstubAllGlobals());

describe("deterministic native source-window adapter", () => {
	it("sends one atomic replay, isolated from the continuous source key", async () => {
		await renderJianyingPortraitAdjustmentPreview(request());
		expect(readSourcePreRoll).toHaveBeenCalledWith(
			expect.objectContaining({
				strict: true,
				sourceKey: "source-window-v1:video:A",
				timestampSeconds: 1,
			})
		);
		expect(render).toHaveBeenCalledOnce();
		expect(render).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceKey: "source-window-v1:video:A",
				freshTracking: true,
				sourcePreRoll: {
					sourceKey: "source-window-v1:video:A",
					frames: [
						{ timestampSeconds: 0.9, rgba: new Uint8Array([5, 6, 7, 255]) },
					],
				},
			})
		);
	});
	it("uses cold tracking for a verified empty first-frame history", async () => {
		await renderJianyingPortraitAdjustmentPreview(
			request({ timestampSeconds: 0 })
		);
		expect(render.mock.calls[0][0].freshTracking).toBe(true);
		expect(render.mock.calls[0][0]).not.toHaveProperty("sourcePreRoll");
	});
	it.each([
		"missing",
		"mismatched",
		"decode-error",
	])("does not fall back after %s history", async (kind) => {
		readSourcePreRoll.mockImplementationOnce(async () => {
			if (kind === "decode-error") throw new Error("decode failed");
			if (kind === "missing") return;
			return { sourceKey: "wrong", frames: [] };
		});
		await expect(
			renderJianyingPortraitAdjustmentPreview(request())
		).rejects.toBeInstanceOf(NativePortraitSourceWindowError);
		expect(render).not.toHaveBeenCalled();
	});
	it("does not fall back when the native engine rejects", async () => {
		render.mockRejectedValueOnce(new Error("native failed"));
		await expect(
			renderJianyingPortraitAdjustmentPreview(request())
		).rejects.toBeInstanceOf(NativePortraitSourceWindowError);
	});
	it("rejects an unavailable engine and invalid target scope", async () => {
		await expect(
			renderJianyingPortraitAdjustmentPreview({
				...request(),
				adjustments: {
					...request().adjustments,
					faceTarget: { mode: "single", faceId: 1 },
				},
			})
		).rejects.toBeInstanceOf(NativePortraitSourceWindowError);
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: {},
		});
		await expect(
			renderJianyingPortraitAdjustmentPreview(request())
		).rejects.toBeInstanceOf(NativePortraitSourceWindowError);
		expect(render).not.toHaveBeenCalled();
	});
	it.each([
		"before",
		"after",
	])("does not submit a render when cancelled %s history decode", async (phase) => {
		const controller = new AbortController();
		if (phase === "before") controller.abort();
		else
			readSourcePreRoll.mockImplementationOnce(async ({ sourceKey }) => {
				controller.abort();
				return { sourceKey, frames: [] };
			});
		await expect(
			renderJianyingPortraitAdjustmentPreview({
				...request(),
				signal: controller.signal,
			})
		).rejects.toThrow();
		expect(render).not.toHaveBeenCalled();
	});
	it("snapshots pixels and adjustments before decoding history", async () => {
		const value = request();
		readSourcePreRoll.mockImplementationOnce(async ({ sourceKey }) => {
			value.source.data[0] = 99;
			value.adjustments.values.face_adjust_TotalFace = 90;
			return { sourceKey, frames: [] };
		});
		await renderJianyingPortraitAdjustmentPreview(value);
		expect(render.mock.calls[0][0].rgba[0]).toBe(10);
		expect(
			render.mock.calls[0][0].adjustments.values.face_adjust_TotalFace
		).toBe(25);
	});
	it("snapshots combined body geometry for the same atomic source replay", async () => {
		const adjustments = {
			enabled: true,
			values: { body_adjust_SlimBody: 35 },
			manualBody: { stretch: { intensity: 20, upper: 0.7, bottom: 0.2 } },
		};
		readSourcePreRoll.mockImplementationOnce(async ({ sourceKey }) => {
			adjustments.manualBody.stretch.upper = 0.9;
			adjustments.values.body_adjust_SlimBody = 60;
			return {
				sourceKey,
				frames: [
					{ timestampSeconds: 0.9, rgba: new Uint8Array([5, 6, 7, 255]) },
				],
			};
		});
		await renderJianyingPortraitAdjustmentPreview({
			...request(),
			adjustments,
		});
		expect(render).toHaveBeenCalledOnce();
		expect(render.mock.calls[0][0]).toMatchObject({
			freshTracking: true,
			adjustments: {
				values: { body_adjust_SlimBody: 35 },
				manualBody: { stretch: { intensity: 20, upper: 0.7, bottom: 0.2 } },
			},
			sourcePreRoll: { frames: [{ timestampSeconds: 0.9 }] },
		});
	});
	it("discards cancelled body output and starts the next request with fresh history", async () => {
		const controller = new AbortController();
		const value = {
			...request(),
			adjustments: {
				enabled: true,
				values: { body_adjust_SlimBody: 35 },
				manualBody: { stretch: { intensity: 20, upper: 0.7, bottom: 0.2 } },
			},
		};
		render.mockImplementationOnce(async () => {
			controller.abort();
			return {
				provider: "jianying-local-swing-v1",
				width: 1,
				height: 1,
				rgba: new Uint8Array([20, 30, 40, 255]),
				activeGroups: [],
			};
		});
		await expect(
			renderJianyingPortraitAdjustmentPreview({
				...value,
				signal: controller.signal,
			})
		).rejects.toThrow(/abort/i);
		expect(await renderJianyingPortraitAdjustmentPreview(value)).not.toBeNull();
		expect(readSourcePreRoll).toHaveBeenCalledTimes(2);
		expect(render.mock.calls[1][0]).toMatchObject({
			freshTracking: true,
			sourcePreRoll: { frames: [{ timestampSeconds: 0.9 }] },
		});
	});
	it("discards a completed replay when its caller cancelled during native work", async () => {
		const controller = new AbortController();
		render.mockImplementationOnce(async () => {
			controller.abort();
			return {
				provider: "jianying-local-swing-v1",
				width: 1,
				height: 1,
				rgba: new Uint8Array(4),
				activeGroups: ["face"],
			};
		});
		await expect(
			renderJianyingPortraitAdjustmentPreview({
				...request(),
				signal: controller.signal,
			})
		).rejects.toThrow(/abort/i);
		expect(render).toHaveBeenCalledOnce();
	});
});
