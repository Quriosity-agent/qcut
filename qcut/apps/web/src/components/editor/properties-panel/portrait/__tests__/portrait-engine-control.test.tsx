import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@/test/test-utils";
import type { JianyingPortraitAdjustmentStatus } from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitEngineControl } from "../portrait-engine-control";

const nativeStatus = {
	state: "ready",
	available: true,
	offlineReady: true,
	provider: "jianying-local-swing-v1",
	message: "ready",
	catalog: [
		{
			key: "face_adjust_BrightEye",
			group: "face",
			section: "features",
			titleZh: "亮眼",
			titleEn: "Bright eyes",
			min: 0,
			max: 100,
			step: 1,
		},
	],
	packages: [],
	makeupCards: [],
} as unknown as JianyingPortraitAdjustmentStatus;

let inspectIndependent: ReturnType<typeof vi.fn>;
beforeEach(() => {
	inspectIndependent = vi.fn(async () => ({
		available: true,
		provider: "qcut-independent-photo-v1",
		message: "ready",
		controls: ["face_adjust_Whiten"],
		makeupCards: [],
	}));
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: { beautyLab: { inspectIndependent } },
	});
});
afterEach(() => {
	Reflect.deleteProperty(window, "electronAPI");
});

function renderControl({
	adjustments,
	onChange = vi.fn(),
}: {
	adjustments: MediaPortraitAdjustments;
	onChange?: (adjustments: MediaPortraitAdjustments) => void;
}) {
	render(
		<PortraitEngineControl
			adjustments={adjustments}
			nativeStatus={nativeStatus}
			disabled={false}
			locale="zh"
			onChange={onChange}
		/>
	);
	return onChange;
}

function chooseEngine({ name }: { name: string }) {
	fireEvent.keyDown(screen.getByRole("combobox", { name: "美颜处理引擎" }), {
		key: "ArrowDown",
	});
	fireEvent.keyDown(screen.getByRole("option", { name }), { key: "Enter" });
}

describe("portrait engine control", () => {
	it("defaults to native without inspecting the independent engine", () => {
		renderControl({ adjustments: { enabled: true, values: {} } });
		expect(
			screen.getByRole("combobox", { name: "美颜处理引擎" })
		).toHaveTextContent("原生");
		expect(screen.queryByTestId("portrait-engine-note")).toBeNull();
		expect(inspectIndependent).not.toHaveBeenCalled();
	});

	it("stores the independent choice", () => {
		const onChange = renderControl({
			adjustments: { enabled: true, values: { face_adjust_Whiten: 40 } },
		});
		chooseEngine({ name: "自研" });
		expect(onChange).toHaveBeenLastCalledWith({
			enabled: true,
			engine: "independent",
			values: { face_adjust_Whiten: 40 },
		});
	});

	it("drops the stored key when switching back to native", () => {
		const onChange = renderControl({
			adjustments: { enabled: true, engine: "independent", values: {} },
		});
		chooseEngine({ name: "原生" });
		expect(onChange).toHaveBeenLastCalledWith({ enabled: true, values: {} });
	});

	it("states the speed and lists edits the engine cannot run by name", async () => {
		renderControl({
			adjustments: {
				enabled: true,
				engine: "independent",
				values: { face_adjust_Whiten: 40, face_adjust_BrightEye: 20 },
			},
		});
		expect(screen.getByTestId("portrait-engine-note")).toHaveTextContent(
			"每帧约 3–12 秒"
		);
		await waitFor(() =>
			expect(screen.getByTestId("portrait-engine-issue")).toHaveTextContent(
				"自研不支持：亮眼"
			)
		);
	});

	it("shows why the engine is unavailable", async () => {
		inspectIndependent.mockResolvedValueOnce({
			available: false,
			provider: "qcut-independent-photo-v1",
			message: "Independent runtime payload incomplete",
			controls: [],
			makeupCards: [],
		});
		renderControl({
			adjustments: { enabled: true, engine: "independent", values: {} },
		});
		await waitFor(() =>
			expect(screen.getByTestId("portrait-engine-runtime")).toHaveTextContent(
				"Independent runtime payload incomplete"
			)
		);
		expect(screen.queryByTestId("portrait-engine-issue")).toBeNull();
	});
});
