import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilterComparisonLab } from "../filter-comparison-lab";
import type { FilterComparisonResult } from "@/types/electron";
const compare = vi.fn();
const image = {
	name: "input",
	png: "data:image/png;base64,AA==",
	sha256: "test",
};
const result: FilterComparisonResult = {
	schemaVersion: 1,
	createdAt: "2026-09-08T00:00:00Z",
	resourceId: "7160594413847203085",
	version: "v",
	width: 320,
	height: 180,
	intensity: 100,
	candidateProvider: "qcut-metal-fog-v1",
	referenceProvider: "qcut-cpp-fog-v1",
	candidateBinarySha256: "test",
	referenceBinarySha256: "test",
	lutRgbaSha256: "test",
	platform: "test",
	metrics: {
		rgbMae: 0.1,
		rgbRmse: 0.2,
		rgbMax: 2,
		alphaMax: 0,
		changedPixels: 20,
		pixelCount: 57600,
	},
	differenceGain: 8,
	input: image,
	candidate: image,
	reference: image,
	difference: image,
	referenceStages: [
		{ ...image, name: "01-blur-x" },
		{ ...image, name: "04-lut" },
	],
};
beforeEach(() => {
	compare.mockReset().mockResolvedValue(result);
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: { qcutIndependentFilter: { compare } },
	});
});
describe("filter comparison UI", () => {
	it("runs a shared frame, displays honest metrics/stages and downloads a self-contained report", async () => {
		render(<FilterComparisonLab />);
		fireEvent.click(screen.getByRole("button", { name: "运行同图对照" }));
		await screen.findByText(/对照完成/);
		expect(compare).toHaveBeenCalledWith(
			expect.objectContaining({ width: 320, height: 180, intensity: 100 })
		);
		expect(compare.mock.calls[0][0].rgba).toHaveLength(320 * 180 * 4);
		expect(screen.getByAltText("QCut Metal 输出")).toBeVisible();
		expect(screen.getByText("0.1000")).toBeVisible();
		fireEvent.change(screen.getByLabelText("C++ 计算阶段"), {
			target: { value: "01-blur-x" },
		});
		expect(screen.getByAltText("C++：横向模糊")).toBeVisible();
		const link = screen.getByRole("link", { name: /下载对照报告/ });
		expect(link).toHaveAttribute("download", "qcut-fog-comparison.json");
		expect(link.getAttribute("href")).toMatch(/^blob:/);
		fireEvent.change(screen.getByLabelText("对照强度"), {
			target: { value: "40" },
		});
		expect(
			screen.queryByTestId("filter-comparison-results")
		).not.toBeInTheDocument();
	});
	it("disables concurrent controls and recovers after a backend error", async () => {
		compare.mockRejectedValueOnce(new Error("missing LUT"));
		render(<FilterComparisonLab />);
		fireEvent.click(screen.getByRole("button", { name: "运行同图对照" }));
		expect(screen.getByLabelText("对照强度")).toBeDisabled();
		await screen.findByRole("alert");
		expect(screen.getByText("missing LUT")).toBeVisible();
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "运行同图对照" })).toBeEnabled()
		);
		fireEvent.click(screen.getByRole("button", { name: "运行同图对照" }));
		await screen.findByText(/对照完成/);
	});
	it("does not offer a fake fallback when the desktop API is absent", () => {
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: undefined,
		});
		render(<FilterComparisonLab />);
		expect(screen.getByRole("button", { name: "运行同图对照" })).toBeDisabled();
		expect(screen.getByRole("alert")).toHaveTextContent("macOS");
	});
});
