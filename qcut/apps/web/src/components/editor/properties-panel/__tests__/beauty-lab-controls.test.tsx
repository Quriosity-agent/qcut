import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { beautyLabCatalogStatus } from "@/lib/portrait/beauty-lab-catalog";
import { act, fireEvent, render, screen, within } from "@/test/test-utils";
import type { JianyingPortraitDetectedFace } from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import {
	BeautyLabControls,
	type BeautyLabControlsProps,
} from "../beauty-lab-controls";
import { BEAUTY_LAB_PRESET_STORAGE_KEY } from "../beauty-lab-presets";

const nativeStatus = beautyLabCatalogStatus({ status: null });
const initial: MediaPortraitAdjustments = {
	enabled: false,
	values: {
		face_adjust_Smooth: 12,
		face_adjust_TotalFace: 20,
		body_adjust_SlimWaist: 30,
	},
	makeup: { lip: { cardId: "lip-soft-pink", intensity: 35 } },
};
const faces: JianyingPortraitDetectedFace[] = [42, 9, 73, 8, 105, 61].map(
	(trackId, index) => ({
		trackId,
		freidTrackId: trackId,
		faceId: 800 + index,
		personBindingId: `observed-${trackId}`,
		bindingStatus: "new",
		rect: { x: index * 0.1, y: 0.1, width: 0.1, height: 0.2 },
		score: 0.95,
		yaw: 0,
		pitch: 0,
		roll: 0,
		trackingCount: 0,
		landmarkCount: 106,
	})
);
const groupLabels = {
	skin: "皮肤管理",
	"face-shape": "脸型",
	features: "五官精修",
	body: "智能美体",
};
const featureCategories = [
	{ category: "eyes", label: "眼睛" },
	{ category: "nose", label: "鼻子" },
	{ category: "mouth", label: "嘴巴" },
	{ category: "brows", label: "眉毛" },
	{ category: "details", label: "精修" },
] as const;
const makeupCategories = [
	{ category: "look", label: "套装" },
	{ category: "lip", label: "口红" },
	{ category: "blush", label: "腮红" },
	{ category: "contour", label: "修容" },
	{ category: "aegyo", label: "卧蚕" },
	{ category: "brows", label: "眉毛" },
	{ category: "lashes", label: "睫毛" },
	{ category: "eyeliner", label: "眼线" },
	{ category: "eyeshadow", label: "眼影" },
	{ category: "contacts", label: "美瞳" },
	{ category: "highlight", label: "高光" },
	{ category: "freckles", label: "雀斑" },
] as const;

function Harness({
	adjustments: starting = initial,
	status = nativeStatus,
	locale = "zh",
	disabled = false,
	faces: detectedFaces = [],
	detecting = false,
	canDetect = true,
	readOnly = false,
	onChange = vi.fn(),
	onDetect = vi.fn(),
}: Partial<BeautyLabControlsProps>) {
	const [adjustments, setAdjustments] = useState(starting);
	return (
		<>
			<BeautyLabControls
				status={status}
				adjustments={adjustments}
				locale={locale}
				disabled={disabled}
				faces={detectedFaces}
				detecting={detecting}
				canDetect={canDetect}
				readOnly={readOnly}
				onDetect={onDetect}
				onChange={(value) => {
					setAdjustments(value);
					onChange(value);
				}}
			/>
			<output data-testid="lab-adjustments">
				{JSON.stringify(adjustments)}
			</output>
		</>
	);
}

function edited(): MediaPortraitAdjustments {
	return JSON.parse(screen.getByTestId("lab-adjustments").textContent ?? "{}");
}

function activateTab({ name }: { name: string }) {
	fireEvent.mouseDown(screen.getByRole("tab", { name }), {
		button: 0,
		ctrlKey: false,
	});
}

function openGroup({ section }: { section: keyof typeof groupLabels }) {
	if (section === "body") activateTab({ name: "美体" });
	const trigger = within(
		screen.getByTestId(`beauty-lab-group-${section}`)
	).getByRole("button", { name: groupLabels[section] });
	if (trigger.getAttribute("aria-expanded") === "false")
		fireEvent.click(trigger);
}

