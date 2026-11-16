import { platform } from "@qcut/platform-core";
import { debugWarn } from "@/lib/debug/debug-config";
import { forgetMediaAlphaInspection } from "@/lib/media/alpha-playback-proxy";
import { storageService } from "@/lib/storage/storage-service";
import type { TProject } from "@/types/project";
import { useProjectStore } from "../project-store";
import { useStickersOverlayStore } from "../stickers-overlay-store";
import { repointMediaReferences } from "../timeline/media-references";
import { useTimelineStore } from "../timeline/timeline-store";
import {
	deleteTrackedMediaItem,
	saveTrackedMediaItem,
} from "./media-persistence-queue";
import { useMediaStore } from "./media-store";
import type { MediaItem } from "./media-store-types";

export interface ProjectMediaRename {
	projectId: string;
	/** The id the item and its clips have now. */
	fromId: string;
	/** The id the renamed file has in the project folder. */
	toId: string;
	name: string;
	localPath: string;
	/**
	 * When the asker stops waiting (epoch milliseconds). Past it the asker
	 * has put the file back under its old name, so nothing may be left
	 * pointing at the new one.
	 */
	deadlineAt?: number;
}

export interface ProjectMediaRenameResult {
	/** The editor held the item and re-keyed it. */
	mediaRenamed: boolean;
	/** Clips now pointing at the new id, over every scene. */
	clipsUpdated: number;
	stickersUpdated: number;
}

/** What puts one finished step back, should a later step fail. */
interface Undo {
	/** What the step had changed, for the report when it cannot be put back. */
	what: string;
	run: () => Promise<void> | void;
}

/** A step that cannot be taken back is tried again this often, this far apart. */
const TAKE_BACK_ATTEMPTS = 3;
const TAKE_BACK_RETRY_MS = 150;

/** The last rename asked for each project, done or not. */
const lastRename = new Map<string, Promise<unknown>>();

interface SceneRef {
	projectId: string;
	sceneId: string;
}

interface MediaIds {
	fromId: string;
	toId: string;
}

/** The editor's stores hold this project: it is open and has finished loading. */
function projectIsOpen(projectId: string): boolean {
	const { activeProject, loadedProjectId } = useProjectStore.getState();
	return loadedProjectId === projectId && activeProject?.id === projectId;
}

/** The timeline store holds this scene of this project. */
function sceneIsOpen({ projectId, sceneId }: SceneRef): boolean {
	return (
		projectIsOpen(projectId) &&
		useProjectStore.getState().activeProject?.currentSceneId === sceneId
	);
}

/**
 * Follows a media file that was renamed in the project folder.
 *
 * A media id follows its file name, so the renamed file is a new id to the
 * project folder. The editor's item is stored again under that id with the
 * new name and path, every clip that played the old id is pointed at the new
 * one (in the open scene and in the stored ones), and so are the stickers.
 * Left undone, the clips kept an id nothing answered to: the preview still
 * played them from the editor's own copy, and the native export left them
 * out.
 *
 * It is all or nothing. The asker puts the file back under its old name when
 * this fails, so a failure part-way (a scene that cannot be saved, the
 * asker's deadline passing while a large file is copied, the project being
 * closed or another project or scene opened meanwhile) takes back every step
 * already made, in reverse: the project is then as it was, pointing at the
 * old id, which the file has again. Only removing the old stored entry, the
 * last step, is allowed to fail: the rename stands and a stale entry is left.
 *
 * The stores hold whichever project and scene are open. A media id is made
 * from a file name, so another project can have an item and clips of the
 * same ids: nothing in a store is touched, going forward or taking back,
 * unless it holds this project (and, for the timeline, the scene meant).
 * What is no longer in a store is taken back where it was saved.
 *
 * Taking back points at the old id whatever names the new one, so a clip
 * that named the new id before the rename (its file missing) goes to the old
 * id with the rest. A step that cannot be taken back is tried again; if it
 * still cannot, the failure says so and names it, since the project is then
 * not as it was.
 *
 * One rename at a time for a project: each reads, changes and saves the same
 * stored scenes, and two at once would save over each other's work.
 */
