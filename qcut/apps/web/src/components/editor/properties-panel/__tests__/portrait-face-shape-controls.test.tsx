import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import matrix from "../../../../../../../scripts/fixtures/portrait-face-shape-reference.json";
import { fireEvent, render, screen } from "@/test/test-utils";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitAdjustmentSection } from "../portrait-adjustment-controls";

function Harness({
	missingPackage,
}: {
	missingPackage?: "small-face" | "jawline";
}) {
	const [adjustments, onChange] = useState<MediaPortraitAdjustments>({
		enabled: true,
		values: { face_adjust_jaw: 35 },
	});
	return (
		<>
			<PortraitAdjustmentSection
				section="face-shape"
				controls={JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
					({ section }) => section === "face-shape"
				)}
				adjustments={adjustments}
				disabled={false}
				locale="zh"
				isControlReady={(control) =>
					control.runtimePackage !== missingPackage || !missingPackage
				}
				onChange={onChange}
				onInteractionStart={vi.fn()}
				onInteractionEnd={vi.fn()}
			/>
			<output data-testid="shape-values">
				{JSON.stringify(adjustments.values)}
			</output>
		</>
	);
}

function readValues() {
	return JSON.parse(screen.getByTestId("shape-values").textContent ?? "{}");
}

describe("complete face shape controls", () => {
	it("shows all thirteen reference controls first in the same order", () => {
		render(<Harness />);
		expect(
			screen
				.getAllByRole("slider")
				.slice(0, matrix.faceControls.length)
				.map((slider) => slider.getAttribute("aria-label"))
		).toEqual(matrix.faceControls.map(({ label }) => label));
		expect(
			screen.queryByLabelText("下巴轮廓（基础）数值")
		).not.toBeInTheDocument();
	});

	it("keeps small face, short face and legacy chin values separate when editing and resetting", () => {
		render(<Harness />);
		for (const [label, value] of [
			["小脸", "50"],
			["短脸", "25"],
			["下颌线", "75"],
		]) {
			const input = screen.getByLabelText(`${label}数值`);
			fireEvent.change(input, { target: { value } });
			fireEvent.blur(input);
		}
		expect(readValues()).toEqual({
			face_adjust_jaw: 35,
			face_adjust_YouTaiFace: 50,
			face_adjust_SmallFace: 25,
			face_adjust_XiaHeXian: 75,
		});
		fireEvent.click(screen.getByRole("button", { name: /^重置小脸$/ }));
		expect(readValues()).toEqual({
			face_adjust_jaw: 35,
			face_adjust_YouTaiFace: 0,
			face_adjust_SmallFace: 25,
			face_adjust_XiaHeXian: 75,
		});
		fireEvent.click(screen.getByRole("button", { name: /^重置本组$/ }));
		expect(readValues()).toEqual({ face_adjust_jaw: 35 });
	});

	it.each([
		{ missingPackage: "small-face", unavailable: "小脸", available: "下颌线" },
		{ missingPackage: "jawline", unavailable: "下颌线", available: "小脸" },
	] as const)("disables only $unavailable when its package is missing", ({
		missingPackage,
		unavailable,
		available,
	}) => {
		render(<Harness missingPackage={missingPackage} />);
		expect(screen.getByLabelText(`${unavailable}数值`)).toBeDisabled();
		expect(screen.getByLabelText(`${available}数值`)).not.toBeDisabled();
		expect(screen.getByLabelText("短脸数值")).not.toBeDisabled();
	});

	it("retains the old chin control under feature details", () => {
		render(
			<PortraitAdjustmentSection
				section="features"
				controls={JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
					({ section }) => section === "features"
				)}
				adjustments={{ enabled: true, values: { face_adjust_jaw: 35 } }}
				disabled={false}
				locale="zh"
				isControlReady={() => true}
				onChange={vi.fn()}
				onInteractionStart={vi.fn()}
				onInteractionEnd={vi.fn()}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: /^精修$/ }));
		expect(screen.getByLabelText("下巴轮廓（基础）数值")).toHaveValue("35");
	});
});
