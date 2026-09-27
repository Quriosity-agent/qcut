import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const pendingOperations = new Map<string, Promise<void>>();

/**
 * Runs `action` after every operation already queued for `target`.
 *
 * Saves and deletions share this queue, so a deletion can never lose to a save that is still
 * mid-rename: that would recreate a project the caller already removed.
 */
function enqueue(target: string, action: () => Promise<void>): Promise<void> {
	const previous = pendingOperations.get(target);
	const operation = (previous ?? Promise.resolve())
		.catch(() => undefined)
		.then(action);
	pendingOperations.set(target, operation);
	return operation.finally(() => {
		if (pendingOperations.get(target) === operation)
			pendingOperations.delete(target);
	});
}

export async function writeStorageJson({
	filePath,
	data,
}: {
	filePath: string;
	data: unknown;
}): Promise<void> {
	const contents = JSON.stringify(data);
	if (contents === undefined)
		throw new Error("Storage value is not JSON serializable");
	const target = path.resolve(filePath);
	await enqueue(target, async () => {
		const temporary = `${target}.${randomUUID()}.tmp`;
		await fs.mkdir(path.dirname(target), { recursive: true });
		try {
			// A shutdown during autosave must not truncate the last published project.
			await fs.writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
			await fs.rename(temporary, target);
		} finally {
			await fs.rm(temporary, { force: true }).catch(() => undefined);
		}
	});
}

/** Deletes a stored project once the saves queued before it have finished. */
export async function removeStorageJson({
	filePath,
}: {
	filePath: string;
}): Promise<void> {
	const target = path.resolve(filePath);
	await enqueue(target, async () => {
		await fs.rm(target, { force: true });
	});
}
