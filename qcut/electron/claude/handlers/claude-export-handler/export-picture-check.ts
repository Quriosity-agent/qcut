/**
 * Checks of the exported picture's length against the timeline.
 *
 * An export used to report `completed` without a warning while its picture
 * ran later than its sound: clips that were not a whole number of frames
 * long were each written one frame too long and joined end to end. The
 * files are now cut to the timeline's frames (concat-timing.ts); these
 * checks count what was written, so a file that comes out another length
 * for any reason is named instead of passing unseen.
 *
 * @module electron/claude/handlers/claude-export-handler/export-picture-check
 */

import { spawn } from "node:child_process";
import { getFFprobePath } from "../../../ffmpeg/paths.js";

/**
 * The frames of a file's picture as its container counts them (MP4 and MOV
 * do); undefined when it cannot be read.
 */
export async function countPictureFrames({
	path,
}: {
	path: string;
}): Promise<number | undefined> {
	let ffprobePath: string;
	try {
		ffprobePath = await getFFprobePath();
	} catch {
		return undefined;
	}
	return new Promise((resolve) => {
		const ffprobe = spawn(
			ffprobePath,
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=nb_frames",
				"-of",
				"csv=p=0",
				path,
			],
			{ windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
		);
		let stdout = "";
		const timeoutId = setTimeout(() => {
			ffprobe.kill();
			resolve(undefined);
		}, 10_000);
		ffprobe.stdout?.on("data", (data) => {
			stdout += data.toString();
		});
		ffprobe.on("error", () => {
			clearTimeout(timeoutId);
			resolve(undefined);
		});
		ffprobe.on("close", () => {
			clearTimeout(timeoutId);
			const frames = Number.parseInt(stdout.trim(), 10);
			resolve(Number.isFinite(frames) && frames >= 0 ? frames : undefined);
		});
	});
}

/** A file the concat joined, with the frames the plan gave it. */
export interface PlannedPictureFile {
	path: string;
	/** What the file is, for the warning: a clip's element id, or "a gap". */
	label: string;
	frames: number;
}

function framesAsTime({
	frames,
	fps,
}: {
	frames: number;
	fps: number;
}): string {
	return `${frames} frame${Math.abs(frames) === 1 ? "" : "s"} (${(frames / fps).toFixed(3)} s at ${fps} fps)`;
}

/**
 * Warnings when the joined picture is not the timeline's length: the total
 * first, then the files that came out another length than planned (the
 * picture after each runs that much early or late against the sound).
 */
export async function checkJoinedPicture({
	joinedPath,
	files,
	fps,
	count = countPictureFrames,
}: {
	joinedPath: string;
	files: PlannedPictureFile[];
	fps: number;
	count?: typeof countPictureFrames;
}): Promise<string[]> {
	const expected = files.reduce((sum, file) => sum + file.frames, 0);
	const actual = await count({ path: joinedPath });
	if (actual === undefined || actual === expected) return [];
	const warnings = [
		`The joined picture is ${framesAsTime({ frames: actual, fps })}; the timeline gives it ${framesAsTime({ frames: expected, fps })}. Picture and sound are ${framesAsTime({ frames: Math.abs(actual - expected), fps })} apart by the end.`,
	];
	const offenders: string[] = [];
	for (const file of files) {
		const written = await count({ path: file.path });
		if (written === undefined || written === file.frames) continue;
		offenders.push(
			`${file.label} was written as ${written} frames, not ${file.frames}`
		);
	}
	if (offenders.length > 0) {
		const shown = offenders.slice(0, 5);
		const more = offenders.length - shown.length;
		warnings.push(
			`${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}. The picture after each is that much off the timeline.`
		);
	}
	return warnings;
}

/** A warning when the published picture is not as long as it should be. */
export async function checkExportedPicture({
	outputPath,
	expectedFrames,
	fps,
	count = countPictureFrames,
}: {
	outputPath: string;
	expectedFrames: number;
	fps: number;
	count?: typeof countPictureFrames;
}): Promise<string[]> {
	const actual = await count({ path: outputPath });
	if (actual === undefined || actual === expectedFrames) return [];
	return [
		`The exported picture is ${framesAsTime({ frames: actual, fps })}; it should be ${framesAsTime({ frames: expectedFrames, fps })}. A pass after the join added or dropped frames.`,
	];
}
