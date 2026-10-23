import fs from "node:fs/promises";
import path from "node:path";

export interface BodyPhotoRuntime {
	bundleRoot: string;
	runtimeRoot: string;
	python: string;
}

async function regularPath({
	file,
	directory = false,
}: {
	file: string;
	directory?: boolean;
}) {
	const stat = await fs.lstat(file).catch(() => null);
	return Boolean(
		stat &&
			!stat.isSymbolicLink() &&
			(directory ? stat.isDirectory() : stat.isFile())
	);
}

export async function resolveBodyPhotoRuntime({
	selection,
	pythonOverride,
	platform = process.platform,
}: {
	selection: string;
	pythonOverride?: string;
	platform?: NodeJS.Platform;
}): Promise<BodyPhotoRuntime> {
	if (!path.isAbsolute(selection))
		throw new Error("Choose an absolute local body-photo bundle folder");
	if (!(await regularPath({ file: selection, directory: true })))
		throw new Error("Body-photo bundle must be a regular local folder");
	const bundleRoot = await fs.realpath(selection);
	const nested = path.join(bundleRoot, "runtime");
	const runtimeRoot = (await regularPath({ file: nested, directory: true }))
		? nested
		: bundleRoot;
	const directories = await Promise.all(
		["body", "body-portable"].map((name) =>
			regularPath({ file: path.join(runtimeRoot, name), directory: true })
		)
	);
	if (directories.some((valid) => !valid))
		throw new Error(
			"Choose the local V3 bundle containing runtime/body and runtime/body-portable"
		);
	const executable =
		platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"];
	const candidates = pythonOverride
		? [pythonOverride]
		: [
				bundleRoot,
				path.join(bundleRoot, "body"),
				path.dirname(runtimeRoot),
				path.join(path.dirname(runtimeRoot), "body"),
			].map((root) => path.join(root, ".venv", ...executable));
	if (candidates.some((file) => !path.isAbsolute(file)))
		throw new Error("Body-photo Python must be an absolute local executable");
	const usable = await Promise.all(
		candidates.map(async (file) => {
			// uv environments normally link their interpreter; the bundle and model files may not be links.
			const stat = await fs.stat(file).catch(() => null);
			return stat?.isFile() ? file : null;
		})
	);
	const python = usable.find((file): file is string => file !== null);
	if (!python)
		throw new Error(
			"No body-photo Python found; choose a V3 bundle with its installed .venv"
		);
	return { bundleRoot, runtimeRoot, python };
}

export function bodyPhotoEnvironment({
	environment,
	runtimeRoot,
}: {
	environment: NodeJS.ProcessEnv;
	runtimeRoot: string;
}): NodeJS.ProcessEnv {
	const clean = Object.fromEntries(
		Object.entries(environment).filter(
			([name]) => !/^(DYLD_|LD_PRELOAD$|PYTHON|BEAUTY_|QCUT_|BODY_)/i.test(name)
		)
	);
	return {
		...clean,
		PYTHONDONTWRITEBYTECODE: "1",
		PYTHONUNBUFFERED: "1",
		QCUT_BODY_PHOTO_RUNTIME_ROOT: runtimeRoot,
	};
}

export async function readBodyPhotoSelection({
	settingsPath,
}: {
	settingsPath: string;
}): Promise<string | undefined> {
	try {
		const stat = await fs.lstat(settingsPath);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) return;
		const value: unknown = JSON.parse(await fs.readFile(settingsPath, "utf8"));
		if (
			value &&
			typeof value === "object" &&
			"bundleRoot" in value &&
			typeof value.bundleRoot === "string" &&
			path.isAbsolute(value.bundleRoot)
		)
			return value.bundleRoot;
	} catch {
		return;
	}
}

export async function saveBodyPhotoSelection({
	settingsPath,
	bundleRoot,
}: {
	settingsPath: string;
	bundleRoot: string;
}) {
	await fs.mkdir(path.dirname(settingsPath), { recursive: true });
	const temporary = `${settingsPath}.${process.pid}.tmp`;
	try {
		await fs.writeFile(temporary, JSON.stringify({ version: 1, bundleRoot }), {
			encoding: "utf8",
			mode: 0o600,
			flag: "wx",
		});
		await fs.rename(temporary, settingsPath);
	} finally {
		await fs.rm(temporary, { force: true });
	}
}
