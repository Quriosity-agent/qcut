import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { normalizeMediaPortraitAdjustments } from "@qcut/editor-core";
import { fireEvent, render, screen } from "@/test/test-utils";
import type { BeautyLabIndependentStatus } from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { PortraitBodyVideoProfileControl } from "../portrait-body-video-profile-control";

const ready: BeautyLabIndependentStatus = {
	available: true,
	provider: "qcut-independent-photo-v1",
	message: "ready",
	controls: ["body_adjust_SlimBody"],
	makeupCards: [],
	bodyVideo: true,
	bodyVideoProfiles: {
		"swing-coreml-v1": { available: true, message: "ready" },
	},
};
const legacy: MediaPortraitAdjustments = {
	enabled: true,
	engine: "independent",
	values: { body_adjust_SlimBody: 40 },
};

function choose({ name }: { name: string }) {
	fireEvent.keyDown(
		screen.getByRole("combobox", { name: "美体视频计算方式" }),
		{ key: "ArrowDown" }
	);
	fireEvent.keyDown(screen.getByRole("option", { name }), { key: "Enter" });
}

function SavedProjectHarness({ saved }: { saved: string }) {
	const [adjustments, setAdjustments] = useState(() =>
		normalizeMediaPortraitAdjustments({ adjustments: JSON.parse(saved) })
	);
	return (
		<>
			<PortraitBodyVideoProfileControl
				adjustments={adjustments}
				status={ready}
				error={null}
				locale="zh"
				onChange={setAdjustments}
			/>
			<output data-testid="saved-project">{JSON.stringify(adjustments)}</output>
		</>
	);
}

describe("body video profile selection", () => {
	it("saves CoreML, restores it after reopening and removes the field when CPU is selected", () => {
		const view = render(<SavedProjectHarness saved={JSON.stringify(legacy)} />);
		expect(screen.getByRole("combobox")).toHaveTextContent("CPU 稳定");
		choose({ name: "原生调度 CoreML" });
		const saved = screen.getByTestId("saved-project").textContent ?? "{}";
		expect(JSON.parse(saved)).toEqual({
			...legacy,
			bodyVideoProfile: "swing-coreml-v1",
		});
		view.unmount();
		render(<SavedProjectHarness saved={saved} />);
		expect(screen.getByRole("combobox")).toHaveTextContent("原生调度 CoreML");
		choose({ name: "CPU 稳定" });
		expect(
			JSON.parse(screen.getByTestId("saved-project").textContent ?? "{}")
		).toEqual(legacy);
	});

	it.each([
		{ status: null, error: null, reason: "正在检查" },
		{ status: ready, error: "Inspection failed", reason: "Inspection failed" },
		{
			status: { ...ready, bodyVideoProfiles: undefined },
			error: null,
			reason: "未配置",
		},
		{
			status: { ...ready, bodyVideo: false },
			error: null,
			reason: "不支持视频",
		},
		{
			status: { ...ready, available: false, message: "Runtime unavailable" },
			error: null,
			reason: "Runtime unavailable",
		},
		{
			status: {
				...ready,
				bodyVideoProfiles: {
					"swing-coreml-v1": {
						available: false,
						message: "Missing CoreML models",
					},
				},
			},
			error: null,
			reason: "Missing CoreML models",
		},
	])("blocks unconfigured profiles: $reason", ({ status, error, reason }) => {
		const onChange = vi.fn();
		render(
			<PortraitBodyVideoProfileControl
				adjustments={legacy}
				status={status}
				error={error}
				locale="zh"
				onChange={onChange}
			/>
		);
		expect(
			screen.getByTestId("portrait-body-video-profile-status")
		).toHaveTextContent(reason);
		fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
		const option = screen.getByRole("option", { name: "原生调度 CoreML" });
		expect(option).toHaveAttribute("aria-disabled", "true");
		fireEvent.keyDown(option, { key: "Enter" });
		expect(onChange).not.toHaveBeenCalled();
	});

	it("retains an unavailable saved CoreML choice and lets the user explicitly return to CPU", () => {
		const onChange = vi.fn();
		render(
			<PortraitBodyVideoProfileControl
				adjustments={{ ...legacy, bodyVideoProfile: "swing-coreml-v1" }}
				status={{
					...ready,
					bodyVideoProfiles: {
						"swing-coreml-v1": {
							available: false,
							message: "Requires macOS arm64",
						},
					},
				}}
				error={null}
				locale="zh"
				onChange={onChange}
			/>
		);
		expect(screen.getByRole("combobox")).toHaveTextContent("原生调度 CoreML");
		expect(screen.getByRole("alert")).toHaveTextContent("Requires macOS arm64");
		expect(screen.getByRole("alert")).toHaveTextContent("选择保持不变");
		expect(onChange).not.toHaveBeenCalled();
		choose({ name: "CPU 稳定" });
		expect(onChange).toHaveBeenCalledExactlyOnceWith(legacy);
	});
});