export function renameProjectMedia(
	rename: ProjectMediaRename
): Promise<ProjectMediaRenameResult> {
	const { projectId } = rename;
	const earlier = lastRename.get(projectId) ?? Promise.resolve();
	const run = earlier.then(() => renameNow(rename));
	// The next one waits for this one, whatever comes of it.
	const settled = run.then(
		() => undefined,
		() => undefined
	);
	lastRename.set(projectId, settled);
	settled.then(() => {
		if (lastRename.get(projectId) === settled) lastRename.delete(projectId);
	});
	return run;
}

async function renameNow({
	projectId,
	fromId,
	toId,
	name,
	localPath,
	deadlineAt,
}: ProjectMediaRename): Promise<ProjectMediaRenameResult> {
	if (fromId === toId) {
		return { mediaRenamed: false, clipsUpdated: 0, stickersUpdated: 0 };
	}
	const project = useProjectStore.getState().activeProject;
	if (!project || !projectIsOpen(projectId)) {
		throw new Error(
			`Project ${projectId} is not open in the editor, or is still being opened; nothing was changed`
		);
	}
	const openScene: SceneRef = { projectId, sceneId: project.currentSceneId };
	const { mediaItems } = useMediaStore.getState();
	const previous = mediaItems.find((item) => item.id === fromId);
	if (mediaItems.some((item) => item.id === toId)) {
		throw new Error(
			`The project already has a media item with the id of ${name} (${toId})`
		);
	}

	const undo: Undo[] = [];
	/** Stops the rename once it can no longer be finished as asked. */
	const goOn = () => {
		if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
			throw new Error(
				"The rename took longer than the request waits for; nothing was changed"
			);
		}
		if (!sceneIsOpen(openScene)) {
			throw new Error(
				"The project was closed, or another project or scene opened, while its media was being renamed; nothing was changed"
			);
		}
	};

	try {
		// The wait may be over already: this rename stood behind another.
		goOn();
		if (previous) {
			const renamed: MediaItem = {
				...previous,
				id: toId,
				name,
				localPath,
				isLocalFile: true,
				file: new File([previous.file], name, {
					type: previous.file.type,
					lastModified: previous.file.lastModified,
				}),
			};
			// Copying a large file into the store is the slow step.
			await saveTrackedMediaItem({
				projectId,
				id: toId,
				save: () => storageService.saveMediaItem(projectId, renamed),
				whenDeleting: "wait",
			});
			undo.push({
				what: "the copy stored under the new id",
				run: () =>
					deleteTrackedMediaItem({
						projectId,
						id: toId,
						remove: () => storageService.deleteMediaItem(projectId, toId),
					}),
			});
			goOn();
			useMediaStore.setState((state) => ({
				mediaItems: state.mediaItems.map((item) =>
					item.id === fromId ? renamed : item
				),
			}));
			undo.push({
				what: "the item in the media library",
				run: () => {
					// Another project's items are in the store by then, or none.
					if (!projectIsOpen(projectId)) return;
					useMediaStore.setState((state) => ({
						mediaItems: state.mediaItems.map((item) =>
							item.id === toId ? previous : item
						),
					}));
				},
			});
			// The verdict on a path is kept per path; a file renamed onto a
			// path another file had must be looked at again.
			forgetMediaAlphaInspection({ localPath });
			if (previous.localPath) {
				forgetMediaAlphaInspection({ localPath: previous.localPath });
			}
		}

		goOn();
		let clipsUpdated = await repointOpenScene({
			scene: openScene,
			fromId,
			toId,
			undo,
		});
		clipsUpdated += await repointStoredScenes({ project, fromId, toId, undo });
		goOn();
		const stickersUpdated = await repointStickers({
			projectId,
			fromId,
			toId,
			undo,
		});
		// The last moment the asker may have given up, or the project have
		// been left: after this the rename stands, and the answer goes out
		// at once. The asker puts the file back when the answer is late, and
		// by then nothing here would be taken back: what is left tidies up
		// and is not waited for.
		goOn();
		tidyUpAfterRename({
			projectId,
			fromId,
			removeOldEntry: previous !== undefined,
		});
		return {
			mediaRenamed: previous !== undefined,
			clipsUpdated,
			stickersUpdated,
		};
	} catch (error) {
		const notTakenBack = await takeBack(undo);
		if (notTakenBack.length === 0) throw error;
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`${reason}. Not everything could be taken back in the editor, which may still name ${toId}: ${notTakenBack.join("; ")}`,
			{ cause: error }
		);
	}
}

