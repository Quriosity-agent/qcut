import { createHash, randomUUID } from "node:crypto";
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

/**
 * Where the JSON object or array that `text` starts with ends, or -1 when it
 * does not start with one or never closes it.
 */
function endOfLeadingJson({ text }: { text: string }): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
		} else if (char === "{" || char === "[") {
			depth += 1;
		} else if (char === "}" || char === "]") {
			depth -= 1;
			if (depth <= 0) return depth === 0 ? index + 1 : -1;
		} else if (depth === 0) {
			// Only whitespace may come before the opening brace or bracket.
			if (char.trim() !== "") return -1;
		} else if (char === '"') {
			inString = true;
		}
	}
	return -1;
}

export interface StorageJsonRead {
	value: unknown;
	/** Set when the file held a complete JSON value and then stray characters. */
	strayTail?: { characters: number; backupPath: string };
}

/**
 * Reads a stored value; null when the file is missing or empty.
 *
 * A complete JSON value followed by stray characters is read without them.
 * Two overlapping saves left exactly that before saves went through a
 * temporary file (2026-09-27): each truncated the file, and the shorter one
 * wrote over the start of the longer. The file is first copied aside as it
 * was, and is itself left for the next save to replace. Any other damage
 * throws a SyntaxError.
 */
export async function readStorageJson({
	filePath,
}: {
	filePath: string;
}): Promise<StorageJsonRead | null> {
	let bytes: Buffer;
	try {
		bytes = await fs.readFile(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const text = bytes.toString("utf8");
	if (!text.trim()) return null;
	try {
		return { value: JSON.parse(text) };
	} catch (error) {
		const end = endOfLeadingJson({ text });
		if (end < 0 || !text.slice(end).trim()) throw error;
		let value: unknown;
		try {
			value = JSON.parse(text.slice(0, end));
		} catch {
			throw error;
		}
		const digest = createHash("sha256").update(bytes).digest("hex");
		const backupPath = `${filePath}.damaged-${digest.slice(0, 12)}`;
		try {
			await fs.writeFile(backupPath, bytes, { flag: "wx", mode: 0o600 });
		} catch (backupError) {
			if ((backupError as NodeJS.ErrnoException).code !== "EEXIST") {
				throw new SyntaxError(
					`${(error as Error).message}; the JSON before the stray characters was not read because the file could not be copied aside first (${(backupError as Error).message})`
				);
			}
		}
		return {
			value,
			strayTail: { characters: text.length - end, backupPath },
		};
	}
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
