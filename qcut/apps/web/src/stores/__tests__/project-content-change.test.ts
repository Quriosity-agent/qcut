import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TProject } from "@/types/project";

const mocks = vi.hoisted(() => ({ saveProject: vi.fn() }));

vi.mock("@/lib/storage/storage-service", () => ({
	storageService: { saveProject: mocks.saveProject },
}));

import { saveProjectContentChange } from "../project-content-change";

const YESTERDAY = new Date("2026-11-13T07:46:53.603Z");
const NOW = new Date("2026-11-14T10:00:00.000Z");

function project(overrides: Partial<TProject> = {}): TProject {
	return {
		id: "project-1",
		name: "Opening",
		createdAt: YESTERDAY,
		updatedAt: YESTERDAY,
		fps: 24,
		...overrides,
	} as TProject;
}

describe("a project's last-modified time after its contents change", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.saveProject.mockResolvedValue(undefined);
	});

	it("moves the open project's updatedAt to now, in the editor and in storage", async () => {
		let active: TProject | null = project();
		const updatedAt = await saveProjectContentChange({
			projectId: "project-1",
			getActiveProject: () => active,
			setActiveProject: (next) => {
				active = next;
			},
			now: () => NOW,
		});

		expect(updatedAt).toEqual(NOW);
		expect(active?.updatedAt).toEqual(NOW);
		expect(active?.createdAt).toEqual(YESTERDAY);
		expect(mocks.saveProject).toHaveBeenCalledWith({
			project: expect.objectContaining({ id: "project-1", updatedAt: NOW }),
		});
	});

	it("saves the project as the editor holds it now, not an earlier copy", async () => {
		const active = project({ fps: 30, name: "Renamed since" });
		await saveProjectContentChange({
			projectId: "project-1",
			getActiveProject: () => active,
			setActiveProject: vi.fn(),
			now: () => NOW,
		});
		expect(mocks.saveProject).toHaveBeenCalledWith({
			project: expect.objectContaining({ fps: 30, name: "Renamed since" }),
		});
	});

	it("does nothing for a project that is not the open one", async () => {
		const setActiveProject = vi.fn();
		const updatedAt = await saveProjectContentChange({
			projectId: "another-project",
			getActiveProject: () => project(),
			setActiveProject,
			now: () => NOW,
		});
		expect(updatedAt).toBeNull();
		expect(setActiveProject).not.toHaveBeenCalled();
		expect(mocks.saveProject).not.toHaveBeenCalled();
	});
});
