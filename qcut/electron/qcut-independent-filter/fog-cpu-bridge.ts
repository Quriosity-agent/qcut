import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const FOG_CPU_HOST = "qcut-independent-fog-cpu";
const FOG_SOURCE = "research/independent-fog-contract";
const SHARED_SOURCE = "research/independent-soft-glow";
const FOG_UNITS = ["blur", "composite", "pipeline", "main"];
const SHARED_UNITS = ["image", "image_io", "lut"];
let pending: Promise<string> | undefined;

export async function compileFogCpuHost({
	projectRoot,
	outputPath,
}: {
	projectRoot: string;
	outputPath: string;
}) {
	await mkdir(dirname(outputPath), { recursive: true });
	const temporary = await mkdtemp(join(dirname(outputPath), ".fog-cpu-build-"));
	try {
		const binary = join(temporary, FOG_CPU_HOST);
		await execFileAsync(
			"xcrun",
			[
				"clang++",
				"-std=c++20",
				"-O2",
				"-Wall",
				"-Wextra",
				"-Wpedantic",
				"-Werror",
				"-ffp-contract=off",
				"-fno-fast-math",
				"-I",
				join(projectRoot, SHARED_SOURCE),
				...FOG_UNITS.map((name) =>
					join(projectRoot, FOG_SOURCE, `${name}.cpp`)
				),
				...SHARED_UNITS.map((name) =>
					join(projectRoot, SHARED_SOURCE, `${name}.cpp`)
				),
				"-o",
				binary,
			],
			{ timeout: 120_000, maxBuffer: 1024 * 1024 }
		);
		await rename(binary, outputPath);
		return outputPath;
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

async function executable({ path }: { path: string }) {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

async function resolveHost() {
	if (process.platform !== "darwin")
		throw new Error("滤镜对照目前需要 macOS 的 QCut Metal 渲染器。");
	const resources = (process as NodeJS.Process & { resourcesPath?: string })
		.resourcesPath;
	if (resources) {
		const bundled = join(resources, "bin", FOG_CPU_HOST);
		if (await executable({ path: bundled })) return bundled;
	}
	const root = [
		process.cwd(),
		resolve(__dirname, "../.."),
		resolve(__dirname, "../../.."),
	].find((directory) => existsSync(join(directory, FOG_SOURCE, "main.cpp")));
	if (!root) throw new Error("未安装迷雾 C++ 对照程序，请重新构建 QCut。");
	const files = [
		...FOG_UNITS.map((name) => `${FOG_SOURCE}/${name}.cpp`),
		...["blur", "composite", "pipeline"].map(
			(name) => `${FOG_SOURCE}/${name}.hpp`
		),
		...SHARED_UNITS.flatMap((name) => [
			`${SHARED_SOURCE}/${name}.cpp`,
			`${SHARED_SOURCE}/${name}.hpp`,
		]),
	];
	const hash = createHash("sha256").update(
		`fog-reference-v1-${process.arch}-c++20-O2-no-fast-math`
	);
	for (const source of await Promise.all(
		files.map((name) => readFile(join(root, name)))
	))
		hash.update(source);
	const outputPath = join(
		homedir(),
		"Library/Caches/QCut/independent-fog-cpu",
		hash.digest("hex"),
		FOG_CPU_HOST
	);
	if (await executable({ path: outputPath })) return outputPath;
	return compileFogCpuHost({ projectRoot: root, outputPath });
}

export function resolveFogCpuHost() {
	pending ??= resolveHost().catch((error) => {
		pending = undefined;
		throw error;
	});
	return pending;
}
