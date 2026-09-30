import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	applyPortraitAdjustments,
	projectPortraitAdjustments,
	type PortraitEditScope,
} from "@/lib/portrait/portrait-face-scope";
import { fireEvent, render, screen } from "@/test/test-utils";
import type { JianyingPortraitMakeupCardStatus } from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitMakeupControls } from "../portrait-makeup-controls";

const categoryLabels = {
	zh: [
		"套装",
		"口红",
		"腮红",
		"修容",
		"卧蚕",
		"眉毛",
		"睫毛",
		"眼线",
		"眼影",
		"美瞳",
		"高光",
		"雀斑",
	],
	en: [
		"Looks",
		"Lip",
		"Blush",
		"Contour",
		"Aegyo",
		"Brows",
		"Lashes",
		"Eyeliner",
		"Eyeshadow",
		"Contacts",
		"Highlight",
		"Freckles",
	],
};
const cards: JianyingPortraitMakeupCardStatus[] = [
	{
		id: "look-oxygen",
		category: "look",
		titleZh: "氧气妆",
		titleEn: "Oxygen",
		defaultIntensity: 70,
		ready: true,
		source: "qcut-private",
		thumbnailDataUrl: "data:image/png;base64,AA==",
	},
	{
		id: "look-soft",
		category: "look",
		titleZh: "柔和妆",
		titleEn: "Soft natural everyday makeup",
		defaultIntensity: 85,
		ready: true,
		source: "qcut-private",
	},
	{
		id: "lip-soft-pink",
		category: "lip",
		titleZh: "柔粉",
		titleEn: "Soft pink",
		defaultIntensity: 80,
		ready: true,
		source: "qcut-private",
	},
	{
		id: "blush-baby-pink",
		category: "blush",
		titleZh: "嫩粉",
		titleEn: "Baby pink",
		defaultIntensity: 60,
		ready: true,
		source: "qcut-private",
	},
	{
		id: "brows-natural",
		category: "brows",
		titleZh: "自然眉",
		titleEn: "Natural",
		defaultIntensity: 90,
		ready: false,
		source: "none",
	},
];
const faceScope: PortraitEditScope = {
	mode: "face",
	personBindingId: "person-2",
	trackId: 2,
	bindingAnchor: {
		rect: { x: 0.2, y: 0.1, width: 0.3, height: 0.4 },
		frameNumber: 12,
	},
};
const initialAdjustments: MediaPortraitAdjustments = {
	enabled: true,
	values: { face_adjust_TotalFace: 25 },
	faceTarget: { mode: "single", faceId: 2 },
	makeup: {
		look: { cardId: "look-oxygen", intensity: 70 },
		lip: { cardId: "lip-soft-pink", intensity: 80 },
		blush: { cardId: "blush-baby-pink", intensity: 60 },
	},
	faces: [
		{
			trackId: 2,
			personBindingId: "person-2",
			bindingAnchor: faceScope.bindingAnchor,
			values: { face_adjust_TotalFace: 45 },
			makeup: {
				look: { cardId: "look-soft", intensity: 90 },
				lip: { cardId: "lip-soft-pink", intensity: 35 },
			},
		},
		{
			trackId: 4,
			personBindingId: "person-4",
			values: { face_adjust_TotalFace: 15 },
			makeup: { lip: { cardId: "lip-soft-pink", intensity: 50 } },
		},
	],
};

function Harness({
	initial = initialAdjustments,
	catalog = cards,
	disabled = false,
	locale = "zh",
	scope = { mode: "all" },
	onChange = vi.fn(),
	start = vi.fn(),
	end = vi.fn(),
}: {
	initial?: MediaPortraitAdjustments;
	catalog?: JianyingPortraitMakeupCardStatus[];
	disabled?: boolean;
	locale?: string;
	scope?: PortraitEditScope;
	onChange?: (adjustments: MediaPortraitAdjustments) => void;
	start?: () => void;
	end?: () => void;
}) {
	const [adjustments, setAdjustments] = useState(initial);
	return (
		<>
			<PortraitMakeupControls
				cards={catalog}
				adjustments={projectPortraitAdjustments({ adjustments, scope })}
				disabled={disabled}
				locale={locale}
				onChange={(edited) => {
					onChange(edited);
					setAdjustments(
						applyPortraitAdjustments({ adjustments, scope, edited })
					);
				}}
				onInteractionStart={start}
				onInteractionEnd={end}
			/>
			<output data-testid="makeup-adjustments">
				{JSON.stringify(adjustments)}
			</output>
		</>
	);
}

