import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/test/test-utils";
import { PortraitNumberControl } from "../portrait-number-control";

function Harness({
	initial = 0,
	disabled = false,
	step = 1,
	start = vi.fn(),
	end = vi.fn(),
}: {
	initial?: number;
	disabled?: boolean;
	step?: number;
	start?: () => void;
	end?: () => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<PortraitNumberControl
			label="鼻高低"
			locale="zh"
			value={value}
			min={-50}
			max={50}
			step={step}
			disabled={disabled}
			onChange={setValue}
			onInteractionStart={start}
			onInteractionEnd={end}
		/>
	);
}

function input() {
	return screen.getByLabelText("鼻高低数值");
}

describe("portrait numeric controls", () => {
	it("allows an incomplete negative draft and commits one bounded interaction", () => {
		const start = vi.fn();
		const end = vi.fn();
		render(<Harness start={start} end={end} />);
		fireEvent.focus(input());
		fireEvent.change(input(), { target: { value: "-" } });
		expect(input()).toHaveValue("-");
		expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "0");
		fireEvent.change(input(), { target: { value: "-48" } });
		fireEvent.blur(input());
		expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "-48");
		expect(start).toHaveBeenCalledTimes(1);
		expect(end).toHaveBeenCalledTimes(1);
	});
	it.each([
		{ draft: "999", expected: "50" },
		{ draft: "-999", expected: "-50" },
		{ draft: "", expected: "12" },
		{ draft: "NaN", expected: "12" },
		{ draft: "Infinity", expected: "12" },
	])("normalizes $draft to $expected on commit", ({ draft, expected }) => {
		render(<Harness initial={12} />);
		fireEvent.focus(input());
		fireEvent.change(input(), { target: { value: draft } });
		fireEvent.blur(input());
		expect(input()).toHaveValue(expected);
	});
	it("rounds fractional edits to the declared step", () => {
		render(<Harness step={0.1} />);
		fireEvent.change(input(), { target: { value: "-12.36" } });
		fireEvent.blur(input());
		expect(input()).toHaveValue("-12.4");
	});
	it("cancels on Escape and commits on Enter", () => {
		render(<Harness initial={12} />);
		input().focus();
		fireEvent.change(input(), { target: { value: "-48" } });
		fireEvent.keyDown(input(), { key: "Escape" });
		expect(input()).toHaveValue("12");
		input().focus();
		fireEvent.change(input(), { target: { value: "-48" } });
		fireEvent.keyDown(input(), { key: "Enter" });
		expect(input()).toHaveValue("-48");
		expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "-48");
	});
	it("resets a single value without leaving an interaction open", () => {
		const start = vi.fn();
		const end = vi.fn();
		render(<Harness initial={25} start={start} end={end} />);
		fireEvent.click(screen.getByRole("button", { name: "重置鼻高低" }));
		expect(input()).toHaveValue("0");
		expect(screen.getByRole("button")).toBeDisabled();
		expect(start).toHaveBeenCalledTimes(1);
		expect(end).toHaveBeenCalledTimes(1);
	});
	it("supports keyboard slider adjustments", () => {
		const start = vi.fn();
		const end = vi.fn();
		render(<Harness start={start} end={end} />);
		fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
		fireEvent.keyUp(screen.getByRole("slider"), { key: "ArrowRight" });
		expect(input()).toHaveValue("1");
		expect(start).toHaveBeenCalledTimes(1);
		expect(end).toHaveBeenCalledTimes(1);
	});
	it("keeps stored out-of-range values until explicitly edited", () => {
		render(<Harness initial={75} disabled />);
		expect(input()).toHaveValue("75");
		expect(input()).toBeDisabled();
		expect(screen.getByRole("button")).toBeDisabled();
		expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "50");
	});
});
