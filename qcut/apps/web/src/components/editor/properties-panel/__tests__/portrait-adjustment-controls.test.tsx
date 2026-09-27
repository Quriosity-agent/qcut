import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@/test/test-utils";
import type { JianyingPortraitAdjustmentControl } from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitAdjustmentSection } from "../portrait-adjustment-controls";

const controls: JianyingPortraitAdjustmentControl[] = [
	{
		key: "face_adjust_MoveNose",
		group: "face",
		section: "features",
		category: "details",
		titleZh: "基础",
		titleEn: "Classic",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_nose_position",
		group: "face",
		section: "features",
		category: "nose",
		titleZh: "鼻高低",
		titleEn: "Nose",
		min: -50,
		max: 50,
		step: 1,
	},
	{
		key: "face_adjust_inner_corner",
		group: "face",
		section: "features",
		category: "eyes",
		titleZh: "开眼角",
		titleEn: "Corners",
		min: 0,
		max: 100,
		step: 1,
	},
];
function Harness() {
	const [adjustments, setAdjustments] = useState<MediaPortraitAdjustments>({
		enabled: true,
		values: {
			face_adjust_nose_position: -48,
			face_adjust_inner_corner: 99,
			face_adjust_Smooth: 80,
		},
	});
	return (
		<>
			<PortraitAdjustmentSection
				section="features"
				controls={controls}
				adjustments={adjustments}
				disabled={false}
				locale="zh"
				isControlReady={() => true}
				onChange={setAdjustments}
				onInteractionStart={vi.fn()}
				onInteractionEnd={vi.fn()}
			/>
			<output data-testid="values">{JSON.stringify(adjustments.values)}</output>
		</>
	);
}

describe("portrait anatomical navigation", () => {
	it("orders anatomy independently of catalog insertion order", () => {
		render(<Harness />);
		const categories = screen.getByLabelText("五官分组");
		expect(
			within(categories)
				.getAllByRole("button")
				.map((button) => button.textContent)
		).toEqual(["眼睛", "鼻子", "精修"]);
		expect(screen.getByLabelText("开眼角数值")).toHaveValue("99");
	});
	it("resets one control without clearing other facial or skin values", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "重置开眼角" }));
		expect(
			JSON.parse(screen.getByTestId("values").textContent ?? "{}")
		).toEqual({
			face_adjust_nose_position: -48,
			face_adjust_inner_corner: 0,
			face_adjust_Smooth: 80,
		});
	});
	it("resets the entire section across categories while preserving skin", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "重置本组" }));
		expect(
			JSON.parse(screen.getByTestId("values").textContent ?? "{}")
		).toEqual({ face_adjust_Smooth: 80 });
	});
});