function readAdjustments(): MediaPortraitAdjustments {
	return JSON.parse(
		screen.getByTestId("makeup-adjustments").textContent ?? "{}"
	);
}

function onlyLook({
	intensity,
}: {
	intensity: number;
}): MediaPortraitAdjustments {
	return {
		...initialAdjustments,
		makeup: { look: { cardId: "look-oxygen", intensity } },
	};
}

function openCategory({ name }: { name: string }) {
	fireEvent.mouseDown(screen.getByRole("tab", { name }), {
		button: 0,
		ctrlKey: false,
	});
}

function interactions() {
	const events: string[] = [];
	return {
		events,
		start: vi.fn(() => events.push("start")),
		end: vi.fn(() => events.push("end")),
		onChange: vi.fn(() => events.push("change")),
	};
}

describe("portrait makeup controls", () => {
	it.each([
		"zh",
		"en",
	] as const)("keeps 12 wrapping pill tabs in %s order with a partial catalog", (locale) => {
		render(<Harness locale={locale} catalog={cards.slice(0, 2)} />);
		const tabs = screen.getAllByRole("tab");
		expect(tabs.map((tab) => tab.textContent)).toEqual(categoryLabels[locale]);
		expect(screen.getByRole("tablist")).toHaveClass(
			"flex-wrap",
			"h-auto",
			"min-w-0"
		);
		for (const tab of tabs) {
			expect(tab).toHaveClass(
				"rounded-full",
				"h-6",
				"max-w-full",
				"min-w-14",
				"bg-secondary/60"
			);
			expect(tab).toHaveAttribute("type", "button");
		}
		expect(tabs[0]).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("tabpanel")).toHaveAttribute(
			"aria-labelledby",
			tabs[0].id
		);
	});

	it("uses a four-column square grid, cyan selection, and stable English card labels", () => {
		render(<Harness locale="en" />);
		const selected = screen.getByRole("button", { name: "Oxygen" });
		const none = screen.getByRole("button", { name: "None" });
		const longLabel = screen.getByRole("button", {
			name: "Soft natural everyday makeup",
		});
		expect(selected.parentElement).toHaveClass(
			"grid",
			"grid-cols-4",
			"min-w-0"
		);
		for (const card of [selected, none, longLabel]) {
			expect(card).toHaveClass("min-w-0", "w-full", "focus-visible:ring-2");
			expect(card.firstElementChild).toHaveClass("aspect-square", "w-full");
			expect(card.lastElementChild).toHaveClass("truncate", "h-4");
		}
		expect(selected).toHaveAttribute("aria-pressed", "true");
		expect(selected.firstElementChild).toHaveClass("border-cyan-500");
		expect(none).toHaveAttribute("aria-pressed", "false");
		expect(selected.querySelector("img")).toHaveAttribute(
			"src",
			cards[0].thumbnailDataUrl
		);
		expect(longLabel).toHaveAttribute("title", "Soft natural everyday makeup");
		expect(longLabel.querySelector("svg")).toHaveAttribute(
			"aria-hidden",
			"true"
		);
		expect(screen.getByLabelText("Intensity value")).toHaveValue("70");
		expect(
			screen.getAllByRole("button", { name: "Reset Intensity" })
		).toHaveLength(1);
	});

	it("selects at the card default in one undo boundary without changing other categories or faces", () => {
		const observed = interactions();
		render(<Harness {...observed} />);
		fireEvent.click(screen.getByRole("button", { name: "柔和妆" }));
		expect(readAdjustments()).toEqual({
			...initialAdjustments,
			makeup: {
				...initialAdjustments.makeup,
				look: { cardId: "look-soft", intensity: 85 },
			},
		});
		expect(observed.events).toEqual(["start", "change", "end"]);
		expect(screen.getByRole("button", { name: "柔和妆" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
	});

	it("does not reset an already-selected card or create undo entries for category navigation", () => {
		const observed = interactions();
		render(<Harness {...observed} initial={onlyLook({ intensity: 33 })} />);
		fireEvent.click(screen.getByRole("button", { name: "氧气妆" }));
		openCategory({ name: "口红" });
		fireEvent.click(screen.getByRole("button", { name: "无" }));
		openCategory({ name: "套装" });
		expect(screen.getByLabelText("强度数值")).toHaveValue("33");
		expect(observed.events).toEqual([]);
	});

	it("clears only the active category through None", () => {
		const observed = interactions();
		render(<Harness {...observed} />);
		openCategory({ name: "口红" });
		fireEvent.click(screen.getByRole("button", { name: "无" }));
		expect(readAdjustments()).toEqual({
			...initialAdjustments,
			makeup: {
				look: initialAdjustments.makeup?.look,
				blush: initialAdjustments.makeup?.blush,
			},
		});
		expect(
			screen.getByRole("button", { name: "无" }).firstElementChild
		).toHaveClass("border-cyan-500");
		expect(screen.getByLabelText("强度数值")).toHaveValue("0");
		expect(screen.getByLabelText("强度数值")).toBeDisabled();
		expect(observed.events).toEqual(["start", "change", "end"]);
	});

	it("single reset retains the selected card at zero without changing other categories", () => {
		const observed = interactions();
		render(<Harness {...observed} />);
		fireEvent.click(screen.getByRole("button", { name: "重置强度" }));
		expect(readAdjustments().makeup).toEqual({
			look: { cardId: "look-oxygen", intensity: 0 },
			lip: initialAdjustments.makeup?.lip,
			blush: initialAdjustments.makeup?.blush,
		});
		expect(screen.getByRole("button", { name: "氧气妆" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		expect(screen.getByRole("button", { name: "无" })).toHaveAttribute(
			"aria-pressed",
			"false"
		);
		expect(screen.getByLabelText("强度数值")).toHaveValue("0");
		expect(screen.getByLabelText("强度数值")).toBeEnabled();
		expect(screen.getByRole("button", { name: "重置强度" })).toBeDisabled();
		expect(observed.events).toEqual(["start", "change", "end"]);
	});

	it("None removes the last category entirely, including a retained zero selection", () => {
		const observed = interactions();
		render(<Harness {...observed} initial={onlyLook({ intensity: 0 })} />);
		fireEvent.click(screen.getByRole("button", { name: "无" }));
		expect(readAdjustments()).toEqual({
			...initialAdjustments,
			makeup: undefined,
		});
		expect(observed.events).toEqual(["start", "change", "end"]);
	});

	it.each([
		"0",
		"-1",
	])("retains the last selected card on numeric %s and closes the interaction", (draft) => {
		const observed = interactions();
		render(<Harness {...observed} initial={onlyLook({ intensity: 70 })} />);
		const input = screen.getByLabelText("强度数值");
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: draft } });
		fireEvent.blur(input);
		expect(readAdjustments()).toEqual({
			...initialAdjustments,
			makeup: { look: { cardId: "look-oxygen", intensity: 0 } },
		});
		expect(screen.getByLabelText("强度数值")).toBe(input);
		expect(observed.events).toEqual(["start", "change", "end"]);
	});

	it.each([
		{ draft: "999", expected: 100 },
		{ draft: "12.6", expected: 13 },
		{ draft: "", expected: 70 },
		{ draft: "NaN", expected: 70 },
		{ draft: "Infinity", expected: 70 },
	])("normalizes numeric draft $draft to $expected without disturbing other data", ({
		draft,
		expected,
	}) => {
		const observed = interactions();
		render(<Harness {...observed} />);
		const input = screen.getByLabelText("强度数值");
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: draft } });
		expect(readAdjustments()).toEqual(initialAdjustments);
		fireEvent.blur(input);
		expect(readAdjustments()).toEqual({
			...initialAdjustments,
			makeup: {
				...initialAdjustments.makeup,
				look: { cardId: "look-oxygen", intensity: expected },
			},
		});
		expect(observed.events).toEqual(
			expected === 70 ? ["start", "end"] : ["start", "change", "end"]
		);
	});

	it("cancels a numeric draft on Escape and commits on Enter", async () => {
		const observed = interactions();
		render(<Harness {...observed} />);
		const input = screen.getByLabelText("强度数值");
		await userEvent.click(input);
		await userEvent.clear(input);
		await userEvent.type(input, "42{Escape}");
		expect(input).toHaveValue("70");
		expect(readAdjustments()).toEqual(initialAdjustments);
		await userEvent.click(input);
		await userEvent.clear(input);
		await userEvent.type(input, "42{Enter}");
		expect(input).toHaveValue("42");
		expect(observed.events).toEqual(["start", "end", "start", "change", "end"]);
	});

	it("keeps the zero-intensity selection editable and closes keyboard undo boundaries", async () => {
		const observed = interactions();
		render(<Harness {...observed} />);
		const slider = screen.getByRole("slider", { name: "强度" });
		expect(slider).toHaveAttribute("aria-valuemin", "0");
		expect(slider).toHaveAttribute("aria-valuemax", "100");
		slider.focus();
		await userEvent.keyboard("{ArrowRight}{Home}");
		expect(screen.getByRole("slider")).toBe(slider);
		expect(slider).toHaveAttribute("aria-valuenow", "0");
		expect(slider).not.toHaveAttribute("data-disabled");
		expect(readAdjustments().makeup?.look).toEqual({
			cardId: "look-oxygen",
			intensity: 0,
		});
		expect(observed.events).toEqual([
			"start",
			"change",
			"end",
			"start",
			"change",
			"end",
		]);
		await userEvent.keyboard("{ArrowRight}");
		expect(readAdjustments().makeup?.look).toEqual({
			cardId: "look-oxygen",
			intensity: 1,
		});
		expect(observed.start).toHaveBeenCalledTimes(3);
		expect(observed.end).toHaveBeenCalledTimes(3);
	});

	it("closes a pointer interaction on cancel without duplicate undo boundaries", () => {
		const observed = interactions();
		render(<Harness {...observed} />);
		const slider = screen.getByRole("slider");
		Object.assign(slider, {
			setPointerCapture: vi.fn(),
			hasPointerCapture: vi.fn(() => false),
		});
		fireEvent.pointerDown(slider);
		fireEvent.pointerDown(slider);
		fireEvent.pointerCancel(slider);
		fireEvent.pointerUp(slider);
		expect(observed.start).toHaveBeenCalledTimes(1);
		expect(observed.end).toHaveBeenCalledTimes(1);
	});

	it("supports arrow tab navigation, keyboard cards/None/reset, and isolates editor shortcuts", async () => {
		const observed = interactions();
		const editorKeyDown = vi.fn();
		render(
			<div onKeyDown={editorKeyDown}>
				<Harness {...observed} />
			</div>
		);
		screen.getByRole("tab", { name: "套装" }).focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(screen.getByRole("tab", { name: "口红" })).toHaveFocus();
		expect(screen.getByRole("tab", { name: "口红" })).toHaveAttribute(
			"aria-selected",
			"true"
		);
		expect(observed.events).toEqual([]);
		screen.getByRole("button", { name: "无" }).focus();
		await userEvent.keyboard(" ");
		screen.getByRole("button", { name: "柔粉" }).focus();
		await userEvent.keyboard("{Enter}");
		screen.getByRole("button", { name: "重置强度" }).focus();
		await userEvent.keyboard("{Enter}");
		expect(readAdjustments().makeup?.lip).toEqual({
			cardId: "lip-soft-pink",
			intensity: 0,
		});
		expect(observed.events).toEqual([
			"start",
			"change",
			"end",
			"start",
			"change",
			"end",
			"start",
			"change",
			"end",
		]);
		expect(editorKeyDown).not.toHaveBeenCalled();
	});

	it("edits only the projected person while preserving the global layer, binding, and other person", () => {
		render(<Harness scope={faceScope} />);
		expect(screen.getByLabelText("强度数值")).toHaveValue("90");
		fireEvent.click(screen.getByRole("button", { name: "氧气妆" }));
		const input = screen.getByLabelText("强度数值");
		fireEvent.change(input, { target: { value: "28" } });
		fireEvent.blur(input);
		expect(readAdjustments().faces?.[0]).toEqual({
			...initialAdjustments.faces?.[0],
			makeup: {
				look: { cardId: "look-oxygen", intensity: 28 },
				lip: { cardId: "lip-soft-pink", intensity: 35 },
			},
		});
		fireEvent.click(screen.getByRole("button", { name: "重置强度" }));
		expect(readAdjustments().faces?.[0]?.makeup?.look).toEqual({
			cardId: "look-oxygen",
			intensity: 0,
		});
		fireEvent.click(screen.getByRole("button", { name: "无" }));
		expect(readAdjustments()).toEqual({
			...initialAdjustments,
			faces: [
				{
					...initialAdjustments.faces?.[0],
					makeup: { lip: { cardId: "lip-soft-pink", intensity: 35 } },
				},
				initialAdjustments.faces?.[1],
			],
		});
	});

	it("emits a cleared last-category face projection without mutating saved face entries", () => {
		const projected = projectPortraitAdjustments({
			adjustments: initialAdjustments,
			scope: faceScope,
		});
		const adjustments = {
			...projected,
			makeup: { look: { cardId: "look-soft", intensity: 90 } },
		};
		const observed = interactions();
		render(
			<PortraitMakeupControls
				cards={cards}
				adjustments={adjustments}
				disabled={false}
				locale="zh"
				onChange={observed.onChange}
				onInteractionStart={observed.start}
				onInteractionEnd={observed.end}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "无" }));
		expect(observed.onChange).toHaveBeenCalledExactlyOnceWith({
			...adjustments,
			makeup: undefined,
		});
		expect(adjustments.makeup.look.intensity).toBe(90);
		expect(initialAdjustments.faces?.[0]?.makeup?.look?.intensity).toBe(90);
		expect(observed.events).toEqual(["start", "change", "end"]);
	});

	it("disables all editing when the panel is disabled", async () => {
		const observed = interactions();
		render(<Harness {...observed} disabled />);
		for (const button of [
			...screen.getAllByRole("tab"),
			...screen.getAllByRole("button"),
		]) {
			expect(button).toBeDisabled();
		}
		expect(screen.getByLabelText("强度数值")).toBeDisabled();
		expect(screen.getByRole("slider")).toHaveAttribute("data-disabled");
		await userEvent.click(screen.getByRole("button", { name: "柔和妆" }));
		await userEvent.click(screen.getByRole("button", { name: "重置强度" }));
		expect(readAdjustments()).toEqual(initialAdjustments);
		expect(observed.events).toEqual([]);
	});

	it("keeps unavailable selected cards and intensity disabled but allows clearing them", () => {
		const observed = interactions();
		render(
			<Harness
				{...observed}
				initial={{
					...initialAdjustments,
					makeup: { brows: { cardId: "brows-natural", intensity: 44 } },
				}}
			/>
		);
		openCategory({ name: "眉毛" });
		expect(screen.getByRole("button", { name: "自然眉" })).toBeDisabled();
		expect(screen.getByLabelText("强度数值")).toHaveValue("44");
		expect(screen.getByLabelText("强度数值")).toBeDisabled();
		expect(screen.getByRole("button", { name: "重置强度" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "自然眉" }));
		expect(observed.events).toEqual([]);
		fireEvent.click(screen.getByRole("button", { name: "无" }));
		expect(readAdjustments().makeup).toBeUndefined();
		expect(observed.events).toEqual(["start", "change", "end"]);
	});

	it("preserves missing saved cards without silently selecting None or rewriting them", () => {
		const observed = interactions();
		render(<Harness {...observed} catalog={[]} />);
		expect(screen.getByRole("button", { name: "无" })).toHaveAttribute(
			"aria-pressed",
			"false"
		);
		expect(screen.getByLabelText("强度数值")).toHaveValue("70");
		expect(screen.getByLabelText("强度数值")).toBeDisabled();
		expect(observed.events).toEqual([]);
		fireEvent.click(screen.getByRole("button", { name: "无" }));
		expect(readAdjustments().makeup?.look).toBeUndefined();
	});

	it("keeps empty categories navigable and retains the active category across catalog refreshes", () => {
		const observed = interactions();
		const { rerender } = render(
			<Harness
				{...observed}
				catalog={[]}
				initial={{ enabled: true, values: {} }}
			/>
		);
		openCategory({ name: "口红" });
		expect(screen.getByRole("button", { name: "无" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		expect(screen.getByLabelText("强度数值")).toBeDisabled();
		rerender(<Harness {...observed} initial={{ enabled: true, values: {} }} />);
		expect(screen.getByRole("tab", { name: "口红" })).toHaveAttribute(
			"aria-selected",
			"true"
		);
		expect(screen.getByRole("button", { name: "柔粉" })).toBeEnabled();
		expect(observed.events).toEqual([]);
	});
});
