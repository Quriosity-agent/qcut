import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderJianyingPortraitAdjustmentPreview } from "../jianying-portrait-adjustment-preview";
import type { JianyingPortraitAdjustmentRenderRequest } from "@/types/electron/api-jianying-portrait-adjustment";

function imageData({ data }: { data: number[] }): ImageData {
	return {
		width: data.length / 4,
		height: 1,
		data: new Uint8ClampedArray(data),
		colorSpace: "srgb",
	} as ImageData;
}

describe("Jianying portrait adjustment preview", () => {
	afterEach(() => vi.unstubAllGlobals());
	beforeEach(() => {
		vi.stubGlobal(
			"ImageData",
			class {
				data: Uint8ClampedArray;
				width: number;
				height: number;
				colorSpace = "srgb";

				constructor(data: Uint8ClampedArray, width: number, height: number) {
					this.data = data;
					this.width = width;
					this.height = height;
				}
			}
		);
	});

	it("sends exact pixels, source identity, time, and non-destructive settings", async () => {
		const render = vi.fn(async () => ({
			provider: "jianying-local-swing-v1" as const,
			width: 1,
			height: 1,
			rgba: new Uint8Array([90, 80, 70, 255]),
			activeGroups: ["face" as const],
		}));
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { jianyingPortraitAdjustment: { render } },
		});
		const adjustments = {
			enabled: true,
			values: { face_adjust_TotalFace: 75 },
			skinToneResourceId: "7408757645705776384",
		} as const;
		const result = await renderJianyingPortraitAdjustmentPreview({
			source: imageData({ data: [10, 20, 30, 255] }),
			adjustments,
			frameNumber: 30,
			sourceKey: "video:portrait",
			timestampSeconds: 1.25,
		});
		expect(render).toHaveBeenCalledWith({
			width: 1,
			height: 1,
			rgba: expect.any(Uint8Array),
			adjustments,
			frameNumber: 30,
			sourceKey: "video:portrait",
			timestampSeconds: 1.25,
		});
		expect(Array.from(result?.data ?? [])).toEqual([90, 80, 70, 255]);
	});

	it("does not call Electron for neutral settings", async () => {
		const render = vi.fn();
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { jianyingPortraitAdjustment: { render } },
		});
		const source = imageData({ data: [10, 20, 30, 255] });
		const result = await renderJianyingPortraitAdjustmentPreview({
			source,
			adjustments: {
				enabled: true,
				skinToneResourceId: null,
				values: { face_adjust_skin_ColdWarm: 25 },
			},
		});
		expect(result).toBe(source);
		expect(render).not.toHaveBeenCalled();
	});
	it("retries once with real history and exactly the same target request", async () => {
		const render = vi.fn(
			async (_request: JianyingPortraitAdjustmentRenderRequest) => ({
				provider: "jianying-local-swing-v1" as const,
				width: 1,
				height: 1,
				rgba: new Uint8Array([10, 20, 30, 255]),
				activeGroups: ["face" as const],
				needsSourcePreRoll: true,
			})
		);
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { jianyingPortraitAdjustment: { render } },
		});
		const preRoll = {
			sourceKey: "video:A",
			frames: [{ timestampSeconds: 1, rgba: new Uint8Array([1, 2, 3, 255]) }],
		};
		const readSourcePreRoll = vi.fn(async () => preRoll);
		await renderJianyingPortraitAdjustmentPreview({
			source: imageData({ data: [10, 20, 30, 255] }),
			adjustments: { enabled: true, values: { face_adjust_EnlargeEye: 60 } },
			sourceKey: "video:A",
			timestampSeconds: 1.1,
			frameNumber: 33,
			readSourcePreRoll,
		});
		expect(render).toHaveBeenCalledTimes(2);
		expect(render.mock.calls[1][0]).toEqual({
			...render.mock.calls[0][0],
			sourcePreRoll: preRoll,
		});
		expect(readSourcePreRoll).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceKey: "video:A",
				timestampSeconds: 1.1,
				width: 1,
				height: 1,
			})
		);
	});
	it("snapshots target pixels and adjustments before an asynchronous recovery", async () => {
		const source = imageData({ data: [10, 20, 30, 255] });
		const adjustments = {
			enabled: true,
			values: { face_adjust_EnlargeEye: 60 },
		};
		const render = vi.fn(
			async (_request: JianyingPortraitAdjustmentRenderRequest) => ({
				provider: "jianying-local-swing-v1" as const,
				width: 1,
				height: 1,
				rgba: new Uint8Array([10, 20, 30, 255]),
				activeGroups: ["face" as const],
				needsSourcePreRoll: true,
			})
		);
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { jianyingPortraitAdjustment: { render } },
		});
		await renderJianyingPortraitAdjustmentPreview({
			source,
			adjustments,
			sourceKey: "video:A",
			timestampSeconds: 1.1,
			readSourcePreRoll: async () => {
				source.data[0] = 200;
				adjustments.values.face_adjust_EnlargeEye = 0;
				return {
					sourceKey: "video:A",
					frames: [{ timestampSeconds: 1, rgba: new Uint8Array(4) }],
				};
			},
		});
		expect(render.mock.calls[1][0].rgba[0]).toBe(10);
		expect(
			render.mock.calls[1][0].adjustments.values.face_adjust_EnlargeEye
		).toBe(60);
	});
	it("rejects a mismatched initial render before requesting source history", async () => {
		const render = vi.fn(async () => ({
			provider: "jianying-local-swing-v1" as const,
			width: 2,
			height: 1,
			rgba: new Uint8Array(4),
			activeGroups: ["face" as const],
			needsSourcePreRoll: true,
		}));
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { jianyingPortraitAdjustment: { render } },
		});
		const readSourcePreRoll = vi.fn(async () => undefined);
		expect(
			await renderJianyingPortraitAdjustmentPreview({
				source: imageData({ data: [10, 20, 30, 255] }),
				adjustments: { enabled: true, values: { face_adjust_EnlargeEye: 60 } },
				sourceKey: "video:A",
				timestampSeconds: 1.1,
				readSourcePreRoll,
			})
		).toBeNull();
		expect(readSourcePreRoll).not.toHaveBeenCalled();
	});
	it.each([
		"before-decode",
		"after-decode",
	])("does not dispatch recovery when cancelled %s", async (phase) => {
		const controller = new AbortController();
		const render = vi.fn(async () => {
			if (phase === "before-decode") controller.abort();
			return {
				provider: "jianying-local-swing-v1" as const,
				width: 1,
				height: 1,
				rgba: new Uint8Array(4),
				activeGroups: ["face" as const],
				needsSourcePreRoll: true,
			};
		});
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { jianyingPortraitAdjustment: { render } },
		});
		const readSourcePreRoll = vi.fn(async () => {
			controller.abort();
			return {
				sourceKey: "video:A",
				frames: [{ timestampSeconds: 1, rgba: new Uint8Array(4) }],
			};
		});
		await expect(
			renderJianyingPortraitAdjustmentPreview({
				source: imageData({ data: [10, 20, 30, 255] }),
				adjustments: { enabled: true, values: { face_adjust_EnlargeEye: 60 } },
				sourceKey: "video:A",
				timestampSeconds: 1.1,
				readSourcePreRoll,
				signal: controller.signal,
			})
		).rejects.toThrow();
		expect(render).toHaveBeenCalledOnce();
		expect(readSourcePreRoll).toHaveBeenCalledTimes(
			phase === "before-decode" ? 0 : 1
		);
	});
});
