import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { fireEvent, render, screen } from "@/test/test-utils";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitAdjustmentSection } from "../portrait-adjustment-controls";

const controls = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
	({ section }) => section === "features"
);
function Harness({ ready = true }: { ready?: boolean }) {
	const [adjustments, onChange] = useState<MediaPortraitAdjustments>({
		enabled: true,
		values: { face_adjust_mouse_width: 20 },
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
					ready || control.runtimePackage !== "smile"
				}
				onChange={onChange}
				onInteractionStart={vi.fn()}
				onInteractionEnd={vi.fn()}
			/>
			<output data-testid="mouth-values">
				{JSON.stringify(adjustments.values)}
			</output>
		</>
	);
}
describe("mouth control layout", () => {
	it("shows canonical order, independent ranges, and keeps legacy values accessible", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "嘴巴" }));
		expect(
			screen
				.getAllByRole("slider")
				.map((slider) => slider.getAttribute("aria-label"))
		).toEqual(["白牙", "嘴大小", "嘴高低", "嘴倾斜", "微笑唇", "笑容"]);
		const lips = screen.getByLabelText("微笑唇数值");
		fireEvent.change(lips, { target: { value: "-70" } });
		fireEvent.blur(lips);
		expect(lips).toHaveValue("-50");
		const smile = screen.getByLabelText("笑容数值");
		fireEvent.change(smile, { target: { value: "100" } });
		fireEvent.blur(smile);
		fireEvent.click(screen.getByRole("button", { name: "重置微笑唇" }));
		expect(
			JSON.parse(screen.getByTestId("mouth-values").textContent ?? "{}")
		).toEqual({
			face_adjust_mouse_width: 20,
			face_adjust_mouse_corner: 0,
			face_adjust_Smile: 100,
		});
		fireEvent.click(screen.getByRole("button", { name: "精修" }));
		expect(screen.getByLabelText("嘴巴宽度数值")).toHaveValue("20");
	});
	it("disables only the missing package", () => {
		render(<Harness ready={false} />);
		fireEvent.click(screen.getByRole("button", { name: "嘴巴" }));
		expect(screen.getByLabelText("笑容数值")).toBeDisabled();
		expect(screen.getByLabelText("微笑唇数值")).not.toBeDisabled();
		expect(screen.getByLabelText("嘴大小数值")).not.toBeDisabled();
	});
});
