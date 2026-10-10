import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { fireEvent, render, screen } from "@/test/test-utils";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitAdjustmentSection } from "../portrait/portrait-adjustment-controls";

function Harness({ missing = "" }: { missing?: string }) {
	const [adjustments, onChange] = useState<MediaPortraitAdjustments>({
		enabled: true,
		values: { face_adjust_nose: 12, face_adjust_brow_size: 25 },
	});
	return (
		<>
			<PortraitAdjustmentSection
				section="features"
				controls={JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
					({ section }) => section === "features"
				)}
				adjustments={adjustments}
				disabled={false}
				locale="zh"
				isControlReady={(control) => control.runtimePackage !== missing}
				onChange={onChange}
				onInteractionStart={vi.fn()}
				onInteractionEnd={vi.fn()}
			/>
			<output data-testid="values">{JSON.stringify(adjustments.values)}</output>
		</>
	);
}

function sliderContracts() {
	return screen
		.getAllByRole("slider")
		.map((slider) => [
			slider.getAttribute("aria-label"),
			slider.getAttribute("aria-valuemin"),
			slider.getAttribute("aria-valuemax"),
		]);
}

describe("canonical nose and brow layout", () => {
	it("shows eight nose controls in Jianying order with exact ranges", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "鼻子" }));
		expect(sliderContracts()).toEqual([
			["瘦鼻", "0", "100"],
			["鼻梁", "-50", "50"],
			["鼻高低", "-50", "50"],
			["鼻大小", "-50", "50"],
			["立体鼻", "0", "100"],
			["小翘鼻", "0", "100"],
			["驼峰鼻", "0", "100"],
			["山根", "-50", "50"],
		]);
	});
	it("shows seven brow controls and retains legacy detail values", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "眉毛" }));
		expect(sliderContracts()).toEqual([
			["眉高低", "-50", "50"],
			["眉间距", "-50", "50"],
			["眉峰", "-50", "50"],
			["眉倾斜", "-50", "50"],
			["流畅眉", "0", "100"],
			["柳叶眉", "0", "100"],
			["剑眉", "0", "100"],
		]);
		const field = screen.getByLabelText("剑眉数值");
		fireEvent.change(field, { target: { value: "150" } });
		fireEvent.blur(field);
		expect(field).toHaveValue("100");
		fireEvent.click(screen.getByRole("button", { name: "重置剑眉" }));
		expect(field).toHaveValue("0");
		fireEvent.click(screen.getByRole("button", { name: "精修" }));
		expect(screen.getByLabelText("眉毛大小数值")).toHaveValue("25");
		expect(screen.getByLabelText("鼻子大小（2D 基础）数值")).toHaveValue("12");
	});
	it("disables only missing packages", () => {
		render(<Harness missing="nose-upturned" />);
		fireEvent.click(screen.getByRole("button", { name: "鼻子" }));
		expect(screen.getByLabelText("小翘鼻数值")).toBeDisabled();
		expect(screen.getByLabelText("立体鼻数值")).not.toBeDisabled();
	});
});
