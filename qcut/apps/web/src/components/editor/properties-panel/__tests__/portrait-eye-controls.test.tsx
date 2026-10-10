import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { fireEvent, render, screen } from "@/test/test-utils";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitAdjustmentSection } from "../portrait/portrait-adjustment-controls";

const controls = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
	({ section }) => section === "features"
);

function Harness({ ready = true }: { ready?: boolean }) {
	const [adjustments, onChange] = useState<MediaPortraitAdjustments>({
		enabled: true,
		values: { face_adjust_eye: 20, face_adjust_eye_position: -10 },
	});
	return (
		<>
			<PortraitAdjustmentSection
				section="features"
				controls={controls}
				adjustments={adjustments}
				disabled={false}
				locale="zh"
				isControlReady={(control) =>
					ready || control.runtimePackage !== "eye-details"
				}
				onChange={onChange}
				onInteractionStart={vi.fn()}
				onInteractionEnd={vi.fn()}
			/>
			<output data-testid="eye-values">
				{JSON.stringify(adjustments.values)}
			</output>
		</>
	);
}

describe("eye control layout", () => {
	it("shows six canonical controls and their distinct ranges", () => {
		render(<Harness />);
		expect(
			screen
				.getAllByRole("slider")
				.map((slider) => [
					slider.getAttribute("aria-label"),
					slider.getAttribute("aria-valuemin"),
					slider.getAttribute("aria-valuemax"),
				])
		).toEqual([
			["大眼", "0", "100"],
			["亮眼", "0", "100"],
			["眼距", "-50", "50"],
			["开眼角", "0", "100"],
			["眼高低", "-50", "50"],
			["眼倾斜", "-100", "100"],
		]);
	});
	it("clamps, resets one control, and preserves old detail parameters", () => {
		render(<Harness />);
		const bright = screen.getByLabelText("亮眼数值");
		fireEvent.change(bright, { target: { value: "150" } });
		fireEvent.blur(bright);
		expect(bright).toHaveValue("100");
		const spacing = screen.getByLabelText("眼距数值");
		fireEvent.change(spacing, { target: { value: "-70" } });
		fireEvent.blur(spacing);
		expect(spacing).toHaveValue("-50");
		fireEvent.click(screen.getByRole("button", { name: "重置亮眼" }));
		expect(
			JSON.parse(screen.getByTestId("eye-values").textContent ?? "{}")
		).toEqual({
			face_adjust_eye: 20,
			face_adjust_eye_position: -10,
			face_adjust_BrightEye: 0,
			face_adjust_EyeSpacing: -50,
		});
		fireEvent.click(screen.getByRole("button", { name: "精修" }));
		expect(screen.getByLabelText("眼睛大小（精修）数值")).toHaveValue("20");
		expect(screen.getByLabelText("眼睛高低（精修）数值")).toHaveValue("-10");
	});
	it("disables bright eye only when its independent package is unavailable", () => {
		render(<Harness ready={false} />);
		expect(screen.getByLabelText("亮眼数值")).toBeDisabled();
		expect(screen.getByLabelText("大眼数值")).not.toBeDisabled();
		expect(screen.getByLabelText("开眼角数值")).not.toBeDisabled();
	});
});
