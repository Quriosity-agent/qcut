import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronAPI } from "@/types/electron";
import { syncProjectSkillsForClaude } from "../claude-bridge/project-skills-sync";

let originalElectronAPI: ElectronAPI | undefined;

beforeEach(() => {
	originalElectronAPI = window.electronAPI;
});

afterEach(() => {
	window.electronAPI = originalElectronAPI;
	vi.restoreAllMocks();
});

describe("syncProjectSkillsForClaude", () => {
	it("calls skills.syncForClaude when API is available", () => {
		const syncForClaude = vi.fn().mockResolvedValue({
			synced: true,
			copied: 1,
			skipped: 0,
			removed: 0,
			warnings: [],
		});

		const electronApi = {
			skills: {
				syncForClaude,
			},
		} as unknown as ElectronAPI;

		syncProjectSkillsForClaude({
			projectId: "project-1",
			electronApi,
		});

		expect(syncForClaude).toHaveBeenCalledWith("project-1");
	});

	it("does not throw when Electron skills API is unavailable", () => {
		window.electronAPI = undefined;

		expect(() => {
			syncProjectSkillsForClaude({ projectId: "project-2" });
		}).not.toThrow();
	});

	it("warns when sync promise rejects", async () => {
		const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const syncForClaude = vi.fn().mockRejectedValue(new Error("sync failed"));
		const electronApi = {
			skills: {
				syncForClaude,
			},
		} as unknown as ElectronAPI;

		syncProjectSkillsForClaude({
			projectId: "project-3",
			electronApi,
		});

		await Promise.resolve();

		expect(warningSpy).toHaveBeenCalledWith(
			"[ProjectStore] skills syncForClaude failed",
			expect.any(Error)
		);
	});
});
