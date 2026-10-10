import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { fireEvent, render, screen } from "@/test/test-utils";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitAdjustmentSection } from "../portrait-adjustment-controls";

function Harness({ ready = true }: { ready?: boolean }) {
	const [adjustments, onChange] = useState<MediaPortraitAdjustments>({
		enabled: true,
		values: { face_adjust_temple: 35, face_adjust_yunfu: 20 },
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
					ready || control.runtimePackage !== "skin-gan"
				}
				onChange={onChange}
				onInteractionStart={vi.fn()}
				onInteractionEnd={vi.fn()}
			/>
			<output data-testid="contour-values">
				{JSON.stringify(adjustments.values)}
			</output>
		</>
	);
}

describe("contour control layout", () => {
	it("places GAN contour first without exposing the legacy temple as contour", () => {
		render(<Harness />);
		expect(screen.getAllByRole("slider")[0]).toHaveAttribute(
			"aria-label",
			"流畅脸"
		);
		expect(
			screen.queryByLabelText("太阳穴（基础）数值")
		).not.toBeInTheDocument();
		const input = screen.getByLabelText("流畅脸数值");
		fireEvent.change(input, { target: { value: "50" } });
		fireEvent.blur(input);
		expect(
			JSON.parse(screen.getByTestId("contour-values").textContent ?? "{}")
		).toEqual({
			face_adjust_temple: 35,
			face_adjust_yunfu: 20,
			face_adjust_lunkuopinghua: 50,
		});
		fireEvent.click(screen.getByRole("button", { name: /^重置流畅脸$/ }));
		expect(input).toHaveValue("0");
		expect(
			JSON.parse(screen.getByTestId("contour-values").textContent ?? "{}")
		).toEqual({
			face_adjust_temple: 35,
			face_adjust_yunfu: 20,
			face_adjust_lunkuopinghua: 0,
		});
	});

	it("disables only GAN contour when that package is missing", () => {
		render(<Harness ready={false} />);
		expect(screen.getByLabelText("流畅脸数值")).toBeDisabled();
		expect(screen.getByLabelText("瘦脸数值")).not.toBeDisabled();
	});

	it("resets face shape without clearing skin or legacy feature values", () => {
		render(<Harness />);
		const input = screen.getByLabelText("流畅脸数值");
		fireEvent.change(input, { target: { value: "50" } });
		fireEvent.blur(input);
		fireEvent.click(screen.getByRole("button", { name: /^重置本组$/ }));
		expect(
			JSON.parse(screen.getByTestId("contour-values").textContent ?? "{}")
		).toEqual({ face_adjust_temple: 35, face_adjust_yunfu: 20 });
	});

	it("keeps the old temple value available in feature details", () => {
		render(
			<PortraitAdjustmentSection
				section="features"
				controls={JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
					({ section }) => section === "features"
				)}
				adjustments={{ enabled: true, values: { face_adjust_temple: 35 } }}
				disabled={false}
				locale="zh"
				isControlReady={() => true}
				onChange={vi.fn()}
				onInteractionStart={vi.fn()}
				onInteractionEnd={vi.fn()}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: /^精修$/ }));
		expect(screen.getByLabelText("太阳穴（基础）数值")).toHaveValue("35");
	});
});