/**
 * Takes the finished steps back, the last one first. A step that fails is
 * tried again (a save that could not be written a moment ago); the ones
 * that still fail are returned, each with what it had changed.
 */
async function takeBack(undo: Undo[]): Promise<string[]> {
	const failed: string[] = [];
	for (const step of [...undo].reverse()) {
		for (let attempt = 1; attempt <= TAKE_BACK_ATTEMPTS; attempt += 1) {
			try {
				await step.run();
				break;
			} catch (error) {
				if (attempt < TAKE_BACK_ATTEMPTS) {
					await new Promise((resolve) =>
						setTimeout(resolve, TAKE_BACK_RETRY_MS)
					);
					continue;
				}
				debugWarn(`[MediaRename] Could not take back ${step.what}:`, error);
				failed.push(
					`${step.what} (${error instanceof Error ? error.message : String(error)})`
				);
			}
		}
	}
	return failed;
}

/**
 * What a rename that stands leaves to do: the item's old stored entry goes,
 * and the project is marked as changed. Neither can fail the rename; an
 * entry that cannot be removed is left behind, stale.
 */
function tidyUpAfterRename({
	projectId,
	fromId,
	removeOldEntry,
}: {
	projectId: string;
	fromId: string;
	removeOldEntry: boolean;
}): void {
	const removed = removeOldEntry
		? deleteTrackedMediaItem({
				projectId,
				id: fromId,
				remove: () => storageService.deleteMediaItem(projectId, fromId),
			}).catch((error: unknown) => {
				debugWarn(
					"[MediaRename] The renamed item's old entry could not be removed:",
					error
				);
			})
		: Promise.resolve();
	removed
		.then(() => useProjectStore.getState().markProjectContentChanged(projectId))
		.catch(() => undefined);
}

/**
 * The open scene: its clips, and the undo and redo steps, are repointed in
 * the store, and the timeline is saved at once.
 */
async function repointOpenScene({
	scene,
	fromId,
	toId,
	undo,
}: MediaIds & { scene: SceneRef; undo: Undo[] }): Promise<number> {
	const timeline = useTimelineStore.getState();
	const changed = timeline.repointMediaReferences({ fromId, toId });
	// Even with no clip changed: an undo step may hold one, and was repointed.
	undo.push({
		what: "the open scene's timeline",
		run: () => takeSceneBack({ ...scene, fromId, toId }),
	});
	if (changed > 0 && !(await timeline.saveImmediate())) {
		throw new Error("The timeline could not be saved with the renamed media");
	}
	return changed;
}

/** The scenes that are not open keep their timelines in storage only. */
async function repointStoredScenes({
	project,
	fromId,
	toId,
	undo,
}: MediaIds & { project: TProject; undo: Undo[] }): Promise<number> {
	const projectId = project.id;
	let changed = 0;
	for (const scene of project.scenes ?? []) {
		if (scene.id === project.currentSceneId) continue;
		const tracks = await storageService.loadTimeline({
			projectId,
			sceneId: scene.id,
		});
		if (!tracks) continue;
		const repointed = repointMediaReferences({ tracks, fromId, toId });
		if (repointed.changed === 0) continue;
		// Before the save: one that fails may have been written all the same.
		undo.push({
			what: `the timeline of scene ${scene.id}`,
			run: () => takeSceneBack({ projectId, sceneId: scene.id, fromId, toId }),
		});
		await storageService.saveTimeline({
			projectId,
			tracks: repointed.tracks,
			sceneId: scene.id,
		});
		changed += repointed.changed;
	}
	return changed;
}

