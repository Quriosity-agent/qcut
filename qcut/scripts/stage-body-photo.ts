import {
	existsSync,
	lstatSync,
	mkdtempSync,
	mkdirSync,
	renameSync,
	rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	stageBodyPhotoSources,
	verifyOwnedBodyPhotoBuildSources,
	verifyStagedBodyPhotoSources,
} from "../electron/body-photo/body-photo-sources";

export function stageBodyPhotoBuild({
	sourceRoot,
	sharedEngineRoot,
	destinationRoot,
}: {
	sourceRoot: string;
	sharedEngineRoot: string;
	destinationRoot: string;
}) {
	const destination = path.resolve(destinationRoot);
	const exists = existsSync(destination);
	if (exists || lstatPresent({ target: destination })) {
		if (lstatSync(destination).isSymbolicLink())
			throw new Error("Body photo build cannot replace a symlink");
		verifyOwnedBodyPhotoBuildSources({ root: destination });
	}
	mkdirSync(path.dirname(destination), { recursive: true });
	const temporary = mkdtempSync(`${destination}.build-`);
	const fresh = path.join(temporary, "fresh");
	const previous = path.join(temporary, "previous");
	let replaced = false;
	try {
		stageBodyPhotoSources({
			sourceRoot,
			sharedEngineRoot,
			destinationRoot: fresh,
		});
		if (exists) {
			verifyOwnedBodyPhotoBuildSources({ root: destination });
			renameSync(destination, previous);
			replaced = true;
		} else if (lstatPresent({ target: destination })) {
			throw new Error("Body photo build destination appeared during staging");
		}
		try {
			renameSync(fresh, destination);
			return verifyStagedBodyPhotoSources({ root: destination });
		} catch (error) {
			if (existsSync(destination) && !existsSync(fresh))
				renameSync(destination, fresh);
			if (replaced) renameSync(previous, destination);
			throw error;
		}
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

function lstatPresent({ target }: { target: string }): boolean {
	try {
		lstatSync(target);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
	const project = path.resolve(path.dirname(scriptPath), "..");
	const prepared = stageBodyPhotoBuild({
		sourceRoot: path.join(project, "research/body-photo"),
		sharedEngineRoot: path.join(
			project,
			"research/independent-beauty/research"
		),
		destinationRoot: process.argv[2]
			? path.resolve(process.argv[2])
			: path.join(project, "build/body-photo"),
	});
	console.log(JSON.stringify(prepared, null, 2));
}
