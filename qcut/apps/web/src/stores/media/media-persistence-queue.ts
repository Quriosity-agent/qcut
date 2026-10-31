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
 * Both orderings close once the delete drains an in-flight save and a save
 * for an item already being deleted is skipped.
 *
 * @module stores/media/media-persistence-queue
 */

const pendingSaves = new Map<string, Promise<unknown>>();
const deleting = new Set<string>();

function keyFor({ projectId, id }: { projectId: string; id: string }): string {
	return `${projectId}:${id}`;
}

/**
 * Run a media item's save unless its delete is already under way.
 *
 * Returns whether the save ran, so a caller can tell a stored item from one
 * dropped because it is going away.
 */
export async function saveTrackedMediaItem({
	projectId,
	id,
	save,
}: {
	projectId: string;
	id: string;
	save: () => Promise<unknown>;
}): Promise<boolean> {
	const key = keyFor({ projectId, id });
	if (deleting.has(key)) return false;
	const started = save();
	pendingSaves.set(key, started);
	try {
		await started;
		return true;
	} finally {
		// Only clear our own entry: a later save may have replaced it.
		if (pendingSaves.get(key) === started) {
			pendingSaves.delete(key);
		}
	}
}

/**
 * Delete a media item with any in-flight save for it drained first, and
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
	deleting.add(key);
	try {
		// A save already writing holds the entry open; whether it succeeded is
		// the saver's business, not the delete's.
		await pendingSaves.get(key)?.catch(() => undefined);
		await remove();
	} finally {
		// Cleared, so re-importing the same file can be saved again: a media id
		// is derived from the file name, so it repeats.
		deleting.delete(key);
	}
}

/** Test seam: drop all tracked state between cases. */
export function resetMediaPersistenceQueue(): void {
	pendingSaves.clear();
	deleting.clear();
}
