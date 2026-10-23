import { useState } from "react";
import { DEFAULT_MEDIA_ENHANCEMENTS } from "@/lib/video/video-properties";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@/test/test-utils";
import { JIANYING_PORTRAIT_ADJUSTMENT_CATALOG } from "../../../../../../../../electron/jianying-portrait-adjustment-runtime/catalog";
import { usePortraitManualBodyStore } from "@/stores/editor/portrait-manual-body-store";
import type {
	BeautyLabIndependentStatus,
	JianyingPortraitAdjustmentStatus,
} from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { MediaPortraitProperties } from "../media-portrait-properties";

vi.mock("../../beauty-lab/beauty-lab-dialog", () => ({
	BeautyLabDialog: () => null,
}));
vi.mock("@/lib/i18n", () => ({
	useTranslation: () => ({ locale: "zh", t: (key: string) => key }),
}));

let native: JianyingPortraitAdjustmentStatus;
let independent: BeautyLabIndependentStatus;
let inspectNative: ReturnType<typeof vi.fn>;
let inspectIndependent: ReturnType<typeof vi.fn>;
const interactionStart = vi.fn();
const interactionEnd = vi.fn();

beforeEach(() => {
	interactionStart.mockClear();
	interactionEnd.mockClear();
	native = {
		state: "ready",
		available: true,
		offlineReady: true,
		provider: "jianying-local-swing-v1",
		message: "ready",
		catalog: JIANYING_PORTRAIT_ADJUSTMENT_CATALOG,
		packages: ["body", "manual-stretch", "manual-slim", "manual-zoom"].map(
			(runtimePackage) => ({ runtimePackage, ready: true })
		),
		makeupCards: [],
	} as unknown as JianyingPortraitAdjustmentStatus;
	independent = {
		available: true,
		provider: "qcut-independent-photo-v1",
		message: "ready",
		controls: ["body_adjust_StretchLeg"],
		manualBodyTools: ["stretch", "slim", "zoom"],
		makeupCards: [],
	};
	inspectNative = vi.fn(async () => native);
	inspectIndependent = vi.fn(async () => independent);
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: {
			jianyingPortraitAdjustment: { inspect: inspectNative },
			beautyLab: { inspectIndependent },
		},
	});
	usePortraitManualBodyStore.setState({
		active: false,
		elementId: null,
		tool: "stretch",
		manualBody: {},
		past: [],
		future: [],
		interactionStartValue: null,
		bindings: null,
	});
});
afterEach(() => Reflect.deleteProperty(window, "electronAPI"));

function Harness({
	engine = "independent",
	manualBody,
	mediaType = "video",
}: {
	engine?: "native" | "independent";
	manualBody?: MediaPortraitAdjustments["manualBody"];
	mediaType?: string;
}) {
	const [adjustments, setAdjustments] = useState<MediaPortraitAdjustments>({
		enabled: true,
		engine,
		values: {},
		...(manualBody ? { manualBody } : {}),
	});
	return (
		<>
			<MediaPortraitProperties
				elementId="body-clip"
				mediaType={mediaType}
				currentFrame={0}
				enhancements={DEFAULT_MEDIA_ENHANCEMENTS}
				adjustments={adjustments}
				onEnhancementsChange={vi.fn()}
				onAdjustmentsChange={setAdjustments}
				onInteractionStart={interactionStart}
				onInteractionEnd={interactionEnd}
			/>
			<output data-testid="stored-adjustments">
				{JSON.stringify(adjustments)}
			</output>
		</>
	);
}

function openBody() {
	fireEvent.mouseDown(screen.getByRole("tab", { name: "美体" }), {
		button: 0,
		ctrlKey: false,
	});
}

function chooseEngine({ name }: { name: string }) {
	fireEvent.keyDown(screen.getByRole("combobox", { name: "美颜处理引擎" }), {
		key: "ArrowDown",
	});
	fireEvent.keyDown(screen.getByRole("option", { name }), { key: "Enter" });
}

