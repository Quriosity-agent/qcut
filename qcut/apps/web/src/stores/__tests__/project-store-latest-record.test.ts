/**
 * N19 (2026-10-29 trailer report): a rename, a move to a folder and a
 * duplicate work on the project as the editor holds it, or as it is stored
 * when it is closed, never on the project list's older copy. A rename saved
 * that copy and lost the master curve set after it was listed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultProjectAudioMixSettings } from "@/lib/audio/audio-mix-settings";
import type { TProject } from "@/types/project";
import { useProjectStore } from "../project-store";

const storage = vi.hoisted(() => ({
	saveProject: vi.fn(),
	loadProject: vi.fn(),
	loadAllProjects: vi.fn(),
	loadAllProjectFolders: vi.fn(),
}));
const duplicate = vi.hoisted(() => ({
	copyProjectContents: vi.fn(),
	duplicateProjectName: vi.fn(),
}));

vi.mock("@/lib/storage/storage-service", () => ({ storageService: storage }));
vi.mock("@/lib/project/project-duplicate", () => duplicate);
vi.mock("@/lib/debug/error-handler", () => ({
	handleError: vi.fn(),
	handleStorageError: vi.fn(),
	ErrorCategory: { VALIDATION: "validation" },
	ErrorSeverity: { MEDIUM: "medium" },
}));
vi.mock("@/lib/debug/debug-config", () => ({
	debugError: vi.fn(),
	debugLog: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../timeline/timeline-store", () => ({
	useTimelineStore: { getState: () => ({ saveImmediate: vi.fn() }) },
}));
vi.mock("../stickers-overlay-store", () => ({
	useStickersOverlayStore: { getState: () => ({ saveToProject: vi.fn() }) },
}));

const DATE = new Date("2026-10-29T00:00:00.000Z");

/** A project whose master gain curve starts at `curveDb`. */
function project({ id, curveDb }: { id: string; curveDb: number }): TProject {
	const mix = createDefaultProjectAudioMixSettings();
	return {
		id,
		name: `Project ${id}`,
		thumbnail: "",
		createdAt: DATE,
		updatedAt: DATE,
		folderId: null,
		scenes: [
			{
				id: `${id}-scene`,
				name: "Main Scene",
				isMain: true,
				createdAt: DATE,
				updatedAt: DATE,
			},
		],
		currentSceneId: `${id}-scene`,
		canvasSize: { width: 1470, height: 630 },
		canvasMode: "custom",
		audioMix: {
			...mix,
			master: {
				...mix.master,
				automation: { gainDb: [{ time: 0, value: curveDb }] },
			},
		},
	};
}

function curveOf(saved: TProject | null | undefined): number | undefined {
	return saved?.audioMix?.master.automation?.gainDb?.[0]?.value;
}

function savedRecords(): TProject[] {
	return storage.saveProject.mock.calls.map(
		(call) => (call[0] as { project: TProject }).project
	);
}

/** The list was loaded when the curve was -60; the editor has -24 since. */
function openWithNewerCurve(): TProject {
	const listed = project({ id: "v17", curveDb: -60 });
	const open = {
		...listed,
		audioMix: project({ id: "v17", curveDb: -24 }).audioMix,
	};
	useProjectStore.setState({
		savedProjects: [listed],
		activeProject: open,
		loadedProjectId: open.id,
	});
	storage.loadProject.mockResolvedValue(listed);
	return open;
}

