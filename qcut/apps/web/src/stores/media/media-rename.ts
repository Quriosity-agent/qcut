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
import { openProjectPlaysMedia } from "./media-in-use";
import {
	forgetUnsettledRename,
	noteUnsettledRename,
	readUnsettledRenames,
	type UnsettledRename,
	whereNotedFileIs,
} from "./media-rename-notes";
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
	/**
	 * The name and path the file had before. With them a rename that ends
	 * unsettled can be put right the next time the project is open.
	 */
	previous?: { name: string; localPath: string };
	/**
	 * Settles a rename by where the file is, whatever the editor had made
	 * of it: the file has this name for good, so nothing waits on a
	 * deadline; the open scene is saved even when its clips needed no
	 * change, since it may be stored with the other id; and an item still
	 * held under the id being left is dropped when the one it would become
	 * is held too.
	 */
	settles?: boolean;
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

/** A note nothing in the folder speaks to any more is dropped after a day. */
const NOTE_KEPT_MS = 24 * 60 * 60 * 1000;

/**
 * How long a note is left alone that the desktop app has not marked as
 * decided: it may still be moving the file, and is done well within this,
 * whatever becomes of the rename.
 */
const NOTE_UNDECIDED_MS = 5 * 60 * 1000;

/** The rename failed, and not all it had changed could be taken back. */
class RenameNotTakenBackError extends Error {
	constructor(message: string, options: { cause: unknown }) {
		super(message, options);
		this.name = "RenameNotTakenBackError";
	}
}

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
 *
 * A rename after which the editor and the folder may not agree is noted, to
 * be settled when the project is next open (media-rename-notes.ts): one
 * that could not take back all it had changed, and one that was asked to
 * settle and could not. A note is not dropped here when a rename succeeds:
 * the asker knows where the file ends, and drops it.
 */
export function renameProjectMedia(
	rename: ProjectMediaRename
): Promise<ProjectMediaRenameResult> {
	return inTurn({
		projectId: rename.projectId,
		run: () => renameAndNote(rename),
	});
}

/** Runs after every rename of the project asked for before it. */
function inTurn<Result>({
	projectId,
	run,
}: {
	projectId: string;
	run: () => Promise<Result>;
}): Promise<Result> {
	const earlier = lastRename.get(projectId) ?? Promise.resolve();
	const running = earlier.then(run);
	// The next one waits for this one, whatever comes of it.
	const settled = running.then(
		() => undefined,
		() => undefined
	);
	lastRename.set(projectId, settled);
	settled.then(() => {
		if (lastRename.get(projectId) === settled) lastRename.delete(projectId);
	});
	return running;
}

/**
 * The two names of a rename as a note keeps them: `old` is the one the file
 * is expected to have when nothing more is known.
 */
function asNote(rename: ProjectMediaRename): UnsettledRename | undefined {
	const held = useMediaStore
		.getState()
		.mediaItems.find((item) => item.id === rename.fromId);
	const before =
		rename.previous ??
		(held?.localPath
			? { name: held.name, localPath: held.localPath }
			: undefined);
	if (!before) return;
	const from = {
		id: rename.fromId,
		name: before.name,
		path: before.localPath,
	};
	const to = { id: rename.toId, name: rename.name, path: rename.localPath };
	// A rename that settles says where the file is: that is the side to keep.
	const [kept, other] = rename.settles ? [to, from] : [from, to];
	return {
		oldId: kept.id,
		oldName: kept.name,
		oldPath: kept.path,
		newId: other.id,
		newName: other.name,
		newPath: other.path,
		notedAt: Date.now(),
	};
}

async function renameAndNote(
	rename: ProjectMediaRename
): Promise<ProjectMediaRenameResult> {
	const note = asNote(rename);
	try {
		return await renameNow(rename);
	} catch (error) {
		if (rename.settles || error instanceof RenameNotTakenBackError) {
			// Without the name the file had there is nothing to settle it by.
			const noted = note
				? noteUnsettledRename({ projectId: rename.projectId, rename: note })
				: Promise.reject(new Error("the name the file had is not known"));
			await noted.catch((noteError: unknown) => {
				debugWarn(
					"[MediaRename] An unsettled rename could not be noted:",
					noteError
				);
			});
		}
		throw error;
	}
}

/**
 * Settles the renames noted for the project by what its folder holds: the
 * editor ends on the id of the name the file has (`whereNotedFileIs`). With
 * a file under neither name, or when the folder cannot be asked, the note
 * is kept for the next time, a day at most.
 *
 * A note the desktop app may still be at work on is left alone: the file
 * may be about to go back, and following it now would end on the name it is
 * leaving. `lookAgainAt` is when the first such note can be settled.
 *
 * Another file can have taken the name the renamed file left, and be a
 * media item of its own by now. With a file under each name, an item under
 * each id and both in use, they are two media, and are not made one: the
 * other file's clips would go to the renamed file. Where only one of the
 * two is in use, the item under the name the file left is what the rename
 * left behind, and the note is settled as any other.
 *
 * Called when a project has finished loading: its timelines are then in the
 * stores as they are stored, so what is put right is saved right.
 */