describe("desktop portrait engine capabilities", () => {
	it("exposes the configured video profile and records an undoable project edit", async () => {
		independent = {
			...independent,
			bodyVideo: true,
			bodyVideoProfiles: {
				"swing-coreml-v1": { available: true, message: "ready" },
			},
		};
		render(<Harness />);
		await waitFor(() =>
			expect(
				screen.queryByTestId("portrait-body-video-profile-status")
			).toBeNull()
		);
		fireEvent.keyDown(
			screen.getByRole("combobox", { name: "美体视频计算方式" }),
			{ key: "ArrowDown" }
		);
		expect(
			screen.getByRole("option", { name: "原生调度 CoreML" })
		).not.toHaveAttribute("aria-disabled", "true");
		fireEvent.keyDown(screen.getByRole("option", { name: "原生调度 CoreML" }), {
			key: "Enter",
		});
		expect(screen.getByTestId("stored-adjustments")).toHaveTextContent(
			'"bodyVideoProfile":"swing-coreml-v1"'
		);
		expect(interactionStart).toHaveBeenCalledOnce();
		expect(interactionEnd).toHaveBeenCalledOnce();
	});

	it.each([
		"image",
		"audio",
	])("does not offer a video profile for %s media", (mediaType) => {
		render(<Harness mediaType={mediaType} />);
		expect(
			screen.queryByTestId("portrait-body-video-profile-control")
		).toBeNull();
	});

	it("edits independent smart and manual body when native inspection fails", async () => {
		inspectNative.mockRejectedValueOnce(new Error("Native runtime absent"));
		render(<Harness />);
		openBody();
		await waitFor(() =>
			expect(screen.getByLabelText("长腿数值")).toBeEnabled()
		);
		expect(screen.getByLabelText("瘦腰数值")).toBeDisabled();
		expect(screen.getByTestId("portrait-body-scope")).toHaveTextContent(
			"首个检测人物"
		);
		expect(screen.getByTestId("portrait-body-scope")).not.toHaveTextContent(
			"全部人物"
		);
		fireEvent.change(screen.getByLabelText("长腿数值"), {
			target: { value: "40" },
		});
		fireEvent.blur(screen.getByLabelText("长腿数值"));
		expect(screen.getByTestId("stored-adjustments")).toHaveTextContent(
			'"body_adjust_StretchLeg":40'
		);
		fireEvent.click(screen.getByRole("button", { name: "手动美体" }));
		for (const name of ["拉长", "瘦身瘦腿", "放大缩小"])
			expect(screen.getByRole("button", { name })).toBeEnabled();
		expect(usePortraitManualBodyStore.getState().active).toBe(true);
		expect(inspectIndependent).toHaveBeenCalledOnce();
	});

	it("uses advertised capabilities dynamically and selects an available manual tool", async () => {
		native = { ...native, available: false, packages: [] };
		independent = {
			...independent,
			controls: ["body_adjust_SlimWaist"],
			manualBodyTools: ["zoom"],
		};
		render(<Harness />);
		openBody();
		await waitFor(() =>
			expect(screen.getByLabelText("瘦腰数值")).toBeEnabled()
		);
		expect(screen.getByLabelText("长腿数值")).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "手动美体" }));
		expect(screen.getByRole("button", { name: "拉长" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "放大缩小" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		expect(usePortraitManualBodyStore.getState().active).toBe(true);
	});

	it("does not grant an older independent runtime tools from installed native packages", async () => {
		independent = { ...independent, manualBodyTools: undefined };
		render(<Harness />);
		openBody();
		await waitFor(() =>
			expect(screen.getByLabelText("长腿数值")).toBeEnabled()
		);
		expect(screen.getByLabelText("瘦腰数值")).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "手动美体" }));
		for (const name of ["拉长", "瘦身瘦腿", "放大缩小"])
			expect(screen.getByRole("button", { name })).toBeDisabled();
		expect(usePortraitManualBodyStore.getState().active).toBe(false);
	});

	it("recomputes permissions on engine changes and keeps existing unsupported edits visible", async () => {
		render(<Harness engine="native" />);
		openBody();
		await waitFor(() =>
			expect(screen.getByLabelText("瘦腰数值")).toBeEnabled()
		);
		expect(inspectIndependent).not.toHaveBeenCalled();
		fireEvent.change(screen.getByLabelText("瘦腰数值"), {
			target: { value: "30" },
		});
		fireEvent.blur(screen.getByLabelText("瘦腰数值"));
		chooseEngine({ name: "自研" });
		await waitFor(() =>
			expect(screen.getByLabelText("长腿数值")).toBeEnabled()
		);
		expect(screen.getByLabelText("瘦腰数值")).toBeDisabled();
		expect(screen.getByLabelText("瘦腰数值")).toHaveValue("30");
		expect(screen.getByTestId("portrait-engine-issue")).toHaveTextContent(
			"瘦腰"
		);
		fireEvent.click(
			within(screen.getByTestId("portrait-section-body")).getByLabelText(
				"重置本组"
			)
		);
		expect(screen.queryByTestId("portrait-engine-issue")).toBeNull();
		chooseEngine({ name: "原生" });
		await waitFor(() =>
			expect(screen.getByLabelText("瘦腰数值")).toBeEnabled()
		);
		expect(screen.getByTestId("portrait-body-scope")).toHaveTextContent(
			"全部人物"
		);
	});

	it("disables body editing when the selected independent runtime is unavailable", async () => {
		independent = {
			...independent,
			available: false,
			message: "missing body assets",
		};
		render(<Harness />);
		openBody();
		await waitFor(() =>
			expect(screen.getByTestId("portrait-engine-runtime")).toHaveTextContent(
				"missing body assets"
			)
		);
		expect(screen.getByLabelText("长腿数值")).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "手动美体" }));
		expect(screen.getByRole("button", { name: "拉长" })).toBeDisabled();
		expect(usePortraitManualBodyStore.getState().active).toBe(false);
		fireEvent.click(screen.getByRole("switch", { name: "启用自研美颜美体" }));
		expect(screen.getByTestId("stored-adjustments")).toHaveTextContent(
			'"enabled":false'
		);
	});

	it("lets unsupported saved manual edits be cleared without enabling their overlay", async () => {
		independent = { ...independent, manualBodyTools: [] };
		render(
			<Harness
				manualBody={{ zoom: { intensity: 20, x: 0.5, y: 0.5, radius: 0.2 } }}
			/>
		);
		openBody();
		await waitFor(() =>
			expect(screen.getByTestId("portrait-engine-issue")).toHaveTextContent(
				"放大缩小"
			)
		);
		fireEvent.click(screen.getByRole("button", { name: "手动美体" }));
		expect(screen.getByRole("button", { name: "放大缩小" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		expect(usePortraitManualBodyStore.getState().active).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "重置当前工具" }));
		expect(screen.queryByTestId("portrait-engine-issue")).toBeNull();
		expect(screen.getByTestId("stored-adjustments")).not.toHaveTextContent(
			'"manualBody"'
		);
		expect(screen.getByRole("button", { name: "放大缩小" })).toBeDisabled();
	});

	it("keeps native package gates and deactivates a manual overlay after switching engines", async () => {
		native = { ...native, available: false, packages: [] };
		render(<Harness engine="native" />);
		openBody();
		await waitFor(() => expect(inspectNative).toHaveBeenCalledOnce());
		expect(inspectIndependent).not.toHaveBeenCalled();
		expect(screen.getByLabelText("长腿数值")).toBeDisabled();
		chooseEngine({ name: "自研" });
		await waitFor(() =>
			expect(screen.getByLabelText("长腿数值")).toBeEnabled()
		);
		fireEvent.click(screen.getByRole("button", { name: "手动美体" }));
		expect(usePortraitManualBodyStore.getState().active).toBe(true);
		chooseEngine({ name: "原生" });
		expect(screen.getByRole("button", { name: "拉长" })).toBeDisabled();
		expect(usePortraitManualBodyStore.getState().active).toBe(false);
	});
});
