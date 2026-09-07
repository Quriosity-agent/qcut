import { describe, expect, it } from "vitest";
import {
	parseAgentPointerButton,
	parseAgentPointerClickCount,
	parseAgentPointerDragMode,
	parseAgentPointerInputMode,
	parseAgentPointerModifiers,
	parseAgentPointerTarget,
	parseAgentPointerWindowId,
} from "../http/claude-http-pointer-routes.js";

describe("parseAgentPointerTarget", () => {
	it("accepts a snapshot ref", () => {
		expect(parseAgentPointerTarget({ value: { ref: " @e12 " } })).toEqual({
			ref: "@e12",
		});
	});

	it("accepts a complete coordinate pair", () => {
		expect(parseAgentPointerTarget({ value: { x: 120, y: 340 } })).toEqual({
			x: 120,
			y: 340,
		});
	});

	it("rejects ambiguous and partial targets", () => {
		expect(() =>
			parseAgentPointerTarget({ value: { ref: "@e1", x: 1, y: 2 } })
		).toThrow("either ref or coordinates");
		expect(() => parseAgentPointerTarget({ value: { x: 1 } })).toThrow(
			"both x and y"
		);
		expect(() => parseAgentPointerTarget({ value: {} })).toThrow(
			"requires either ref or x/y"
		);
	});

	it("allows an omitted target when the caller supplies a pointer fallback", () => {
		expect(parseAgentPointerTarget({ value: {}, required: false })).toEqual({});
	});

	it("defaults to background input and validates explicit foreground mode", () => {
		expect(parseAgentPointerInputMode({ value: undefined })).toBe("background");
		expect(parseAgentPointerInputMode({ value: "foreground" })).toBe(
			"foreground"
		);
		expect(() => parseAgentPointerInputMode({ value: "silent" })).toThrow(
			"background' or 'foreground"
		);
	});

	it("accepts the HTML5 drag modes and rejects anything else", () => {
		expect(parseAgentPointerDragMode({ value: undefined })).toBeUndefined();
		expect(parseAgentPointerDragMode({ value: "auto" })).toBe("auto");
		expect(parseAgentPointerDragMode({ value: "html5" })).toBe("html5");
		expect(parseAgentPointerDragMode({ value: "mouse" })).toBe("mouse");
		expect(() => parseAgentPointerDragMode({ value: "native" })).toThrow(
			"'auto', 'html5', or 'mouse'"
		);
		expect(() => parseAgentPointerDragMode({ value: 1 })).toThrow(
			"'auto', 'html5', or 'mouse'"
		);
	});

	it("normalizes modifier aliases and rejects unknown ones", () => {
		expect(parseAgentPointerModifiers({ value: undefined })).toBeUndefined();
		expect(
			parseAgentPointerModifiers({ value: ["shift", "cmd", "Shift", "ctrl"] })
		).toEqual(["Shift", "Meta", "Control"]);
		expect(parseAgentPointerModifiers({ value: "option, super" })).toEqual([
			"Alt",
			"Meta",
		]);
		expect(() => parseAgentPointerModifiers({ value: ["hyper"] })).toThrow(
			"Unsupported pointer modifier"
		);
		expect(() => parseAgentPointerModifiers({ value: 3 })).toThrow(
			"must be an array"
		);
	});

	it("validates buttons and click counts", () => {
		expect(parseAgentPointerButton({ value: undefined })).toBeUndefined();
		expect(parseAgentPointerButton({ value: "middle" })).toBe("middle");
		expect(() => parseAgentPointerButton({ value: "back" })).toThrow(
			"'left', 'middle', or 'right'"
		);
		expect(parseAgentPointerClickCount({ value: 3 })).toBe(3);
		expect(() => parseAgentPointerClickCount({ value: 4 })).toThrow(
			"from 1 to 3"
		);
		expect(() => parseAgentPointerClickCount({ value: 1.5 })).toThrow(
			"from 1 to 3"
		);
	});

	it("accepts positive integer window ids from bodies and query strings", () => {
		expect(parseAgentPointerWindowId({ value: undefined })).toBeUndefined();
		expect(parseAgentPointerWindowId({ value: "" })).toBeUndefined();
		expect(parseAgentPointerWindowId({ value: 3 })).toBe(3);
		expect(parseAgentPointerWindowId({ value: "12" })).toBe(12);
		expect(() => parseAgentPointerWindowId({ value: 0 })).toThrow(
			"positive integer"
		);
		expect(() => parseAgentPointerWindowId({ value: "main" })).toThrow(
			"positive integer"
		);
	});
});
