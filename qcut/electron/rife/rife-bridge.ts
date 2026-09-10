import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import manifest from "./rife-binaries.json";

const execFileAsync = promisify(execFile);

/**
 * Locates and runs the pinned rife-ncnn-vulkan build.
 *
 * Binaries come from electron/rife/rife-binaries.json via
 * scripts/stage-rife-binaries.ts: in development they sit under
 * electron/resources/rife/<platform>/, in a packaged app under
 * <resourcesPath>/rife/<platform>/. Nothing here downloads or compiles
 * anything, and a missing host is reported, never substituted.
 */

export const RIFE_MODEL = manifest.model;
export const RIFE_RELEASE = manifest.release;
export const RIFE_EXECUTABLE = `${manifest.executableName}${
	process.platform === "win32" ? ".exe" : ""
}`;

export interface RifeHost {
	executable: string;
	modelDir: string;
}

async function executable({ path }: { path: string }): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function candidateRoots(): string[] {
	const resources = (process as NodeJS.Process & { resourcesPath?: string })
		.resourcesPath;
	const roots = resources ? [join(resources, "rife")] : [];
	for (const directory of [
		process.cwd(),
		resolve(__dirname, "../.."),
		resolve(__dirname, "../../.."),
	]) {
		const staged = join(directory, "electron", "resources", "rife");
		if (existsSync(staged)) roots.push(staged);
	}
	return roots;
}

let pending: Promise<RifeHost> | undefined;

async function resolveHost(): Promise<RifeHost> {
	if (!(process.platform in manifest.targets)) {
		throw new Error(`神经补帧没有 ${process.platform} 平台的 RIFE 程序。`);
	}
	for (const root of candidateRoots()) {
		const platformDir = join(root, process.platform);
		const candidate = join(platformDir, RIFE_EXECUTABLE);
		const modelDir = join(platformDir, RIFE_MODEL);
		if (
			(await executable({ path: candidate })) &&
			existsSync(join(modelDir, "flownet.bin")) &&
			existsSync(join(modelDir, "flownet.param"))
		) {
			return { executable: candidate, modelDir };
		}
	}
	throw new Error(
		`未安装 RIFE ${RIFE_RELEASE} 补帧程序（${RIFE_EXECUTABLE} + ${RIFE_MODEL}）。请运行 bun scripts/stage-rife-binaries.ts 或重新构建 QCut。`
	);
}

export function resolveRifeHost(): Promise<RifeHost> {
	pending ??= resolveHost().catch((error) => {
		pending = undefined;
		throw error;
	});
	return pending;
}

const FRAME_PATTERN = /^\d{8}\.png$/;

/**
 * Interpolates an ordered PNG frame directory to `targetFrameCount` frames
 * written as `%08d.png` into `outputDir`. `gpu` -1 forces the CPU path; the
 * default lets ncnn pick the first Vulkan device.
 */
export async function interpolateFrameDirectory({
	inputDir,
	outputDir,
	targetFrameCount,
	gpu,
	signal,
}: {
	inputDir: string;
	outputDir: string;
	targetFrameCount: number;
	gpu?: number;
	signal?: AbortSignal;
}): Promise<{ outputFrames: number }> {
	if (!Number.isInteger(targetFrameCount) || targetFrameCount < 2) {
		throw new RangeError("targetFrameCount must be an integer of at least 2");
	}
	const inputFrames = (await readdir(inputDir)).filter((name) =>
		FRAME_PATTERN.test(name)
	).length;
	if (inputFrames < 2) {
		throw new Error(
			`RIFE needs at least two input frames, found ${inputFrames}`
		);
	}
	const host = await resolveRifeHost();
	const args = [
		"-i",
		inputDir,
		"-o",
		outputDir,
		"-m",
		host.modelDir,
		"-n",
		String(targetFrameCount),
		"-f",
		"%08d.png",
		...(gpu === undefined ? [] : ["-g", String(gpu)]),
	];
	try {
		await execFileAsync(host.executable, args, {
			windowsHide: true,
			maxBuffer: 16 * 1024 * 1024,
			signal,
		});
	} catch (error) {
		const detail =
			error instanceof Error && "stderr" in error
				? String((error as { stderr?: unknown }).stderr ?? "").trim()
				: "";
		throw new Error(
			`RIFE 补帧失败${detail ? `：${detail.split("\n").at(-1)}` : ""}`,
			{ cause: error }
		);
	}
	const outputFrames = (await readdir(outputDir)).filter((name) =>
		FRAME_PATTERN.test(name)
	).length;
	if (outputFrames !== targetFrameCount) {
		throw new Error(
			`RIFE wrote ${outputFrames} frames, expected ${targetFrameCount}`
		);
	}
	return { outputFrames };
}
