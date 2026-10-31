/**
 * Serialises a media item's whole-blob saves against its delete.
 *
 * A save rewrites the item's OPFS entry and a delete removes it, and the
 * background thumbnail/duration pass re-saves an item several hundred
 * milliseconds after the import with nobody awaiting it. A delete landing in
 * that window either loses its removal to the write that holds the entry
 * open, or the write re-creates the entry (`getFileHandle` with
 * `create: true`) right after the removal succeeded. Either way the bytes
 * survive, the renderer reports the delete as failed, and the HTTP route
 * gives up before it reaches the project folder — so a refused
 * `replace-media` left the file it had just imported in the media library,
 * twice in six attempts (N30).
 *
 * @module stores/media/media-persistence-queue
 */

/** Every save still running for a key: a delete has to outlast all of them. */
const pendingSaves = new Map<string, Set<Promise<unknown>>>();
/** The tail of a key's delete chain, so deletes for one item run in order. */
const deleteChain = new Map<string, Promise<unknown>>();
/** How many deletes for a key are still running. */
const activeDeletes = new Map<string, number>();

function keyFor({ projectId, id }: { projectId: string; id: string }): string {
	return `${projectId}:${id}`;
}

function trackSave(key: string, save: Promise<unknown>): () => void {
	let running = pendingSaves.get(key);
	if (!running) {
		running = new Set();
		pendingSaves.set(key, running);
	}
	running.add(save);
	return () => {
		running?.delete(save);
		if (running?.size === 0) pendingSaves.delete(key);
	};
}

/**
 * Wait for every save of this key, not just the newest. Two overlapping
 * saves used to mean the delete waited for the second while the first was
 * still writing, and that write then re-created the entry.
 */
async function drainSaves(key: string): Promise<void> {
	// Nothing new can enter while the delete is marked active, so this ends.
	let running = pendingSaves.get(key);
	while (running && running.size > 0) {
		await Promise.allSettled([...running]);
		running = pendingSaves.get(key);
	}
}

/**
 * Run a media item's save.
 *
 * `whenDeleting` says what to do if a delete for the same item is under way.
 * A background pass re-saving an item that is going away should be dropped
 * (`"skip"`, the default). A fresh write — a new import reusing the same id,
 * which happens because an id is derived from the file name — must instead
 * wait for the delete and then store the new item (`"wait"`), or it would
 * live only in memory.
 *
 * Returns whether the save ran.
 */
export async function saveTrackedMediaItem({
	projectId,
	id,
	save,
	whenDeleting = "skip",
}: {
	projectId: string;
	id: string;
	save: () => Promise<unknown>;
	whenDeleting?: "skip" | "wait";
}): Promise<boolean> {
	const key = keyFor({ projectId, id });
	while ((activeDeletes.get(key) ?? 0) > 0) {
		if (whenDeleting === "skip") return false;
		await deleteChain.get(key)?.catch(() => undefined);
	}

	const started = save();
	const release = trackSave(key, started);
	try {
		await started;
		return true;
	} finally {
		release();
	}
}

/**
 * Delete a media item with every in-flight save for it drained first, and
 * further saves for it suppressed until the delete settles.
 */
export async function deleteTrackedMediaItem({
	projectId,
	id,
	remove,
}: {
	projectId: string;
	id: string;
	remove: () => Promise<unknown>;
}): Promise<void> {
	const key = keyFor({ projectId, id });
	activeDeletes.set(key, (activeDeletes.get(key) ?? 0) + 1);

	// Deletes for one key run one at a time: an earlier one finishing must not
	// clear the way for a save while a later one is still removing.
	const earlier = deleteChain.get(key);
	const run = (async () => {
		await earlier?.catch(() => undefined);
		// A save already writing holds the entry open; whether it succeeded is
		// the saver's business, not the delete's.
		await drainSaves(key);
		await remove();
	})();
	deleteChain.set(
		key,
		run.catch(() => undefined)
	);

	try {
		await run;
	} finally {
		const left = (activeDeletes.get(key) ?? 1) - 1;
		if (left > 0) {
			activeDeletes.set(key, left);
		} else {
			// No delete for this key is left, so its chain is finished too.
			activeDeletes.delete(key);
			deleteChain.delete(key);
		}
	}
}

/** Test seam: drop all tracked state between cases. */
export function resetMediaPersistenceQueue(): void {
	pendingSaves.clear();
	deleteChain.clear();
	activeDeletes.clear();
}
