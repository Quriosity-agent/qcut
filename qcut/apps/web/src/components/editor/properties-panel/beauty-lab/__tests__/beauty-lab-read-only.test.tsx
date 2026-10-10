import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { beautyLabCatalogStatus } from "@/lib/portrait/beauty-lab-catalog";
import { fireEvent, render, screen, within } from "@/test/test-utils";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { BeautyLabControls } from "../beauty-lab-controls";
import { PortraitMakeupControls } from "../../portrait/portrait-makeup-controls";

const categories = [
	{ category: "look", zh: "套装", en: "Looks" },
	{ category: "lip", zh: "口红", en: "Lip" },
	{ category: "blush", zh: "腮红", en: "Blush" },
	{ category: "contour", zh: "修容", en: "Contour" },
	{ category: "aegyo", zh: "卧蚕", en: "Aegyo" },
	{ category: "brows", zh: "眉毛", en: "Brows" },
	{ category: "lashes", zh: "睫毛", en: "Lashes" },
	{ category: "eyeliner", zh: "眼线", en: "Eyeliner" },
	{ category: "eyeshadow", zh: "眼影", en: "Eyeshadow" },
	{ category: "contacts", zh: "美瞳", en: "Contacts" },
	{ category: "highlight", zh: "高光", en: "Highlight" },
	{ category: "freckles", zh: "雀斑", en: "Freckles" },
] as const;
const catalog = beautyLabCatalogStatus({ status: null });
const recorded: MediaPortraitAdjustments = {
	enabled: true,
	values: { face_adjust_skin_Intensity: 57, face_adjust_skin_ColdWarm: -18 },
	makeup: { lip: { cardId: "lip-soft-pink", intensity: 35 } },
};

function setup({
	locale = "en",
	disabled = false,
	adjustments = recorded,
}: {
	locale?: string;
	disabled?: boolean;
	adjustments?: MediaPortraitAdjustments;
} = {}) {
	const onChange = vi.fn();
	const onDetect = vi.fn();
	const view = render(
		<BeautyLabControls
			status={catalog}
			adjustments={adjustments}
			locale={locale}
			disabled={disabled}
			faces={[]}
			detecting={false}
			readOnly
			onChange={onChange}
			onDetect={onDetect}
		/>
	);
	fireEvent.click(
		screen.getByRole("button", { name: locale === "zh" ? "美妆" : "Makeup" })
	);
	return { ...view, onChange, onDetect };
}

