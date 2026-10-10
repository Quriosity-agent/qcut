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
import { PortraitMakeupControls } from "../portrait/portrait-makeup-controls";

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
const faceScope = {
	mode: "face",
	personBindingId: "person-2",
	trackId: 2,
	bindingAnchor: {
		rect: { x: 0.2, y: 0.1, width: 0.3, height: 0.4 },
		frameNumber: 12,
	},
} satisfies PortraitEditScope;
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

const legacyBrowCard: JianyingPortraitMakeupCardStatus = {
	id: "legacy-geometric-brow",
	category: "brows",
	titleZh: "流畅眉",
	titleEn: "Flowing brows",
	defaultIntensity: 70,
	legacyOnly: true,
	ready: true,
	source: "qcut-private",
};
const currentBrowCard: JianyingPortraitMakeupCardStatus = {
	id: "brows-fluffy",
	category: "brows",
	titleZh: "绒绒眉",
	titleEn: "Fluffy brows",
	defaultIntensity: 80,
	legacyOnly: false,
	ready: true,
	source: "qcut-private",
};
const browCatalog = [...cards, legacyBrowCard, currentBrowCard];
const allScope: PortraitEditScope = { mode: "all" };
const browScopes = [{ scope: allScope }, { scope: faceScope }];

function withBrowSelections({
	globalCardId = legacyBrowCard.id,
	faceCardId = legacyBrowCard.id,
	globalIntensity = 70,
	faceIntensity = 35,
}: {
	globalCardId?: string;
	faceCardId?: string;
	globalIntensity?: number;
	faceIntensity?: number;
} = {}): MediaPortraitAdjustments {
	return {
		...initialAdjustments,
		makeup: {
			...initialAdjustments.makeup,
			brows: { cardId: globalCardId, intensity: globalIntensity },
		},
		faces: initialAdjustments.faces?.map((face) =>
			face.trackId === faceScope.trackId
				? {
						...face,
						makeup: {
							...face.makeup,
							brows: { cardId: faceCardId, intensity: faceIntensity },
						},
					}
				: face
		),
	};
}

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

