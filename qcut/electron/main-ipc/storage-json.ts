import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const pendingWrites = new Map<string, Promise<void>>();

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
	const previous = pendingWrites.get(target);
	const operation = (previous ?? Promise.resolve())
		.catch(() => undefined)
		.then(async () => {
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
	pendingWrites.set(target, operation);
	try {
		await operation;
	} finally {
		if (pendingWrites.get(target) === operation) pendingWrites.delete(target);
	}
}
