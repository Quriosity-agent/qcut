import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@/test/test-utils";
import type { BeautyLabIndependentStatus } from "@/types/electron";
import { useIndependentPortraitStatus } from "../use-independent-portrait-status";

const ready: BeautyLabIndependentStatus = {
	available: true,
	provider: "qcut-independent-photo-v1",
	message: "ready",
	controls: ["body_adjust_StretchLeg"],
	makeupCards: [],
};

afterEach(() => Reflect.deleteProperty(window, "electronAPI"));

describe("independent portrait capability inspection", () => {
	it("ignores a prior engine selection's late response", async () => {
		let finishOld: (status: BeautyLabIndependentStatus) => void = () => {};
		const inspectIndependent = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<BeautyLabIndependentStatus>((resolve) => {
						finishOld = resolve;
					})
			)
			.mockResolvedValueOnce({ ...ready, controls: ["body_adjust_SlimWaist"] });
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { beautyLab: { inspectIndependent } },
		});
		const { result, rerender } = renderHook(
			({ enabled }) => useIndependentPortraitStatus({ enabled }),
			{ initialProps: { enabled: true } }
		);
		expect(result.current.loading).toBe(true);
		rerender({ enabled: false });
		expect(result.current.status).toBeNull();
		rerender({ enabled: true });
		await waitFor(() =>
			expect(result.current.status?.controls).toEqual(["body_adjust_SlimWaist"])
		);
		await act(async () => finishOld(ready));
		expect(result.current.status?.controls).toEqual(["body_adjust_SlimWaist"]);
		expect(inspectIndependent).toHaveBeenCalledTimes(2);
	});

	it("reports inspection failures without retaining stale capabilities", async () => {
		const inspectIndependent = vi
			.fn()
			.mockResolvedValueOnce(ready)
			.mockRejectedValueOnce(new Error("runtime removed"));
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: { beautyLab: { inspectIndependent } },
		});
		const { result, rerender } = renderHook(
			({ enabled }) => useIndependentPortraitStatus({ enabled }),
			{ initialProps: { enabled: true } }
		);
		await waitFor(() => expect(result.current.status?.available).toBe(true));
		rerender({ enabled: false });
		rerender({ enabled: true });
		expect(result.current.status).toBeNull();
		await waitFor(() =>
			expect(result.current.error).toContain("runtime removed")
		);
		expect(result.current.status).toBeNull();
		expect(result.current.loading).toBe(false);
	});

	it("only needs desktop inspection when the independent engine is selected", () => {
		const { result, rerender } = renderHook(
			({ enabled }) => useIndependentPortraitStatus({ enabled }),
			{ initialProps: { enabled: false } }
		);
		expect(result.current.error).toBeNull();
		rerender({ enabled: true });
		expect(result.current.error).toBe("Requires QCut Desktop");
		expect(result.current.loading).toBe(false);
	});
});
