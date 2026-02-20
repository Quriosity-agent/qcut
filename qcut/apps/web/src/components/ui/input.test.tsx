import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "@/components/ui/input";

describe("Input Component", () => {
	it("accepts text input", () => {
		render(<Input placeholder="Enter text" />);
		const input = screen.getByPlaceholderText("Enter text") as HTMLInputElement;

		fireEvent.change(input, { target: { value: "test text" } });
		expect(input.value).toBe("test text");
	});

	it("supports different types", () => {
		const { container } = render(
			<div>
				<Input type="email" placeholder="Email" />
				<Input type="password" placeholder="Password" />
				<Input type="number" placeholder="Number" />
			</div>
		);

		expect(screen.getByPlaceholderText("Email")).toHaveAttribute(
			"type",
			"email"
		);
		expect(screen.getByPlaceholderText("Password")).toHaveAttribute(
			"type",
			"password"
		);
		expect(screen.getByPlaceholderText("Number")).toHaveAttribute(
			"type",
			"number"
		);
	});

	it("handles disabled state", () => {
		render(<Input disabled placeholder="Disabled" />);
		const input = screen.getByPlaceholderText("Disabled");

		expect(input).toBeDisabled();
	});
});
