import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { fireEvent, render, screen } from "@/test/test-utils";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitAdjustmentSection } from "../portrait/portrait-adjustment-controls";

const controls = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
	(control) =>
		"runtimePackage" in control && control.runtimePackage === "feature-tilt"
);

function Harness({ ready = true }: { ready?: boolean }) {
	const [adjustments, onChange] = useState<MediaPortraitAdjustments>({
		enabled: true,
		values: {},
	});
	return (
		<>
			<PortraitAdjustmentSection
				section="features"
				controls={controls}
				adjustments={adjustments}
				disabled={false}
				locale="zh"
				isControlReady={() => ready}
				onChange={onChange}
				onInteractionStart={vi.fn()}
				onInteractionEnd={vi.fn()}
			/>
			<output data-testid="tilt-values">
				{JSON.stringify(adjustments.values)}
			</output>
		</>
	);
}

describe("tilt controls", () => {
	it("uses signed ranges, separate anatomical tabs and independent reset", () => {
		render(<Harness />);
		const eye = screen.getByLabelText("眼倾斜数值");
		const slider = screen.getByRole("slider", { name: "眼倾斜" });
		expect(slider).toHaveAttribute("aria-valuemin", "-100");
		expect(slider).toHaveAttribute("aria-valuemax", "100");
		fireEvent.change(eye, { target: { value: "-120" } });
		fireEvent.blur(eye);
		expect(eye).toHaveValue("-100");
		fireEvent.click(screen.getByRole("button", { name: "嘴巴" }));
		const mouth = screen.getByLabelText("嘴倾斜数值");
		fireEvent.change(mouth, { target: { value: "50" } });
		fireEvent.blur(mouth);
		expect(
			JSON.parse(screen.getByTestId("tilt-values").textContent ?? "{}")
		).toEqual({ face_adjust_EyeTilted: -100, face_adjust_MouthTilted: 50 });
		fireEvent.click(screen.getByRole("button", { name: "重置嘴倾斜" }));
		expect(
			JSON.parse(screen.getByTestId("tilt-values").textContent ?? "{}")
		).toEqual({ face_adjust_EyeTilted: -100, face_adjust_MouthTilted: 0 });
		fireEvent.click(screen.getByRole("button", { name: "重置本组" }));
		expect(screen.getByTestId("tilt-values")).toHaveTextContent("{}");
	});
	it("disables both controls when their shared package is unavailable", () => {
		render(<Harness ready={false} />);
		expect(screen.getByLabelText("眼倾斜数值")).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "嘴巴" }));
		expect(screen.getByLabelText("嘴倾斜数值")).toBeDisabled();
	});
});
