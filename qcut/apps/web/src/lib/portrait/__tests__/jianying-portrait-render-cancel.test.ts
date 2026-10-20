import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderJianyingPortraitAdjustmentPreview } from "../jianying-portrait-adjustment-preview";
import type {
	JianyingPortraitAdjustmentRenderRequest,
	JianyingPortraitAdjustmentRenderResult,
} from "@/types/electron/api-jianying-portrait-adjustment";

const source = {
	width: 1,
	height: 1,
	data: new Uint8ClampedArray([10, 20, 30, 255]),
	colorSpace: "srgb",
} as ImageData;
const output: JianyingPortraitAdjustmentRenderResult = {
	provider: "jianying-local-swing-v1",
	width: 1,
	height: 1,
	rgba: new Uint8Array([20, 30, 40, 255]),
	activeGroups: ["body"],
};
beforeEach(() => {
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
});
afterEach(() => vi.unstubAllGlobals());

describe("native portrait cancellation adapter", () => {
	it("sends the exact active request ID and rejects before native completion", async () => {
		let complete: (result: JianyingPortraitAdjustmentRenderResult) => void =
			() => {};
		const render = vi.fn(
			(_request: JianyingPortraitAdjustmentRenderRequest) =>
				new Promise<JianyingPortraitAdjustmentRenderResult>((resolve) => {
					complete = resolve;
				})
		);
		const cancel = vi.fn(async () => true);
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { jianyingPortraitAdjustment: { render, cancel } },
		});
		const controller = new AbortController();
		const pending = renderJianyingPortraitAdjustmentPreview({
			source,
			adjustments: { enabled: true, values: { body_adjust_SlimBody: 40 } },
			sourceKey: "video:a",
			timestampSeconds: 0,
			portraitTemporalMode: "source-window",
			readSourcePreRoll: async ({ sourceKey }) => ({ sourceKey, frames: [] }),
			signal: controller.signal,
		});
		await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
		const rejected = expect(pending).rejects.toMatchObject({
			name: "AbortError",
		});
		controller.abort();
		await rejected;
		expect(cancel).toHaveBeenCalledWith({
			requestId: render.mock.calls[0][0].requestId,
		});
		expect(render.mock.calls[0][0]).toMatchObject({
			freshTracking: true,
			sourceKey: "source-window-v1:video:a",
		});
		complete(output);
		await Promise.resolve();
		expect(cancel).toHaveBeenCalledOnce();
	});
	it("removes the abort listener once the render succeeds", async () => {
		const render = vi.fn(async () => output);
		const cancel = vi.fn(async () => true);
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { jianyingPortraitAdjustment: { render, cancel } },
		});
		const controller = new AbortController();
		const result = await renderJianyingPortraitAdjustmentPreview({
			source,
			adjustments: { enabled: true, values: { body_adjust_SlimBody: 40 } },
			signal: controller.signal,
		});
		expect([...result!.data]).toEqual([...output.rgba]);
		controller.abort();
		expect(cancel).not.toHaveBeenCalled();
	});
	it("does not submit an already aborted request", async () => {
		const render = vi.fn();
		const cancel = vi.fn();
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { jianyingPortraitAdjustment: { render, cancel } },
		});
		const controller = new AbortController();
		controller.abort();
		await expect(
			renderJianyingPortraitAdjustmentPreview({
				source,
				adjustments: { enabled: true, values: { body_adjust_SlimBody: 40 } },
				signal: controller.signal,
			})
		).rejects.toMatchObject({ name: "AbortError" });
		expect(render).not.toHaveBeenCalled();
		expect(cancel).not.toHaveBeenCalled();
	});
});