describe("project record changes start from the latest record (N19)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		storage.saveProject.mockResolvedValue(undefined);
		storage.loadAllProjects.mockImplementation(async () =>
			savedRecords().slice(-1)
		);
		storage.loadAllProjectFolders.mockResolvedValue([]);
		duplicate.copyProjectContents.mockResolvedValue(undefined);
		duplicate.duplicateProjectName.mockReturnValue("v17（副本）");
		useProjectStore.setState({
			activeProject: null,
			loadedProjectId: null,
			savedProjects: [],
			projectFolders: [],
			isLoading: false,
			isInitialized: true,
		});
	});

	it("renames the open project as the editor holds it", async () => {
		openWithNewerCurve();

		await useProjectStore.getState().renameProject("v17", "定版 v17");

		expect(savedRecords()).toHaveLength(1);
		expect(savedRecords()[0]).toMatchObject({ id: "v17", name: "定版 v17" });
		expect(curveOf(savedRecords()[0])).toBe(-24);
		const active = useProjectStore.getState().activeProject;
		expect(active?.name).toBe("定版 v17");
		expect(curveOf(active)).toBe(-24);
	});

	it("renames a closed project as it is stored", async () => {
		const other = project({ id: "other", curveDb: 0 });
		useProjectStore.setState({
			savedProjects: [project({ id: "v16b", curveDb: -60 }), other],
			activeProject: other,
			loadedProjectId: other.id,
		});
		storage.loadProject.mockResolvedValue(
			project({ id: "v16b", curveDb: -24 })
		);

		await useProjectStore.getState().renameProject("v16b", "定版 v16b");

		expect(storage.loadProject).toHaveBeenCalledWith({ id: "v16b" });
		expect(savedRecords()[0]).toMatchObject({ id: "v16b", name: "定版 v16b" });
		expect(curveOf(savedRecords()[0])).toBe(-24);
		expect(useProjectStore.getState().activeProject).toBe(other);
	});

	it("moves the open project to a folder as the editor holds it", async () => {
		openWithNewerCurve();

		const moved = await useProjectStore
			.getState()
			.moveProjectToFolder("v17", "folder-1");

		expect(moved).toBe(true);
		expect(savedRecords()[0]).toMatchObject({
			id: "v17",
			folderId: "folder-1",
		});
		expect(curveOf(savedRecords()[0])).toBe(-24);
		const active = useProjectStore.getState().activeProject;
		expect(active?.folderId).toBe("folder-1");
		expect(curveOf(active)).toBe(-24);
		expect(useProjectStore.getState().savedProjects[0]?.folderId).toBe(
			"folder-1"
		);
	});

	it("puts the open project back when its rename cannot be saved", async () => {
		const open = openWithNewerCurve();
		storage.saveProject.mockRejectedValueOnce(new Error("disk full"));

		await useProjectStore.getState().renameProject("v17", "定版 v17");

		expect(useProjectStore.getState().activeProject).toBe(open);
	});

	it("moves a closed project the list shows in the wrong folder", async () => {
		const other = project({ id: "other", curveDb: 0 });
		useProjectStore.setState({
			savedProjects: [project({ id: "v16b", curveDb: -24 }), other],
			activeProject: other,
			loadedProjectId: other.id,
		});
		storage.loadProject.mockResolvedValue({
			...project({ id: "v16b", curveDb: -24 }),
			folderId: "folder-1",
		});

		const moved = await useProjectStore
			.getState()
			.moveProjectToFolder("v16b", null);

		expect(moved).toBe(true);
		expect(savedRecords()).toEqual([
			expect.objectContaining({ id: "v16b", folderId: null }),
		]);
	});

	it("leaves a record that already holds the change as it is", async () => {
		openWithNewerCurve();

		expect(
			await useProjectStore.getState().moveProjectToFolder("v17", null)
		).toBe(true);
		expect(storage.saveProject).not.toHaveBeenCalled();
	});

	it("duplicates the open project as the editor holds it", async () => {
		const open = openWithNewerCurve();

		const copyId = await useProjectStore.getState().duplicateProject("v17");

		expect(storage.loadProject).not.toHaveBeenCalled();
		expect(duplicate.copyProjectContents).toHaveBeenCalledWith(
			expect.objectContaining({ source: open, targetProjectId: copyId })
		);
		const copy = savedRecords().find((saved) => saved.id === copyId);
		expect(copy?.name).toBe("v17（副本）");
		expect(curveOf(copy)).toBe(-24);
	});
});