function expectOnlyBrowsChanged({
	initial,
	scope,
	brows,
}: {
	initial: MediaPortraitAdjustments;
	scope: PortraitEditScope;
	brows?: NonNullable<MediaPortraitAdjustments["makeup"]>["brows"];
}) {
	expect(readAdjustments()).toEqual(
		scope.mode === "all"
			? { ...initial, makeup: { ...initial.makeup, brows } }
			: {
					...initial,
					faces: initial.faces?.map((face) =>
						face.trackId === scope.trackId
							? { ...face, makeup: { ...face.makeup, brows } }
							: face
					),
				}
	);
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
			"min-w-0",
			"gap-x-2",
			"gap-y-2"
		);
		for (const tab of tabs) {
			expect(tab).toHaveClass(
				"rounded-full",
				"h-6",
				"max-w-full",
				"min-w-13",
				"shrink-0",
				"bg-foreground/10",
				"data-[state=active]:bg-foreground/20"
			);
			expect(tab).toHaveAttribute("type", "button");
			expect(tab).toHaveAttribute("title", tab.textContent);
			expect(tab.firstElementChild).toHaveClass("min-w-0", "truncate");
		}
		expect(tabs[0]).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("tabpanel")).toHaveAttribute(
			"aria-labelledby",
			tabs[0].id
		);
	});

	it("uses a compact four-column square grid, cyan selection, and stable English card labels", () => {
		render(<Harness locale="en" />);
		const selected = screen.getByRole("button", { name: "Oxygen" });
		const none = screen.getByRole("button", { name: "None" });
		const longLabel = screen.getByRole("button", {
			name: "Soft natural everyday makeup",
		});
		expect(selected.parentElement).toHaveClass(
			"grid",
			"grid-cols-4",
			"min-w-0",
			"w-full",
			"max-w-[292px]",
			"gap-x-3",
			"gap-y-2"
		);
		for (const card of [selected, none, longLabel]) {
			expect(card).toHaveClass("min-w-0", "w-full", "focus-visible:ring-2");
			expect(card.firstElementChild).toHaveClass("aspect-square", "w-full");
			expect(card.lastElementChild).toHaveClass(
				"truncate",
				"h-4",
				"w-full",
				"min-w-0",
				"text-[11px]",
				"leading-4"
			);
		}
		expect(selected).toHaveAttribute("aria-pressed", "true");
		expect(selected.firstElementChild).toHaveClass("border-cyan-500");
		expect(none).toHaveAttribute("aria-pressed", "false");
		expect(none.firstElementChild).toHaveClass("bg-background");
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

	it.each([
		{ locale: "zh", label: "程度", valueLabel: "程度数值", reset: "重置程度" },
		{
			locale: "en",
			label: "Intensity",
			valueLabel: "Intensity value",
			reset: "Reset Intensity",
		},
	])("uses the $locale intensity label for text and accessible controls", ({
		locale,
		label,
		valueLabel,
		reset,
	}) => {
		render(<Harness locale={locale} />);
		expect(screen.getByText(label)).toBeVisible();
		expect(screen.getByRole("slider", { name: label })).toHaveAttribute(
			"aria-valuenow",
			"70"
		);
		expect(screen.getByLabelText(valueLabel)).toHaveValue("70");
		expect(screen.getByRole("button", { name: reset })).toHaveAttribute(
			"title",
			reset
		);
		expect(screen.queryByText("强度")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("强度数值")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "重置强度" })
		).not.toBeInTheDocument();
	});

	it.each([
		{ locale: "zh", title: "柔和自然日常妆容超长标题" },
		{ locale: "en", title: "Soft natural everyday makeup" },
	])("constrains long $locale captions without losing their full accessible name", ({
		locale,
		title,
	}) => {
		const longTitleCard = { ...cards[1], titleZh: title, titleEn: title };
		render(
			<div style={{ width: 240 }}>
				<Harness locale={locale} catalog={[cards[0], longTitleCard]} />
			</div>
		);
		const card = screen.getByRole("button", { name: title });
		expect(card).toHaveAttribute("aria-label", title);
		expect(card).toHaveAttribute("title", title);
		expect(card).toHaveClass("min-w-0", "w-full");
		expect(card.firstElementChild).toHaveClass("aspect-square", "w-full");
		expect(card.lastElementChild).toHaveTextContent(title);
		expect(card.lastElementChild).toHaveClass(
			"min-w-0",
			"w-full",
			"truncate",
			"h-4",
			"leading-4"
		);
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
		expect(screen.getByLabelText("程度数值")).toHaveValue("33");
		expect(observed.events).toEqual([]);
	});

	it.each([
		{ scope: allScope, matchingIntensity: false },
		{ scope: allScope, matchingIntensity: true },
		{ scope: faceScope, matchingIntensity: false },
		{ scope: faceScope, matchingIntensity: true },
	])("commits a pending draft to the old category on tab click in $scope.mode scope (matching intensity: $matchingIntensity)", async ({
		scope,
		matchingIntensity,
	}) => {
		const observed = interactions();
		const initial: MediaPortraitAdjustments = matchingIntensity
			? {
					...initialAdjustments,
					makeup: {
						...initialAdjustments.makeup,
						lip: { cardId: "lip-soft-pink", intensity: 70 },
					},
					faces: initialAdjustments.faces?.map((face) =>
						face.trackId === faceScope.trackId
							? {
									...face,
									makeup: {
										...face.makeup,
										lip: { cardId: "lip-soft-pink", intensity: 90 },
									},
								}
							: face
					),
				}
			: initialAdjustments;
		const projected = projectPortraitAdjustments({
			adjustments: initial,
			scope,
		});
		render(<Harness {...observed} initial={initial} scope={scope} />);
		const input = screen.getByLabelText("程度数值");
		await userEvent.click(input);
		await userEvent.clear(input);
		await userEvent.type(input, "42");
		await userEvent.click(screen.getByRole("tab", { name: "口红" }));
		expect(readAdjustments()).toEqual(
			applyPortraitAdjustments({
				adjustments: initial,
				scope,
				edited: {
					...projected,
					makeup: {
						...projected.makeup,
						look: { cardId: projected.makeup!.look!.cardId, intensity: 42 },
					},
				},
			})
		);
		expect(screen.getByLabelText("程度数值")).toHaveValue(
			String(projected.makeup?.lip?.intensity)
		);
		expect(observed.events).toEqual(["start", "change", "end"]);
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
		expect(screen.getByLabelText("程度数值")).toHaveValue("0");
		expect(screen.getByLabelText("程度数值")).toBeDisabled();
		expect(observed.events).toEqual(["start", "change", "end"]);
	});

	it("single reset retains the selected card at zero without changing other categories", () => {
		const observed = interactions();
		render(<Harness {...observed} />);
		fireEvent.click(screen.getByRole("button", { name: "重置程度" }));
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
		expect(screen.getByLabelText("程度数值")).toHaveValue("0");
		expect(screen.getByLabelText("程度数值")).toBeEnabled();
		expect(screen.getByRole("button", { name: "重置程度" })).toBeDisabled();
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
		const input = screen.getByLabelText("程度数值");
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: draft } });
		fireEvent.blur(input);
		expect(readAdjustments()).toEqual({
			...initialAdjustments,
			makeup: { look: { cardId: "look-oxygen", intensity: 0 } },
		});
		expect(screen.getByLabelText("程度数值")).toBe(input);
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
		const input = screen.getByLabelText("程度数值");
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
		const input = screen.getByLabelText("程度数值");
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
		const slider = screen.getByRole("slider", { name: "程度" });
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
		screen.getByRole("button", { name: "重置程度" }).focus();
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
		expect(screen.getByLabelText("程度数值")).toHaveValue("90");
		fireEvent.click(screen.getByRole("button", { name: "氧气妆" }));
		const input = screen.getByLabelText("程度数值");
		fireEvent.change(input, { target: { value: "28" } });
		fireEvent.blur(input);
		expect(readAdjustments().faces?.[0]).toEqual({
			...initialAdjustments.faces?.[0],
			makeup: {
				look: { cardId: "look-oxygen", intensity: 28 },
				lip: { cardId: "lip-soft-pink", intensity: 35 },
			},
		});
		fireEvent.click(screen.getByRole("button", { name: "重置程度" }));
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
		expect(screen.getByLabelText("程度数值")).toBeDisabled();
		expect(screen.getByRole("slider")).toHaveAttribute("data-disabled");
		await userEvent.click(screen.getByRole("button", { name: "柔和妆" }));
		await userEvent.click(screen.getByRole("button", { name: "重置程度" }));
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
		expect(screen.getByLabelText("程度数值")).toHaveValue("44");
		expect(screen.getByLabelText("程度数值")).toBeDisabled();
		expect(screen.getByRole("button", { name: "重置程度" })).toBeDisabled();
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
		expect(screen.getByLabelText("程度数值")).toHaveValue("70");
		expect(screen.getByLabelText("程度数值")).toBeDisabled();
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
		expect(screen.getByLabelText("程度数值")).toBeDisabled();
		rerender(<Harness {...observed} initial={{ enabled: true, values: {} }} />);
		expect(screen.getByRole("tab", { name: "口红" })).toHaveAttribute(
			"aria-selected",
			"true"
		);
		expect(screen.getByRole("button", { name: "柔粉" })).toBeEnabled();
		expect(observed.events).toEqual([]);
	});

	it.each([
		{ name: "global selected", scope: allScope, visible: true, value: "70" },
		{ name: "face selected", scope: faceScope, visible: true, value: "35" },
		{
			name: "global selected at zero",
			scope: allScope,
			globalIntensity: 0,
			visible: true,
			value: "0",
		},
		{
			name: "face selected at zero",
			scope: faceScope,
			faceIntensity: 0,
			visible: true,
			value: "0",
		},
		{
			name: "legacy only on a face",
			scope: allScope,
			globalCardId: currentBrowCard.id,
			visible: false,
			value: "70",
		},
		{
			name: "legacy only on the global layer",
			scope: faceScope,
			faceCardId: currentBrowCard.id,
			visible: false,
			value: "35",
		},
		{
			name: "legacy only on other scopes",
			scope: { ...faceScope, personBindingId: "person-4", trackId: 4 },
			visible: false,
			value: "0",
		},
	])("shows legacy cards only in the selected projection: $name", ({
		scope,
		visible,
		value,
		...selections
	}) => {
		const observed = interactions();
		const initial = withBrowSelections(selections);
		render(
			<Harness
				{...observed}
				initial={initial}
				catalog={browCatalog}
				scope={scope}
			/>
		);
		openCategory({ name: "眉毛" });
		const legacy = screen.queryByRole("button", { name: "流畅眉" });
		if (visible) {
			expect(legacy).toBeEnabled();
			expect(legacy).toHaveAttribute("aria-pressed", "true");
		} else {
			expect(legacy).not.toBeInTheDocument();
		}
		expect(screen.getByRole("button", { name: "绒绒眉" })).toBeEnabled();
		expect(screen.getByLabelText("程度数值")).toHaveValue(value);
		expect(readAdjustments()).toEqual(initial);
		expect(observed.events).toEqual([]);
	});

	it("does not offer legacy cards when starting a new makeup selection", () => {
		render(<Harness catalog={browCatalog} />);
		openCategory({ name: "眉毛" });
		expect(
			screen.queryByRole("button", { name: "流畅眉" })
		).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "无" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		fireEvent.click(screen.getByRole("button", { name: "绒绒眉" }));
		expectOnlyBrowsChanged({
			initial: initialAdjustments,
			scope: allScope,
			brows: { cardId: currentBrowCard.id, intensity: 80 },
		});
	});

	it.each(
		browScopes
	)("keeps legacy intensity editable through reset and None in $scope.mode scope", ({
		scope,
	}) => {
		const observed = interactions();
		const initial = withBrowSelections();
		render(
			<Harness
				{...observed}
				initial={initial}
				catalog={browCatalog}
				scope={scope}
			/>
		);
		openCategory({ name: "眉毛" });
		fireEvent.click(screen.getByRole("button", { name: "流畅眉" }));
		expect(observed.events).toEqual([]);
		const input = screen.getByLabelText("程度数值");
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "42" } });
		fireEvent.blur(input);
		expectOnlyBrowsChanged({
			initial,
			scope,
			brows: { cardId: legacyBrowCard.id, intensity: 42 },
		});
		fireEvent.click(screen.getByRole("button", { name: "重置程度" }));
		expectOnlyBrowsChanged({
			initial,
			scope,
			brows: { cardId: legacyBrowCard.id, intensity: 0 },
		});
		expect(input).toHaveValue("0");
		expect(input).toBeEnabled();
		expect(screen.getByRole("button", { name: "流畅眉" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		expect(screen.getByRole("button", { name: "无" })).toHaveAttribute(
			"aria-pressed",
			"false"
		);
		expect(screen.getByRole("button", { name: "重置程度" })).toBeDisabled();
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "99" } });
		fireEvent.blur(input);
		expectOnlyBrowsChanged({
			initial,
			scope,
			brows: { cardId: legacyBrowCard.id, intensity: 99 },
		});
		fireEvent.click(screen.getByRole("button", { name: "无" }));
		expectOnlyBrowsChanged({ initial, scope });
		expect(
			screen.queryByRole("button", { name: "流畅眉" })
		).not.toBeInTheDocument();
		expect(input).toBeDisabled();
		expect(input).toHaveValue("0");
		expect(observed.events).toEqual(
			Array.from({ length: 4 }).flatMap(() => ["start", "change", "end"])
		);
	});

	it.each(
		browScopes
	)("hides a replaced legacy card without changing other layers in $scope.mode scope", ({
		scope,
	}) => {
		const initial = withBrowSelections();
		render(<Harness initial={initial} catalog={browCatalog} scope={scope} />);
		openCategory({ name: "眉毛" });
		fireEvent.click(screen.getByRole("button", { name: "绒绒眉" }));
		expectOnlyBrowsChanged({
			initial,
			scope,
			brows: { cardId: currentBrowCard.id, intensity: 80 },
		});
		expect(
			screen.queryByRole("button", { name: "流畅眉" })
		).not.toBeInTheDocument();
		openCategory({ name: "口红" });
		openCategory({ name: "眉毛" });
		expect(
			screen.queryByRole("button", { name: "流畅眉" })
		).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "绒绒眉" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
	});

	it.each(
		browScopes
	)("clears a last legacy category at zero in $scope.mode scope", ({
		scope,
	}) => {
		const initial: MediaPortraitAdjustments = {
			...initialAdjustments,
			makeup: { brows: { cardId: legacyBrowCard.id, intensity: 0 } },
			faces: [
				{
					...initialAdjustments.faces?.[0],
					trackId: 2,
					values: {},
					makeup: { brows: { cardId: legacyBrowCard.id, intensity: 0 } },
				},
				initialAdjustments.faces![1],
			],
		};
		render(<Harness initial={initial} catalog={browCatalog} scope={scope} />);
		openCategory({ name: "眉毛" });
		expect(screen.getByRole("button", { name: "流畅眉" })).toBeEnabled();
		fireEvent.click(screen.getByRole("button", { name: "无" }));
		expect(readAdjustments()).toEqual(
			scope.mode === "all"
				? { ...initial, makeup: undefined }
				: { ...initial, faces: [initial.faces![1]] }
		);
		expect(
			screen.queryByRole("button", { name: "流畅眉" })
		).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "无" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
	});

	it("keeps an unavailable saved legacy card visible but only allows clearing it", () => {
		const initial = withBrowSelections();
		render(
			<Harness
				initial={initial}
				scope={faceScope}
				catalog={[...cards, { ...legacyBrowCard, ready: false }]}
			/>
		);
		openCategory({ name: "眉毛" });
		expect(screen.getByRole("button", { name: "流畅眉" })).toBeDisabled();
		expect(screen.getByLabelText("程度数值")).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "无" }));
		expectOnlyBrowsChanged({ initial, scope: faceScope });
		expect(
			screen.queryByRole("button", { name: "流畅眉" })
		).not.toBeInTheDocument();
	});
});