function editNumber({ label, value }: { label: string; value: string }) {
	const input = screen.getByLabelText(`${label}数值`);
	fireEvent.change(input, { target: { value } });
	fireEvent.blur(input);
}

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.mocked(localStorage.getItem).mockImplementation(
		(key) => storage.get(key) ?? null
	);
	vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
		storage.set(key, value);
	});
});

function selectFace({ name }: { name: string }) {
	fireEvent.keyDown(screen.getByRole("combobox", { name: "人脸选择" }), {
		key: "ArrowDown",
	});
	fireEvent.keyDown(screen.getByRole("option", { name }), { key: "Enter" });
}

describe("Beauty Lab draft controls", () => {
	it("browses every numeric feature category read-only without changing canonical ranges or values", () => {
		const onChange = vi.fn();
		render(<Harness readOnly onChange={onChange} />);
		openGroup({ section: "features" });
		const section = screen.getByTestId("portrait-section-features");
		for (const { category, label } of featureCategories) {
			const tab = within(section).getByRole("button", { name: label });
			expect(tab).not.toBeDisabled();
			fireEvent.click(tab);
			for (const control of nativeStatus.catalog.filter(
				(control) =>
					control.section === "features" && control.category === category
			)) {
				expect(screen.getByLabelText(`${control.titleZh}数值`)).toBeDisabled();
				expect(
					within(section).getByRole("slider", { name: control.titleZh })
				).toHaveAttribute("aria-valuemax", String(control.max));
			}
		}
		expect(
			screen.getByRole("slider", { name: "眼睛大小（精修）" })
		).toHaveAttribute("aria-valuemax", "50");
		expect(
			within(section).getByRole("button", { name: "重置本组" })
		).toBeDisabled();
		editNumber({ label: "眼睛大小（精修）", value: "100" });
		fireEvent.click(within(section).getByRole("button", { name: "重置本组" }));
		expect(onChange).not.toHaveBeenCalled();
		expect(edited()).toEqual(initial);
	});

	it("keeps recorded tabs/groups/face browsing open while blocking detection, body and presets", () => {
		const onChange = vi.fn();
		const onDetect = vi.fn();
		render(
			<Harness readOnly faces={faces} onChange={onChange} onDetect={onDetect} />
		);
		selectFace({ name: "人脸 2" });
		expect(
			screen.getByRole("combobox", { name: "人脸选择" })
		).toHaveTextContent("人脸 2");
		expect(screen.getByRole("button", { name: "识别人脸" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "识别人脸" }));
		openGroup({ section: "face-shape" });
		expect(screen.getByLabelText("瘦脸数值")).toBeDisabled();
		openGroup({ section: "body" });
		expect(screen.getByLabelText("瘦腰数值")).toBeDisabled();
		editNumber({ label: "瘦腰", value: "77" });
		activateTab({ name: "美颜预设" });
		expect(screen.getByRole("button", { name: "保存美颜预设" })).toBeDisabled();
		activateTab({ name: "美体预设" });
		expect(screen.getByRole("button", { name: "保存美体预设" })).toBeDisabled();
		expect(onChange).not.toHaveBeenCalled();
		expect(onDetect).not.toHaveBeenCalled();
		expect(edited()).toEqual(initial);
	});

	it("layers the portalled face picker above the lab dialog", () => {
		render(<Harness faces={faces} />);
		fireEvent.keyDown(screen.getByRole("combobox", { name: "人脸选择" }), {
			key: "ArrowDown",
		});
		const menu = screen.getByRole("listbox");
		expect(menu).toHaveClass("z-[1100]");
		expect(menu).not.toHaveClass("z-50");
		expect(screen.getByTestId("beauty-lab-controls").contains(menu)).toBe(
			false
		);
	});

	it("shows four tabs, skin/shape/features/makeup groups and no unsupported manual actions", () => {
		render(<Harness />);
		expect(
			within(screen.getByRole("tablist", { name: "美颜实验室分组" }))
				.getAllByRole("tab")
				.map((tab) => tab.textContent)
		).toEqual(["美颜", "美体", "美颜预设", "美体预设"]);
		for (const label of ["皮肤管理", "脸型", "五官精修", "美妆"])
			expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
		expect(screen.queryByText("手动精修")).not.toBeInTheDocument();
		expect(screen.queryByText("手动美体")).not.toBeInTheDocument();
	});

	it.each([
		"skin",
		"face-shape",
		"body",
	] as const)("exposes every real %s control for bounded draft numeric edits", (section) => {
		render(<Harness />);
		openGroup({ section });
		for (const control of nativeStatus.catalog.filter(
			(control) => control.section === section
		)) {
			const input = screen.getByLabelText(`${control.titleZh}数值`);
			expect(input).not.toBeDisabled();
			editNumber({ label: control.titleZh, value: "999" });
			expect(input).toHaveValue(String(control.max));
			expect(edited().values[control.key]).toBe(control.max);
		}
		expect(edited().enabled).toBe(true);
	});

	it.each(
		featureCategories
	)("reaches all real $category controls, including missing native packages", ({
		category,
		label,
	}) => {
		render(<Harness />);
		openGroup({ section: "features" });
		const section = screen.getByTestId("portrait-section-features");
		fireEvent.click(within(section).getByRole("button", { name: label }));
		const controls = nativeStatus.catalog.filter(
			(control) =>
				control.section === "features" && control.category === category
		);
		expect(controls.length).toBeGreaterThan(0);
		for (const control of controls) {
			expect(
				within(section).getByRole("slider", { name: control.titleZh })
			).toHaveAttribute("aria-valuemin", String(control.min));
			editNumber({ label: control.titleZh, value: "-999" });
			expect(edited().values[control.key] ?? 0).toBe(control.min);
		}
	});

	it("uses the shared skin tone/warmth controls and keyboard sliders without enabling the backend", () => {
		render(<Harness />);
		const slider = screen.getByRole("slider", { name: "肤色" });
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		fireEvent.keyUp(slider, { key: "ArrowRight" });
		expect(edited().values.face_adjust_skin_Intensity).toBe(1);
		editNumber({ label: "冷暖", value: "-17.6" });
		expect(edited().values.face_adjust_skin_ColdWarm).toBe(-18);
		expect(nativeStatus.available).toBe(false);
	});

	it.each([
		"skin",
		"face-shape",
		"features",
		"body",
	] as const)("resets only the %s group across categories", (section) => {
		const values = Object.fromEntries(
			nativeStatus.catalog.map((control) => [control.key, 15])
		);
		render(<Harness adjustments={{ ...initial, values }} />);
		openGroup({ section });
		fireEvent.click(
			within(screen.getByTestId(`portrait-section-${section}`)).getByRole(
				"button",
				{ name: "重置本组" }
			)
		);
		expect(edited().values).toEqual(
			Object.fromEntries(
				nativeStatus.catalog
					.filter((control) => control.section !== section)
					.map((control) => [control.key, 15])
			)
		);
		expect(edited().makeup).toEqual(initial.makeup);
	});

	it("resets one value without clearing other groups", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "重置磨皮" }));
		expect(edited().values).toEqual({
			...initial.values,
			face_adjust_Smooth: 0,
		});
	});

	it.each(
		makeupCategories
	)("allows draft $category makeup selection and intensity without mutating native readiness", ({
		category,
		label,
	}) => {
		const snapshot = JSON.stringify(nativeStatus);
		render(<Harness adjustments={{ ...initial, makeup: undefined }} />);
		fireEvent.click(screen.getByRole("button", { name: "美妆" }));
		activateTab({ name: label });
		const card = nativeStatus.makeupCards.find(
			(card) => card.category === category && !card.legacyOnly
		);
		expect(card).toBeDefined();
		if (!card) throw new Error("Missing catalog makeup card");
		const section = screen.getByTestId("portrait-section-makeup");
		const button = within(section).getByTestId(
			`portrait-makeup-card-${card.id}`
		);
		expect(button).not.toBeDisabled();
		fireEvent.click(button);
		editNumber({ label: "程度", value: "53" });
		expect(edited().makeup?.[category]).toEqual({
			cardId: card.id,
			intensity: 53,
		});
		fireEvent.click(within(section).getByRole("button", { name: "无" }));
		expect(edited().makeup?.[category]).toBeUndefined();
		expect(JSON.stringify(nativeStatus)).toBe(snapshot);
	});

	it("lists only the first five observations and edits the real binding/track, not ordinal or base face id", () => {
		render(<Harness faces={faces} />);
		fireEvent.keyDown(screen.getByRole("combobox", { name: "人脸选择" }), {
			key: "ArrowDown",
		});
		expect(
			screen.getAllByRole("option").map((option) => option.textContent)
		).toEqual(["全部人脸", "人脸 1", "人脸 2", "人脸 3", "人脸 4", "人脸 5"]);
		fireEvent.keyDown(screen.getByRole("option", { name: "人脸 5" }), {
			key: "Enter",
		});
		editNumber({ label: "磨皮", value: "44" });
		expect(edited().values).toEqual(initial.values);
		expect(edited().makeup).toEqual(initial.makeup);
		expect(edited().faces).toEqual([
			expect.objectContaining({
				trackId: 105,
				personBindingId: "observed-105",
				values: { face_adjust_Smooth: 44 },
				bindingAnchor: { rect: faces[4].rect, frameNumber: 0 },
			}),
		]);
	});

	it("keeps other people's edits and uses current track metadata after detection refresh", () => {
		const other = {
			trackId: 9,
			personBindingId: "observed-9",
			values: { face_adjust_Smooth: 80 },
		};
		const view = render(
			<Harness faces={faces} adjustments={{ ...initial, faces: [other] }} />
		);
		selectFace({ name: "人脸 1" });
		view.rerender(
			<Harness
				faces={[
					{ ...faces[0], trackId: 144, freidTrackId: 144 },
					...faces.slice(1),
				]}
			/>
		);
		editNumber({ label: "磨皮", value: "45" });
		expect(edited().faces).toEqual([
			other,
			expect.objectContaining({
				trackId: 144,
				personBindingId: "observed-42",
				values: { face_adjust_Smooth: 45 },
			}),
		]);
		view.rerender(<Harness faces={[]} />);
		expect(
			screen.getByRole("combobox", { name: "人脸选择" })
		).toHaveTextContent("全部人脸");
		editNumber({ label: "磨皮", value: "33" });
		expect(edited().values.face_adjust_Smooth).toBe(33);
		expect(edited().faces?.[1].values.face_adjust_Smooth).toBe(45);
	});

	it("keeps body edits whole-frame even when a face is selected", () => {
		render(<Harness faces={faces} />);
		selectFace({ name: "人脸 2" });
		editNumber({ label: "磨皮", value: "45" });
		activateTab({ name: "美体" });
		editNumber({ label: "瘦腰", value: "60" });
		expect(edited().values).toEqual({
			...initial.values,
			body_adjust_SlimWaist: 60,
		});
		expect(edited().faces?.[0]).toMatchObject({
			trackId: 9,
			values: { face_adjust_Smooth: 45 },
		});
		expect(
			screen.queryByRole("combobox", { name: "人脸选择" })
		).not.toBeInTheDocument();
	});

	it("commits an in-progress numeric input before navigating away", () => {
		render(<Harness />);
		act(() => screen.getByLabelText("磨皮数值").focus());
		fireEvent.change(screen.getByLabelText("磨皮数值"), {
			target: { value: "47" },
		});
		activateTab({ name: "美颜预设" });
		expect(edited().values.face_adjust_Smooth).toBe(47);
		fireEvent.click(screen.getByRole("button", { name: "保存美颜预设" }));
		expect(
			JSON.parse(localStorage.getItem(BEAUTY_LAB_PRESET_STORAGE_KEY) ?? "[]")[0]
				.values.face_adjust_Smooth
		).toBe(47);
	});

	it("saves and applies face presets to the selected actual person without changing global/body values", () => {
		render(<Harness faces={faces} />);
		selectFace({ name: "人脸 1" });
		editNumber({ label: "磨皮", value: "41" });
		activateTab({ name: "美颜预设" });
		fireEvent.click(screen.getByRole("button", { name: "保存美颜预设" }));
		activateTab({ name: "美颜" });
		editNumber({ label: "磨皮", value: "11" });
		activateTab({ name: "美颜预设" });
		fireEvent.keyDown(screen.getByRole("combobox", { name: "美颜预设" }), {
			key: "ArrowDown",
		});
		fireEvent.keyDown(screen.getByRole("option", { name: "美颜预设" }), {
			key: "Enter",
		});
		fireEvent.click(screen.getByRole("button", { name: "应用美颜预设" }));
		expect(edited().faces?.[0]).toMatchObject({
			trackId: 42,
			values: { face_adjust_Smooth: 41 },
		});
		expect(edited().values).toEqual(initial.values);
	});

	it("disables numeric/reset/makeup/preset/detect mutations only on the disabled prop", () => {
		const onChange = vi.fn();
		const onDetect = vi.fn();
		render(<Harness disabled onChange={onChange} onDetect={onDetect} />);
		expect(screen.getByLabelText("磨皮数值")).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "重置本组" }));
		fireEvent.click(screen.getByRole("button", { name: "识别人脸" }));
		fireEvent.click(screen.getByRole("button", { name: "美妆" }));
		expect(
			screen.getByTestId("portrait-makeup-card-look-oxygen")
		).toBeDisabled();
		activateTab({ name: "美颜预设" });
		fireEvent.click(screen.getByRole("button", { name: "保存美颜预设" }));
		expect(onChange).not.toHaveBeenCalled();
		expect(onDetect).not.toHaveBeenCalled();
		expect(localStorage.getItem(BEAUTY_LAB_PRESET_STORAGE_KEY)).toBeNull();
	});

	it("delegates detection, blocks repeat requests and leaves draft values editable while detecting", () => {
		const onDetect = vi.fn();
		const view = render(<Harness onDetect={onDetect} />);
		fireEvent.click(screen.getByRole("button", { name: "识别人脸" }));
		expect(onDetect).toHaveBeenCalledTimes(1);
		view.rerender(<Harness detecting onDetect={onDetect} />);
		expect(screen.getByRole("button", { name: "识别中" })).toBeDisabled();
		expect(screen.getByRole("combobox", { name: "人脸选择" })).toBeDisabled();
		expect(screen.getByLabelText("磨皮数值")).not.toBeDisabled();
	});

	it("gates unavailable detection without disabling the draft catalog", () => {
		const onDetect = vi.fn();
		render(<Harness canDetect={false} onDetect={onDetect} />);
		expect(screen.getByRole("button", { name: "识别人脸" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "识别人脸" }));
		expect(onDetect).not.toHaveBeenCalled();
		expect(screen.getByLabelText("磨皮数值")).not.toBeDisabled();
		editNumber({ label: "磨皮", value: "66" });
		expect(edited().values.face_adjust_Smooth).toBe(66);
		fireEvent.click(screen.getByRole("button", { name: "美妆" }));
		expect(
			screen.getByTestId("portrait-makeup-card-look-oxygen")
		).not.toBeDisabled();
	});

	it("treats null as loading, without inventing a partial catalog", () => {
		render(<Harness status={null} />);
		expect(
			within(screen.getByTestId("beauty-lab-controls")).getByRole("status")
		).toHaveTextContent("正在加载美颜控件");
		expect(screen.queryByRole("slider")).not.toBeInTheDocument();
		activateTab({ name: "美颜预设" });
		expect(screen.getByRole("button", { name: "保存美颜预设" })).toBeDisabled();
	});

	it("uses English labels and recognizes regional Chinese locales", () => {
		const view = render(<Harness locale="en" />);
		expect(screen.getByLabelText("Smooth value")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Detect faces" })
		).toHaveAttribute("title", "Detect faces");
		view.rerender(<Harness locale="zh-CN" />);
		expect(screen.getByLabelText("磨皮数值")).toBeInTheDocument();
	});
});