/**
 * Points one scene's clips at the old id again, where that scene is by now:
 * in the timeline store when it is the open one, in storage otherwise.
 */
async function takeSceneBack({
	projectId,
	sceneId,
	fromId,
	toId,
}: SceneRef & MediaIds): Promise<void> {
	if (sceneIsOpen({ projectId, sceneId })) {
		const timeline = useTimelineStore.getState();
		timeline.repointMediaReferences({ fromId: toId, toId: fromId });
		// Saved whatever the store had to change: the rename may have written
		// this scene to storage while another one was open.
		if (!(await timeline.saveImmediate())) {
			throw new Error("The timeline could not be saved with the old media id");
		}
		return;
	}
	const tracks = await storageService.loadTimeline({ projectId, sceneId });
	if (!tracks) return;
	const back = repointMediaReferences({ tracks, fromId: toId, toId: fromId });
	if (back.changed === 0) return;
	await storageService.saveTimeline({
		projectId,
		tracks: back.tracks,
		sceneId,
	});
}

/** The stickers that show media `fromId`, pointed at `toId`. */
function repointStickerMedia<Sticker extends { mediaItemId: string }>({
	stickers,
	fromId,
	toId,
}: MediaIds & { stickers: Map<string, Sticker> }): {
	stickers: Map<string, Sticker>;
	changed: number;
} {
	let changed = 0;
	const repointed = new Map(stickers);
	for (const [id, sticker] of stickers) {
		if (sticker.mediaItemId !== fromId) continue;
		repointed.set(id, { ...sticker, mediaItemId: toId });
		changed += 1;
	}
	return { stickers: changed > 0 ? repointed : stickers, changed };
}

/** A sticker whose media is gone is dropped on the next load, so it follows. */
async function repointStickers({
	projectId,
	fromId,
	toId,
	undo,
}: MediaIds & { projectId: string; undo: Undo[] }): Promise<number> {
	const store = useStickersOverlayStore.getState();
	const repointed = repointStickerMedia({
		stickers: store.overlayStickers,
		fromId,
		toId,
	});
	if (repointed.changed === 0) return 0;
	useStickersOverlayStore.setState({ overlayStickers: repointed.stickers });
	undo.push({
		what: "the stickers",
		run: () => takeStickersBack({ projectId, fromId, toId }),
	});
	await store.saveToProject(projectId);
	return repointed.changed;
}

/**
 * Points the project's stickers at the old id again: in the store while the
 * project is open, otherwise where the store saves them (its saveToProject).
 */
async function takeStickersBack({
	projectId,
	fromId,
	toId,
}: MediaIds & { projectId: string }): Promise<void> {
	if (projectIsOpen(projectId)) {
		const store = useStickersOverlayStore.getState();
		const back = repointStickerMedia({
			stickers: store.overlayStickers,
			fromId: toId,
			toId: fromId,
		});
		if (back.changed > 0) {
			useStickersOverlayStore.setState({ overlayStickers: back.stickers });
		}
		await store.saveToProject(projectId);
		return;
	}
	const key = `overlay-stickers-${projectId}`;
	const stored = await platform().storage.load(key);
	if (!Array.isArray(stored)) return;
	let changed = false;
	const back = stored.map((sticker: unknown) => {
		if (
			typeof sticker !== "object" ||
			sticker === null ||
			(sticker as { mediaItemId?: unknown }).mediaItemId !== toId
		) {
			return sticker;
		}
		changed = true;
		return { ...sticker, mediaItemId: fromId };
	});
	if (changed) await platform().storage.save(key, back);
}