export async function settleUnsettledMediaRenames({
	projectId,
}: {
	projectId: string;
}): Promise<{ lookAgainAt?: number }> {
	let lookAgainAt: number | undefined;
	for (const note of await readUnsettledRenames(projectId)) {
		const age = Date.now() - note.notedAt;
		if (!note.decided && age >= 0 && age < NOTE_UNDECIDED_MS) {
			const settledBy = note.notedAt + NOTE_UNDECIDED_MS;
			lookAgainAt = Math.min(lookAgainAt ?? settledBy, settledBy);
			continue;
		}
		try {
			const where = await whereNotedFileIs(note);
			if (where === undefined) continue;
			if (where === "nowhere") {
				if (age > NOTE_KEPT_MS) {
					await forgetUnsettledRename({ projectId, rename: note });
				}
				continue;
			}
			const old = { id: note.oldId, name: note.oldName, path: note.oldPath };
			const renamed = {
				id: note.newId,
				name: note.newName,
				path: note.newPath,
			};
			const [to, from] = where.name === "old" ? [old, renamed] : [renamed, old];
			// In turn with the project's renames: the stores are then at rest.
			await inTurn({
				projectId,
				run: async () => {
					if (
						where.otherNameTaken &&
						(await areTwoMediaInUse({
							projectId,
							fromId: from.id,
							toId: to.id,
						}))
					) {
						return;
					}
					await renameNow({
						projectId,
						fromId: from.id,
						toId: to.id,
						name: to.name,
						localPath: to.path,
						previous: { name: from.name, localPath: from.path },
						settles: true,
					});
				},
			});
			await forgetUnsettledRename({ projectId, rename: note });
		} catch (error) {
			debugWarn(
				"[MediaRename] A noted rename could not be settled yet:",
				error
			);
		}
	}
	return lookAgainAt === undefined ? {} : { lookAgainAt };
}

/**
 * Whether the two ids are two media of the open project: each with an item,
 * each in use. A project that is not open is not asked: the rename then
 * refuses it.
 */
async function areTwoMediaInUse({
	projectId,
	fromId,
	toId,
}: MediaIds & { projectId: string }): Promise<boolean> {
	const project = useProjectStore.getState().activeProject;
	if (!project || !projectIsOpen(projectId)) return false;
	const { mediaItems } = useMediaStore.getState();
	for (const mediaId of [fromId, toId]) {
		if (!mediaItems.some((item) => item.id === mediaId)) return false;
		const inUse = await openProjectPlaysMedia({ project, mediaId });
		// That waited on storage, and the stores are read again for the next
		// id: they have to be this project's still.
		if (!projectIsOpen(projectId)) {
			throw new Error(
				`Project ${projectId} was closed while its media were looked at; nothing was changed`
			);
		}
		if (!inUse) return false;
	}
	return true;
}

async function renameNow({
	projectId,
	fromId,
	toId,
	name,
	localPath,
	deadlineAt,
	settles = false,
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
	// Two items would end under one id. With no item to re-key there is no
	// such clash: clips of an id nothing holds are pointed at the item.
	const alreadyHeld =
		previous !== undefined && mediaItems.some((item) => item.id === toId);
	if (alreadyHeld && !settles) {
		throw new Error(
			`The project already has a media item with the id of ${name} (${toId})`
		);
	}

	const undo: Undo[] = [];
	/** Stops the rename once it can no longer be finished as asked. */
	const goOn = () => {
		if (!settles && deadlineAt !== undefined && Date.now() >= deadlineAt) {
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
		if (previous && alreadyHeld) {
			// Settling: the item under the id being left is a copy a rename
			// that did not stand left behind; the project's own is held.
			useMediaStore.setState((state) => ({
				mediaItems: state.mediaItems.filter((item) => item.id !== fromId),
			}));
			undo.push({
				what: "the item left behind in the media library",
				run: () => {
					if (!projectIsOpen(projectId)) return;
					useMediaStore.setState((state) => ({
						mediaItems: [...state.mediaItems, previous],
					}));
				},
			});
		} else if (previous) {
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
			alwaysSave: settles,
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
		throw new RenameNotTakenBackError(
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
	alwaysSave,
}: MediaIds & {
	scene: SceneRef;
	undo: Undo[];
	/** The scene may be stored with the other id though the store is not. */
	alwaysSave: boolean;
}): Promise<number> {
	const changed = useTimelineStore
		.getState()
		.repointMediaReferences({ fromId, toId });
	// Even with no clip changed: an undo step may hold one, and was repointed.
	undo.push({
		what: "the open scene's timeline",
		run: () => takeSceneBack({ ...scene, fromId, toId }),
	});
	if (changed > 0 || alwaysSave) {
		await saveOpenScene(scene).catch((error: unknown) => {
			throw new Error(
				`The timeline could not be saved with the renamed media: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error }
			);
		});
	}
	return changed;
}

/**
 * Saves the timeline the store holds as this scene's, and as no other's.
 *
 * The tracks are taken here and now, with the scene known to be the open
 * one, and saved under its own project and scene. The store's own
 * `saveImmediate` waits a moment and then reads the open project and the
 * tracks: with another project opened in that moment it wrote that
 * project's timeline, still empty, into that project's storage.
 */
function saveOpenScene({ projectId, sceneId }: SceneRef): Promise<void> {
	return storageService.saveTimeline({
		projectId,
		tracks: useTimelineStore.getState()._tracks,
		sceneId,
	});
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
		useTimelineStore
			.getState()
			.repointMediaReferences({ fromId: toId, toId: fromId });
		// Saved whatever the store had to change: the rename may have written
		// this scene to storage while another one was open.
		await saveOpenScene({ projectId, sceneId }).catch((error: unknown) => {
			throw new Error(
				`The timeline could not be saved with the old media id: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error }
			);
		});
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
