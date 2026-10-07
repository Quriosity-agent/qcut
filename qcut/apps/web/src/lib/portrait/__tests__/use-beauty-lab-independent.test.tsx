import { createHash, webcrypto } from "node:crypto";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	BeautyLabAPI,
	BeautyLabIndependentRequest,
	BeautyLabIndependentResult,
	JianyingPortraitAdjustmentStatus,
} from "@/types/electron";
import { BEAUTY_LAB_INDEPENDENT_PROVIDER } from "@/types/electron";
import { readComparisonImage } from "@/components/editor/media-panel/views/adjustments/filter-comparison-input";
import { useBeautyLab } from "../use-beauty-lab";

vi.mock(
	"@/components/editor/media-panel/views/adjustments/filter-comparison-input",
	() => ({ readComparisonImage: vi.fn() })
);
const png = new Uint8Array(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWJ0AAAAASUVORK5CYII=",
		"base64"
	)
);
const pixels = new Uint8Array([10, 20, 30, 255]);
const output = new Uint8Array([12, 20, 30, 255]);
const hash = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");
function result({
	request,
}: {
	request: BeautyLabIndependentRequest;
}): BeautyLabIndependentResult {
	return {
		provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
		requestId: request.requestId,
		sourceKey: request.sourceKey,
		width: 1,
		height: 1,
		rgba: output.slice(),
		png: png.slice(),
		inputSha256: hash({ bytes: request.rgba }),
		outputSha256: hash({ bytes: output }),
		report: {
			passed: true,
			outputPngSha256: hash({ bytes: png }),
			nativeInputsUsed: false,
			nativeGeometryUsed: false,
			nativeFallbackUsed: false,
			nativeProductParityVerified: false,
		},
	};
}
const independent = vi.fn<NonNullable<BeautyLabAPI["renderIndependent"]>>();
const cancel = vi.fn<NonNullable<BeautyLabAPI["cancelIndependent"]>>();
const native = vi.fn();
const candidate = vi.fn();
const image = new File(["test"], "test.png", { type: "image/png" });
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("crypto", webcrypto);
	vi.mocked(readComparisonImage).mockResolvedValue({
		name: "photo",
		width: 1,
		height: 1,
		rgba: pixels.slice(),
		resized: false,
	});
	independent.mockImplementation(async (request) => result({ request }));
	cancel.mockResolvedValue({ cancelled: true });
	native.mockResolvedValue({
		provider: "jianying-local-swing-v1",
		width: 1,
		height: 1,
		rgba: new Uint8Array([11, 20, 30, 255]),
	});
	window.electronAPI = {
		beautyLab: {
			listResearchCases: async () => [],
			loadResearchFrame: vi.fn(),
			inspectCandidate: vi.fn(async () => ({ available: false })),
			renderCandidate: candidate,
			inspectIndependent: async () => ({
				available: true,
				provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
				message: "test-only protocol stub",
				controls: ["face_adjust_Nose"],
				makeupCards: [],
			}),
			renderIndependent: independent,
			cancelIndependent: cancel,
		},
		jianyingPortraitAdjustment: {
			inspect: async () =>
				({ available: true }) as JianyingPortraitAdjustmentStatus,
			render: native,
			detect: vi.fn(),
		},
	} as unknown as typeof window.electronAPI;
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
async function workspace() {
	const hook = renderHook(() =>
		useBeautyLab({
			elementId: "test",
			currentFrame: 0,
			initialAdjustments: { enabled: true, values: { face_adjust_Nose: 30 } },
		})
	);
	await act(async () => {});
	await act(async () => {
		await hook.result.current.importImage({ file: image });
	});
	return hook;
}
describe("native and independent lab paths", () => {
	it("blocks unsupported active selections while keeping native usable", async () => {
		const hook = await workspace();
		act(() =>
			hook.result.current.changeAdjustments({
				enabled: true,
				values: { face_adjust_Whiten: 45 },
			})
		);
		expect(hook.result.current.independent.blocker).toContain(
			"face_adjust_Whiten"
		);
		await act(async () => {
			await hook.result.current.independent.render();
			await hook.result.current.renderNative();
		});
		expect(independent).not.toHaveBeenCalled();
		expect(native).toHaveBeenCalledOnce();
	});
	it("does not invoke independent or hybrid processing when native fails", async () => {
		const hook = await workspace();
		native.mockRejectedValueOnce(new Error("native failed"));
		await act(async () => {
			await hook.result.current.renderNative();
		});
		expect(hook.result.current.error).toContain("native failed");
		expect(independent).not.toHaveBeenCalled();
		expect(candidate).not.toHaveBeenCalled();
	});
	it.each([
		"native-first",
		"independent-first",
	])("preserves both same-input results: %s", async (order) => {
		const { result } = await workspace();
		const actions =
			order === "native-first"
				? ["native", "independent"]
				: ["independent", "native"];
		for (const action of actions) {
			await act(async () => {
				if (action === "native") await result.current.renderNative();
				else await result.current.independent.render();
			});
		}
		expect(result.current.native?.rgba[0]).toBe(11);
		expect(result.current.independent.frame?.rgba).toEqual(output);
		expect(independent).toHaveBeenCalledOnce();
		expect(native).toHaveBeenCalledOnce();
		expect(candidate).not.toHaveBeenCalled();
		const ownRequest = independent.mock.calls[0][0];
		expect(native.mock.calls[0][0].sourceKey).toBe(ownRequest.sourceKey);
		expect(ownRequest.rgba).toEqual(pixels);
	});
	it("invalidates both results when parameters change", async () => {
		const { result } = await workspace();
		await act(async () => {
			await result.current.independent.render();
		});
		await act(async () => {
			await result.current.renderNative();
		});
		act(() =>
			result.current.changeAdjustments({
				enabled: true,
				values: { face_adjust_Nose: 40 },
			})
		);
		expect(result.current.native).toBeNull();
		expect(result.current.independent.frame).toBeNull();
		expect(result.current.independent.report).toBeNull();
	});
	it("reports independent failures without switching to native or hybrid", async () => {
		independent.mockRejectedValueOnce(new Error("unsupported makeup"));
		const { result } = await workspace();
		await act(async () => {
			await result.current.independent.render();
		});
		expect(result.current.error).toContain("unsupported makeup");
		expect(native).not.toHaveBeenCalled();
		expect(candidate).not.toHaveBeenCalled();
	});
	it.each([
		"wrong-provider",
		"wrong-source",
		"wrong-input-hash",
		"changed-pixels",
	])("rejects independent output with %s", async (failure) => {
		independent.mockImplementationOnce(async (request) => {
			const value = result({ request });
			if (failure === "wrong-provider")
				return {
					...value,
					provider: "native",
				} as unknown as BeautyLabIndependentResult;
			if (failure === "wrong-source") value.sourceKey = "other";
			if (failure === "wrong-input-hash") value.inputSha256 = "0".repeat(64);
			if (failure === "changed-pixels") value.rgba[0] = 13;
			return value;
		});
		const hook = await workspace();
		await act(async () => {
			await hook.result.current.independent.render();
		});
		expect(hook.result.current.independent.frame).toBeNull();
		expect(hook.result.current.error).toBeTruthy();
		expect(native).not.toHaveBeenCalled();
	});
	it.each([
		"cancel",
		"new-input",
		"new-parameters",
	])("discards completed old pixels after %s and allows retry", async (change) => {
		let finish = () => {};
		independent.mockImplementationOnce(
			(request) =>
				new Promise((resolve) => {
					finish = () => resolve(result({ request }));
				})
		);
		const hook = await workspace();
		let pending = Promise.resolve();
		act(() => {
			pending = hook.result.current.independent.render();
		});
		if (change === "cancel")
			await act(async () => {
				await hook.result.current.independent.cancel();
			});
		if (change === "new-input")
			await act(async () => {
				await hook.result.current.importImage({ file: image });
			});
		if (change === "new-parameters")
			act(() =>
				hook.result.current.changeAdjustments({
					enabled: true,
					values: { face_adjust_Nose: 40 },
				})
			);
		await act(async () => {
			await hook.result.current.independent.render();
			await hook.result.current.renderNative();
		});
		expect(independent).toHaveBeenCalledOnce();
		expect(native).not.toHaveBeenCalled();
		await act(async () => {
			finish();
			await pending;
		});
		expect(hook.result.current.independent.frame).toBeNull();
		expect(hook.result.current.independent.job).toBeNull();
		await act(async () => {
			await hook.result.current.independent.render();
		});
		expect(hook.result.current.independent.frame?.rgba).toEqual(output);
	});
	it("cancels the active worker when the lab closes", async () => {
		independent.mockImplementationOnce(() => new Promise(() => {}));
		const hook = await workspace();
		act(() => {
			void hook.result.current.independent.render();
		});
		hook.unmount();
		expect(cancel).toHaveBeenCalledWith({
			requestId: independent.mock.calls[0][0].requestId,
		});
	});
});
