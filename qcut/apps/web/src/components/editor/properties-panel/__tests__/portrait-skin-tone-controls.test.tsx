import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test/test-utils";
import { PortraitAdjustmentSection } from "../portrait/portrait-adjustment-controls";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { JIANYING_PORTRAIT_SKIN_TONES } from "../../../../../../../electron/jianying-portrait-adjustment-runtime/skin-tone-catalog";
import type { MediaPortraitAdjustments } from "@/types/timeline";

function Harness({
	initial = { enabled: true, values: {} },
	readOnly = false,
	disabled = false,
	missing = false,
	allowSkinTone = true,
}: {
	initial?: MediaPortraitAdjustments;
	readOnly?: boolean;
	disabled?: boolean;
	missing?: boolean;
	allowSkinTone?: boolean;
}) {
	const [adjustments, onChange] = useState(initial);
	return (
		<>
			<PortraitAdjustmentSection
				section="skin"
				controls={JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
					({ section }) => section === "skin"
				)}
				adjustments={adjustments}
				locale="en"
				disabled={disabled}
				readOnly={readOnly}
				allowSkinTone={allowSkinTone}
				isControlReady={() => true}
				onChange={onChange}
				onInteractionStart={vi.fn()}
				onInteractionEnd={vi.fn()}
				skinTones={JIANYING_PORTRAIT_SKIN_TONES.map((tone) => ({
					...tone,
					ready: !missing,
					defaultIntensity: 60,
					source: "qcut-private",
				}))}
			/>
			<output data-testid="state">{JSON.stringify(adjustments)}</output>
		</>
	);
}
function state() {
	return JSON.parse(screen.getByTestId("state").textContent ?? "{}");
}

describe("real skin resource swatches", () => {
	it("selects actual IDs at catalog strength and preserves warmth when switching", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "Tan" }));
		expect(state()).toMatchObject({
			skinToneResourceId: "7408757645705743616",
			values: { face_adjust_skin_Intensity: 60 },
		});
		const warmth = screen.getByLabelText("Warmth value");
		fireEvent.change(warmth, { target: { value: "-25" } });
		fireEvent.blur(warmth);
		fireEvent.click(screen.getByRole("button", { name: "Cool white" }));
		expect(state()).toMatchObject({
			skinToneResourceId: "7408757645705776384",
			values: {
				face_adjust_skin_Intensity: 60,
				face_adjust_skin_ColdWarm: -25,
			},
		});
	});
	it("None is explicit, clears both values and cannot reactivate through warmth", () => {
		render(
			<Harness
				initial={{
					enabled: true,
					values: {
						face_adjust_skin_Intensity: 45,
						face_adjust_skin_ColdWarm: 25,
						face_adjust_Smooth: 20,
					},
				}}
			/>
		);
		expect(screen.getByRole("button", { name: "Pink white" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		fireEvent.click(screen.getByRole("button", { name: "No skin tone" }));
		expect(state()).toEqual({
			enabled: true,
			skinToneResourceId: null,
			values: { face_adjust_Smooth: 20 },
		});
		expect(screen.getByLabelText("Warmth value")).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "Wheat" }));
		expect(state().values).toEqual({
			face_adjust_Smooth: 20,
			face_adjust_skin_Intensity: 60,
		});
	});
	it("preserves an explicitly selected zero strength across switches", () => {
		render(
			<Harness
				initial={{
					enabled: true,
					skinToneResourceId: "7408757645705743616",
					values: { face_adjust_skin_Intensity: 0 },
				}}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Warm white" }));
		expect(state()).toMatchObject({
			skinToneResourceId: "7408757645705792768",
			values: { face_adjust_skin_Intensity: 0 },
		});
	});
	it("group reset clears selection without reverting None to implicit pink", () => {
		render(
			<Harness
				initial={{
					enabled: true,
					skinToneResourceId: "7408757645705743616",
					values: {
						face_adjust_skin_Intensity: 60,
						face_adjust_skin_ColdWarm: 10,
						face_adjust_eye: 30,
					},
				}}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Reset group" }));
		expect(state()).toEqual({
			enabled: true,
			skinToneResourceId: null,
			values: { face_adjust_eye: 30 },
		});
	});
	it.each([
		{ readOnly: true },
		{ disabled: true },
		{ missing: true },
	])("blocks unavailable mutations %j", (props) => {
		render(<Harness {...props} />);
		const swatch = screen.getByRole("button", { name: "Tan" });
		expect(swatch).toBeDisabled();
		fireEvent.click(swatch);
		expect(state()).not.toHaveProperty("skinToneResourceId");
	});
	it("does not expose global swatches as per-face controls", () => {
		render(<Harness allowSkinTone={false} />);
		expect(
			screen.queryByTestId("portrait-skin-tone-palette")
		).not.toBeInTheDocument();
		expect(screen.getByLabelText("Warmth value")).toBeDisabled();
	});
});
