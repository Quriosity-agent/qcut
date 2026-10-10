import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/test-utils";
import type { JianyingPortraitAdjustmentStatus } from "@/types/electron";
import { PortraitRuntimeStatus } from "../portrait-runtime-status";

const ready: JianyingPortraitAdjustmentStatus = {
	state: "ready",
	available: true,
	offlineReady: true,
	provider: "jianying-local-swing-v1",
	message: "离线运行时完整就绪",
	catalog: [],
	packages: [],
	makeupCards: [],
};

describe("portrait runtime status", () => {
	it("keeps healthy technical detail in a tooltip", () => {
		render(
			<PortraitRuntimeStatus
				status={ready}
				loading={false}
				locale="zh"
				onRefresh={vi.fn()}
			/>
		);
		expect(screen.getByText("本地美颜")).toBeVisible();
		expect(screen.getByText("离线就绪")).toBeVisible();
		expect(screen.queryByText(ready.message)).not.toBeInTheDocument();
		expect(screen.getByTitle(ready.message)).toBeInTheDocument();
	});
	it("does not hide incomplete-package diagnostics", () => {
		const status = {
			...ready,
			offlineReady: false,
			message: "未缓存的控件已禁用",
		};
		render(
			<PortraitRuntimeStatus
				status={status}
				loading={false}
				locale="zh"
				onRefresh={vi.fn()}
			/>
		);
		expect(screen.getByText(status.message)).toBeVisible();
		expect(screen.queryByText("离线就绪")).not.toBeInTheDocument();
	});
	it("shows an unavailable reason", () => {
		const status = {
			...ready,
			available: false,
			offlineReady: false,
			message: "运行时不可用",
		};
		render(
			<PortraitRuntimeStatus
				status={status}
				loading={false}
				locale="zh"
				onRefresh={vi.fn()}
			/>
		);
		expect(screen.getByText(status.message)).toBeVisible();
	});
	it("shows progress and disables repeated refreshes", () => {
		render(
			<PortraitRuntimeStatus
				status={ready}
				loading
				locale="zh"
				onRefresh={vi.fn()}
			/>
		);
		expect(screen.getByText("正在检查运行时...")).toBeVisible();
		expect(
			screen.getByRole("button", { name: "重新检查运行时" })
		).toBeDisabled();
	});
});