describe("Beauty Lab read-only makeup navigation", () => {
	it.each([
		{ locale: "zh" },
		{ locale: "en" },
	] as const)("browses every category in $locale without editing records or native readiness", ({
		locale,
	}) => {
		const before = structuredClone({ catalog, recorded });
		const { onChange, onDetect } = setup({ locale });
		const section = within(screen.getByTestId("portrait-section-makeup"));
		for (const { category, ...labels } of categories) {
			const tab = section.getByRole("tab", { name: labels[locale] });
			expect(tab).toBeEnabled();
			fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
			expect(tab).toHaveAttribute("aria-selected", "true");
			const cards = catalog.makeupCards.filter(
				(card) => card.category === category && !card.legacyOnly
			);
			expect(cards.length).toBeGreaterThan(0);
			for (const card of cards) {
				const button = section.getByTestId(`portrait-makeup-card-${card.id}`);
				expect(button).toBeDisabled();
				fireEvent.click(button);
			}
			const none = section.getByTestId("portrait-makeup-card-none");
			expect(none).toBeDisabled();
			fireEvent.click(none);
			const input = section.getByLabelText(
				locale === "zh" ? "程度数值" : "Intensity value"
			);
			expect(input).toBeDisabled();
			expect(input).toHaveValue(category === "lip" ? "35" : "0");
			fireEvent.change(input, { target: { value: "99" } });
			fireEvent.blur(input);
			expect(
				section.getByRole("button", {
					name: locale === "zh" ? "重置程度" : "Reset Intensity",
				})
			).toBeDisabled();
		}
		expect(onChange).not.toHaveBeenCalled();
		expect(onDetect).not.toHaveBeenCalled();
		expect({ catalog, recorded }).toEqual(before);
	});

	it("navigates categories by keyboard while keeping the recorded selection and intensity", async () => {
		const { onChange } = setup();
		await userEvent.click(screen.getByRole("tab", { name: "Looks" }));
		await userEvent.keyboard("{ArrowRight}");
		expect(screen.getByRole("tab", { name: "Lip" })).toHaveAttribute(
			"aria-selected",
			"true"
		);
		expect(
			screen.getByTestId("portrait-makeup-card-lip-soft-pink")
		).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByLabelText("Intensity value")).toHaveValue("35");
		await userEvent.keyboard("{End}");
		expect(screen.getByRole("tab", { name: "Freckles" })).toHaveAttribute(
			"aria-selected",
			"true"
		);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("keeps a recorded legacy card visible but immutable", () => {
		const legacy = catalog.makeupCards.find((card) => card.legacyOnly);
		if (!legacy) throw new Error("Expected a legacy makeup catalog entry");
		const labels = categories.find(
			({ category }) => category === legacy.category
		);
		if (!labels) throw new Error("Expected a known makeup category");
		const { onChange } = setup({
			adjustments: {
				...recorded,
				makeup: { [legacy.category]: { cardId: legacy.id, intensity: 0 } },
			},
		});
		fireEvent.mouseDown(screen.getByRole("tab", { name: labels.en }), {
			button: 0,
			ctrlKey: false,
		});
		const card = screen.getByTestId(`portrait-makeup-card-${legacy.id}`);
		expect(card).toHaveAttribute("aria-pressed", "true");
		expect(card).toBeDisabled();
		expect(screen.getByLabelText("Intensity value")).toHaveValue("0");
		expect(screen.getByTestId("portrait-makeup-card-none")).toHaveAttribute(
			"aria-pressed",
			"false"
		);
		fireEvent.click(card);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("keeps busy-state category navigation disabled even in read-only mode", () => {
		const { onChange } = setup({ disabled: true });
		const section = within(screen.getByTestId("portrait-section-makeup"));
		for (const tab of section.getAllByRole("tab")) expect(tab).toBeDisabled();
		fireEvent.mouseDown(section.getByRole("tab", { name: "Lip" }), {
			button: 0,
			ctrlKey: false,
		});
		expect(section.getByRole("tab", { name: "Looks" })).toHaveAttribute(
			"aria-selected",
			"true"
		);
		expect(onChange).not.toHaveBeenCalled();
	});
});

describe("Portrait makeup read-only mutation guards", () => {
	it.each([
		{ ready: true },
		{ ready: false },
	])("blocks all edits and interaction callbacks independently of card readiness ($ready)", ({
		ready,
	}) => {
		const onChange = vi.fn();
		const onInteractionStart = vi.fn();
		const onInteractionEnd = vi.fn();
		const cards = catalog.makeupCards.map((card) => ({ ...card, ready }));
		const before = structuredClone({ cards, recorded });
		render(
			<PortraitMakeupControls
				cards={cards}
				adjustments={recorded}
				disabled={false}
				readOnly
				locale="en"
				onChange={onChange}
				onInteractionStart={onInteractionStart}
				onInteractionEnd={onInteractionEnd}
			/>
		);
		fireEvent.mouseDown(screen.getByRole("tab", { name: "Lip" }), {
			button: 0,
			ctrlKey: false,
		});
		for (const button of screen.getAllByRole("button")) {
			expect(button).toBeDisabled();
			fireEvent.click(button);
		}
		const input = screen.getByLabelText("Intensity value");
		expect(input).toBeDisabled();
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "82" } });
		fireEvent.blur(input);
		const slider = screen.getByRole("slider", { name: "Intensity" });
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		fireEvent.keyUp(slider, { key: "ArrowRight" });
		expect(onChange).not.toHaveBeenCalled();
		expect(onInteractionStart).not.toHaveBeenCalled();
		expect(onInteractionEnd).not.toHaveBeenCalled();
		expect({ cards, recorded }).toEqual(before);
	});

	it("restores editing when leaving read-only without changing selection or promoting unavailable cards", () => {
		const onChange = vi.fn();
		const props = {
			cards: catalog.makeupCards.map((card) => ({
				...card,
				ready: card.id === recorded.makeup?.lip?.cardId,
			})),
			adjustments: recorded,
			disabled: false,
			locale: "en",
			onChange,
			onInteractionStart: vi.fn(),
			onInteractionEnd: vi.fn(),
		};
		const view = render(<PortraitMakeupControls {...props} readOnly />);
		fireEvent.mouseDown(screen.getByRole("tab", { name: "Lip" }), {
			button: 0,
			ctrlKey: false,
		});
		view.rerender(<PortraitMakeupControls {...props} />);
		expect(screen.getByRole("tab", { name: "Lip" })).toHaveAttribute(
			"aria-selected",
			"true"
		);
		expect(screen.getByLabelText("Intensity value")).toBeEnabled();
		expect(screen.getByLabelText("Intensity value")).toHaveValue("35");
		for (const card of props.cards.filter(
			(card) => card.category === "lip" && !card.ready && !card.legacyOnly
		)) {
			expect(
				screen.getByTestId(`portrait-makeup-card-${card.id}`)
			).toBeDisabled();
		}
		expect(onChange).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Reset Intensity" }));
		expect(onChange).toHaveBeenCalledExactlyOnceWith({
			...recorded,
			makeup: { lip: { cardId: "lip-soft-pink", intensity: 0 } },
		});
	});
});
