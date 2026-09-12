import { execFile } from "node:child_process";
import {
	link,
	lstat,
	mkdir,
	mkdtemp,
	realpath,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getFFmpegPath, getFFprobePath } from "./paths.js";
import {
	buildLocalDeflickerArgs,
	parseLocalDeflickerMetadata,
	verifyLocalDeflickerOutput,
} from "./deflicker-video-contract.js";

const execFileAsync = promisify(execFile);
const PROCESS_TIMEOUT_MS = 30 * 60 * 1000;

async function inspectVideo({
	sourcePath,
	ffprobePath,
	signal,
}: {
	sourcePath: string;
	ffprobePath: string;
	signal?: AbortSignal;
}) {
	const { stdout } = await execFileAsync(
		ffprobePath,
		[
			"-v",
			"error",
			"-count_frames",
			"-show_streams",
			"-of",
			"json",
			sourcePath,
		],
		{
			signal,
			timeout: PROCESS_TIMEOUT_MS,
			maxBuffer: 4 * 1024 * 1024,
			encoding: "utf8",
			windowsHide: true,
		}
	);
	return parseLocalDeflickerMetadata({ json: stdout });
}

async function inspectDestination({
	sourcePath,
	outputPath,
	force,
}: {
	sourcePath: string;
	outputPath: string;
	force: boolean;
}) {
	if (sourcePath === outputPath)
		throw new Error("Output must not overwrite the source video");
	if (path.extname(outputPath).toLowerCase() !== ".mp4")
		throw new Error("Output must use the .mp4 extension");
	try {
		const destination = await lstat(outputPath);
		if (!force) throw new Error(`Output already exists: ${outputPath}`);
		if (!destination.isFile() && !destination.isSymbolicLink())
			throw new Error("Output must be a file");
		if ((await realpath(outputPath)) === (await realpath(sourcePath))) {
			throw new Error("Output must not overwrite the source video");
		}
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}
}

export async function deflickerLocalVideo({
	sourcePath,
	outputPath,
	strength,
	force = false,
	signal,
	onProgress,
}: {
	sourcePath: string;
	outputPath: string;
	strength: number;
	force?: boolean;
	signal?: AbortSignal;
	onProgress?: (value: {
		progress: number;
		stage: string;
		status: string;
	}) => void;
}) {
	signal?.throwIfAborted();
	const source = path.resolve(sourcePath);
	const destination = path.resolve(outputPath);
	if (!Number.isInteger(strength) || strength < 1 || strength > 100)
		throw new Error("--strength must be an integer from 1 to 100");
	const sourceStat = await stat(source);
	if (!sourceStat.isFile() || sourceStat.size === 0)
		throw new Error("Input must be a nonempty local video file");
	await inspectDestination({
		sourcePath: source,
		outputPath: destination,
		force,
	});
	const ffmpegPath = getFFmpegPath();
	const ffprobePath = await getFFprobePath();
	onProgress?.({
		progress: 5,
		stage: "inspect",
		status: "Inspecting local video",
	});
	const metadata = await inspectVideo({
		sourcePath: source,
		ffprobePath,
		signal,
	});
	await mkdir(path.dirname(destination), { recursive: true });
	const temporaryDirectory = await mkdtemp(
		path.join(path.dirname(destination), ".qcut-deflicker-")
	);
	const temporaryPath = path.join(temporaryDirectory, "result.mp4");
	try {
		onProgress?.({
			progress: 10,
			stage: "process",
			status: "Reducing brightness flicker with local FFmpeg",
		});
		await execFileAsync(
			ffmpegPath,
			buildLocalDeflickerArgs({
				sourcePath: source,
				outputPath: temporaryPath,
				strength,
				metadata,
			}),
			{
				signal,
				timeout: PROCESS_TIMEOUT_MS,
				maxBuffer: 4 * 1024 * 1024,
				windowsHide: true,
			}
		);
		onProgress?.({
			progress: 90,
			stage: "verify",
			status: "Verifying video frames, timing and audio",
		});
		const output = await inspectVideo({
			sourcePath: temporaryPath,
			ffprobePath,
			signal,
		});
		verifyLocalDeflickerOutput({ source: metadata, output });
		signal?.throwIfAborted();
		if (force) {
			await rename(temporaryPath, destination);
		} else {
			// Same-filesystem link publishes a complete file and rejects a raced destination.
			await link(temporaryPath, destination);
		}
		onProgress?.({
			progress: 100,
			stage: "complete",
			status: "Local deflicker complete",
		});
		return {
			...output,
			outputPath: destination,
			strength,
			hasAudio: output.audioStreams > 0,
			provider: "ffmpeg",
			route: "qcut-ffmpeg-deflicker-v1",
			cacheHit: false,
		};
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}
