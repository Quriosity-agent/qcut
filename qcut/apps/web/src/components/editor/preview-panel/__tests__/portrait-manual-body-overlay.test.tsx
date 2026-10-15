import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualBodyAffineMatrix } from "@/lib/portrait/portrait-manual-body-coordinates";
import { usePortraitManualBodyStore } from "@/stores/editor/portrait-manual-body-store";
import { PortraitManualBodyOverlay } from "../portrait-manual-body-overlay";

const TRANSFORMS = [
	{
		name: "rotation",
		matrix: { a: 0, b: 1, c: -1, d: 0, e: 500, f: 100 },
		bounds: { width: 200, height: 100 },
	},
	{
		name: "non-uniform scale",
		matrix: { a: 2, b: 0, c: 0, d: 0.5, e: 100, f: 100 },
		bounds: { width: 200, height: 100 },
	},
	{
		name: "flipped non-uniform scale",
		matrix: { a: -2, b: 0, c: 0, d: 0.5, e: 500, f: 100 },
		bounds: { width: 200, height: 100 },
	},
];

const SVG_PROPERTIES = [
	"getScreenCTM",
	"setPointerCapture",
	"hasPointerCapture",
	"releasePointerCapture",
] as const;

function screenPoint({
	matrix,
	x,
	y,
}: {
	matrix: ManualBodyAffineMatrix;
	x: number;
	y: number;
}) {
	return {
		clientX: matrix.a * x + matrix.c * y + matrix.e,
		clientY: matrix.b * x + matrix.d * y + matrix.f,
	};
}

describe("PortraitManualBodyOverlay layout coordinates", () => {
	let resizeOverlay = () => {};
	let layout = { width: 100, height: 200 };
	let svgDescriptors: Array<[string, PropertyDescriptor | undefined]> = [];

	beforeEach(() => {
		layout = { width: 100, height: 200 };
		vi.stubGlobal(
			"ResizeObserver",
			class implements ResizeObserver {
				constructor(callback: ResizeObserverCallback) {
					resizeOverlay = () => callback([], this);
				}
				observe() {}
				unobserve() {}
				disconnect() {}
			}
		);
		vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
			const style = document.createElement("div").style;
			style.width = `${layout.width}px`;
			style.height = `${layout.height}px`;
			return style;
		});
		svgDescriptors = SVG_PROPERTIES.map((property) => [
			property,
			Object.getOwnPropertyDescriptor(SVGElement.prototype, property),
		]);
		Object.defineProperties(SVGElement.prototype, {
			getScreenCTM: { configurable: true, value: vi.fn() },
			setPointerCapture: { configurable: true, value: vi.fn() },
			hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
			releasePointerCapture: { configurable: true, value: vi.fn() },
		});
		usePortraitManualBodyStore.setState({
			active: true,
			elementId: "body-clip",
			tool: "zoom",
			manualBody: {
				zoom: { intensity: 30, x: 0.5, y: 0.5, radius: 0.2 },
			},
			past: [],
			future: [],
			interactionStartValue: null,
			bindings: null,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		for (const [property, descriptor] of svgDescriptors) {
			if (descriptor) {
				Object.defineProperty(SVGElement.prototype, property, descriptor);
				continue;
			}
			Reflect.deleteProperty(SVGElement.prototype, property);
		}
	});

	it.each(TRANSFORMS)("draws and drags in source coordinates after $name", ({
		matrix,
		bounds,
	}) => {
		vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, bounds.width, bounds.height)
		);
		render(<PortraitManualBodyOverlay elementId="body-clip" />);
		const overlay = screen.getByTestId("portrait-manual-body-overlay");
		Object.defineProperty(overlay, "getScreenCTM", { value: () => matrix });
		const circle = screen.getByTestId("manual-body-zoom-circle");
		expect(circle).toHaveAttribute("cx", "50");
		expect(circle).toHaveAttribute("cy", "100");
		expect(circle).toHaveAttribute("r", "20");

		fireEvent.pointerDown(circle, {
			button: 0,
			pointerId: 1,
			...screenPoint({ matrix, x: 50, y: 100 }),
		});
		fireEvent.pointerMove(overlay, {
			pointerId: 1,
			...screenPoint({ matrix, x: 70, y: 60 }),
		});
		fireEvent.pointerUp(overlay, { pointerId: 1 });
		expect(usePortraitManualBodyStore.getState().manualBody.zoom).toMatchObject(
			{
				x: 0.7,
				y: 0.3,
			}
		);
		expect(usePortraitManualBodyStore.getState().past).toHaveLength(1);
	});

	it("updates fractional layout sizes on resize without using screen bounds", () => {
		vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue(
			new DOMRect(0, 0, 700, 500)
		);
		render(<PortraitManualBodyOverlay elementId="body-clip" />);
		act(() => {
			layout = { width: 300.5, height: 500.25 };
			resizeOverlay();
		});
		const circle = screen.getByTestId("manual-body-zoom-circle");
		expect(circle).toHaveAttribute("cx", "150.25");
		expect(circle).toHaveAttribute("cy", "250.125");
		expect(Number(circle.getAttribute("r"))).toBeCloseTo(60.1);
	});

	it("measures the local viewport when editing starts after mount", () => {
		usePortraitManualBodyStore.setState({ active: false, tool: "stretch" });
		render(<PortraitManualBodyOverlay elementId="body-clip" />);
		expect(screen.queryByTestId("portrait-manual-body-overlay")).toBeNull();
		act(() =>
			usePortraitManualBodyStore.getState().setActive({ active: true })
		);
		expect(
			screen.getByTestId("manual-body-stretch-upper").querySelector("line")
		).toHaveAttribute("x2", "100");
	});
});
