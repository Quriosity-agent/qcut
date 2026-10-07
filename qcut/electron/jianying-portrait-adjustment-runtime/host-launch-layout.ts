import { createHash } from "node:crypto";
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Hardened hosts use this sidecar layout without changing their signed bytes.
const executableName = "jianying-portrait-adjustment-host";
const digest = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");

export async function materializePortraitHostLaunch({
	hostPath,
	frameworkDirectory,
	cacheRoot = path.join(
		os.homedir(),
		"Library/Caches/QCut/jianying-portrait-host-launch"
	),
}: {
	hostPath: string;
	frameworkDirectory: string;
	cacheRoot?: string;
}) {
	const source = await lstat(hostPath);
	if (
		!source.isFile() ||
		source.isSymbolicLink() ||
		source.size > 16 * 1024 * 1024
	)
		throw new Error("Portrait host must be a regular executable");
	const frameworks = await realpath(frameworkDirectory);
	if (!(await lstat(frameworks)).isDirectory())
		throw new Error("Portrait Frameworks must be a directory");
	const bytes = await readFile(hostPath);
	const sourceSha256 = digest({ bytes });
	const identity = createHash("sha256")
		.update(sourceSha256)
		.update("\0")
		.update(frameworks)
		.digest("hex");
	const directory = path.join(cacheRoot, identity),
		executable = path.join(directory, executableName),
		link = path.join(directory, "Frameworks");
	async function verify() {
		const [entry, host, frameworkLink] = await Promise.all([
			lstat(directory),
			lstat(executable),
			lstat(link),
		]);
		if (
			!entry.isDirectory() ||
			entry.isSymbolicLink() ||
			!host.isFile() ||
			host.isSymbolicLink() ||
			!(host.mode & 0o111) ||
			!frameworkLink.isSymbolicLink()
		)
			throw new Error("Invalid portrait host launch layout");
		if (
			digest({ bytes: await readFile(executable) }) !== sourceSha256 ||
			(await readlink(link)) !== frameworks
		)
			throw new Error("Portrait host launch layout was modified");
	}
	await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
	const root = await lstat(cacheRoot);
	if (!root.isDirectory() || root.isSymbolicLink())
		throw new Error("Portrait launch cache must be a regular directory");
	try {
		await verify();
		return executable;
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}
	const temporary = await mkdtemp(path.join(cacheRoot, ".launch-"));
	try {
		await Promise.all([
			writeFile(path.join(temporary, executableName), bytes, {
				mode: 0o755,
				flag: "wx",
			}),
			symlink(frameworks, path.join(temporary, "Frameworks"), "dir"),
		]);
		try {
			await rename(temporary, directory);
		} catch (error) {
			if (
				!(
					error instanceof Error &&
					"code" in error &&
					["EEXIST", "ENOTEMPTY"].includes(String(error.code))
				)
			)
				throw error;
		}
		await verify();
		return executable;
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
