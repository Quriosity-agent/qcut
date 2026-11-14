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

	it("does not put back a setting that was being saved when it ran", async () => {
		// The frame-rate change is stored first and reaches the editor after.
		let active: TProject | null = project({ fps: 24 });
		const stored: TProject[] = [];
		let publishFps: () => void = () => undefined;
		mocks.saveProject.mockImplementation(
			async ({ project: saved }: { project: TProject }) => {
				stored.push(saved);
				// While the content save is in flight, the fps save lands and
				// the editor takes the new rate.
				if (saved.fps === 24) publishFps();
			}
		);
		const fpsChange = { ...project({ fps: 60 }), updatedAt: NOW };
		stored.push(fpsChange);
		publishFps = () => {
			active = fpsChange;
		};

		await saveProjectContentChange({
			projectId: "project-1",
			getActiveProject: () => active,
			setActiveProject: (next) => {
				active = next;
			},
			now: () => NOW,
		});

		expect(stored.at(-1)?.fps).toBe(60);
		expect(active?.fps).toBe(60);
	});

	it("keeps up with a second setting saved while it was correcting the first", async () => {
		let active: TProject | null = project({ fps: 24 });
		const stored: TProject[] = [];
		const fps60 = { ...project({ fps: 60 }), updatedAt: NOW };
		const fps30 = { ...project({ fps: 30 }), updatedAt: NOW };
		mocks.saveProject.mockImplementation(
			async ({ project: saved }: { project: TProject }) => {
				// The content save meets the 60 fps change, and its follow-up
				// save in turn meets a 30 fps change that landed just before it.
				if (saved.fps === 24) {
					stored.push(fps60);
					active = fps60;
				}
				if (saved === fps60) {
					stored.push(fps30);
					active = fps30;
				}
				stored.push(saved);
			}
		);

		await saveProjectContentChange({
			projectId: "project-1",
			getActiveProject: () => active,
			setActiveProject: (next) => {
				active = next;
			},
			now: () => NOW,
		});

		// Storage ends on what the editor shows.
		expect(stored.at(-1)).toBe(fps30);
		expect(active).toBe(fps30);
	});

	it("keeps its own time when the setting saved meanwhile was stamped earlier", async () => {
		let active: TProject | null = project({ fps: 24 });
		const stored: TProject[] = [];
		// Started before the content change, published during its save.
		const fps60 = { ...project({ fps: 60 }), updatedAt: YESTERDAY };
		mocks.saveProject.mockImplementation(
			async ({ project: saved }: { project: TProject }) => {
				if (saved.fps === 24) active = fps60;
				stored.push(saved);
			}
		);

		await saveProjectContentChange({
			projectId: "project-1",
			getActiveProject: () => active,
			setActiveProject: (next) => {
				active = next;
			},
			now: () => NOW,
		});

		expect(stored.at(-1)).toMatchObject({ fps: 60, updatedAt: NOW });
		expect(active).toMatchObject({ fps: 60, updatedAt: NOW });
		expect(mocks.saveProject).toHaveBeenCalledTimes(2);
	});

	it("stops following a project that will not hold still", async () => {
		let active: TProject | null = project();
		mocks.saveProject.mockImplementation(async () => {
			active = { ...(active as TProject) };
		});
		await saveProjectContentChange({
			projectId: "project-1",
			getActiveProject: () => active,
			setActiveProject: (next) => {
				active = next;
			},
			now: () => NOW,
		});
		expect(mocks.saveProject).toHaveBeenCalledTimes(6);
	});

	it("saves once when nothing else changed the project meanwhile", async () => {
		let active: TProject | null = project();
		await saveProjectContentChange({
			projectId: "project-1",
			getActiveProject: () => active,
			setActiveProject: (next) => {
				active = next;
			},
			now: () => NOW,
		});
		expect(mocks.saveProject).toHaveBeenCalledTimes(1);
	});
});
