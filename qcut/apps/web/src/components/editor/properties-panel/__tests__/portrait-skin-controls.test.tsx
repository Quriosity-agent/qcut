import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { fireEvent, render, screen } from "@/test/test-utils";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitAdjustmentSection } from "../portrait/portrait-adjustment-controls";

const labels = [
	"磨皮",
	"美白",
	"匀肤",
	"丰盈",
	"祛斑祛痘",
	"祛法令纹",
	"祛黑眼圈",
	"清晰",
];
const legacyValues = {
	face_adjust_Pouch: 64,
	face_adjust_NasolabialFolds: 32,
	face_adjust_EnlargeEye: 20,
	face_adjust_eye: -10,
};

function Harness({
	section = "skin",
	ready = true,
	disabled = false,
	locale = "zh",
}: {
	section?: "skin" | "features";
	ready?: boolean;
	disabled?: boolean;
	locale?: string;
}) {
	const [adjustments, onChange] = useState<MediaPortraitAdjustments>({
		enabled: true,
		values: legacyValues,
	});
	return (
		<>
			<PortraitAdjustmentSection
				section={section}
				controls={JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
					(control) => control.section === section
				)}
				adjustments={adjustments}
				disabled={disabled}
				locale={locale}
				isControlReady={(control) =>
					ready || control.runtimePackage !== "eye-details"
				}
				onChange={onChange}
				onInteractionStart={vi.fn()}
				onInteractionEnd={vi.fn()}
			/>
			<output data-testid="skin-values">
				{JSON.stringify(adjustments.values)}
			</output>
		</>
	);
}

function values() {
	return JSON.parse(screen.getByTestId("skin-values").textContent ?? "{}");
}

describe("skin management controls", () => {
	it("shows the reference order and preserves tone and warmth below it", () => {
		render(<Harness />);
		const sliders = screen.getAllByRole("slider");
		expect(sliders.map((slider) => slider.getAttribute("aria-label"))).toEqual([
			...labels,
			"肤色",
			"冷暖",
		]);
		for (const slider of sliders.slice(0, 8)) {
			expect(slider).toHaveAttribute("aria-valuemin", "0");
			expect(slider).toHaveAttribute("aria-valuemax", "100");
		}
		expect(
			new Set(JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.map(({ key }) => key)).size
		).toBe(JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.length);
	});
	it("shows old project values under the renamed controls without migration", () => {
		render(<Harness />);
		expect(screen.getByLabelText("祛黑眼圈数值")).toHaveValue("64");
		expect(screen.getByLabelText("祛法令纹数值")).toHaveValue("32");
		expect(values()).toEqual(legacyValues);
		expect(screen.queryByLabelText("淡化眼袋数值")).not.toBeInTheDocument();
	});
	it("clamps and resets individual values without changing other regions", () => {
		render(<Harness />);
		const input = screen.getByLabelText("祛黑眼圈数值");
		fireEvent.change(input, { target: { value: "150" } });
		fireEvent.blur(input);
		expect(input).toHaveValue("100");
		fireEvent.change(input, { target: { value: "-10" } });
		fireEvent.blur(input);
		expect(input).toHaveValue("0");
		fireEvent.click(screen.getByRole("button", { name: "重置祛法令纹" }));
		expect(values()).toEqual({
			...legacyValues,
			face_adjust_Pouch: 0,
			face_adjust_NasolabialFolds: 0,
		});
	});
	it("skin group reset clears the moved values but preserves facial geometry", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "重置本组" }));
		expect(values()).toEqual({
			face_adjust_EnlargeEye: 20,
			face_adjust_eye: -10,
		});
	});
	it("feature group reset no longer clears skin values", () => {
		render(<Harness section="features" />);
		fireEvent.click(screen.getByRole("button", { name: "精修" }));
		expect(screen.queryByLabelText("祛黑眼圈数值")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("祛法令纹数值")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "重置本组" }));
		expect(values()).toEqual({
			face_adjust_Pouch: 64,
			face_adjust_NasolabialFolds: 32,
		});
	});
	it("isolates missing eye-detail resources from other skin controls", () => {
		render(<Harness ready={false} />);
		expect(screen.getByLabelText("祛黑眼圈数值")).toBeDisabled();
		expect(screen.getByLabelText("祛法令纹数值")).toBeDisabled();
		for (const label of labels.filter(
			(label) => !["祛黑眼圈", "祛法令纹"].includes(label)
		)) {
			expect(screen.getByLabelText(`${label}数值`)).not.toBeDisabled();
		}
	});
	it("disables the controls and reset when the section is unavailable", () => {
		render(<Harness disabled />);
		for (const label of labels)
			expect(screen.getByLabelText(`${label}数值`)).toBeDisabled();
		expect(screen.getByRole("button", { name: "重置本组" })).toBeDisabled();
	});
	it("uses dark-circle wording in English without changing its native key", () => {
		render(<Harness locale="en" />);
		expect(
			screen.getByRole("slider", { name: "Reduce dark circles" })
		).toHaveAttribute("aria-valuenow", "64");
		expect(values()).toEqual(legacyValues);
	});
});
