import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const execute = promisify(execFile);

export async function sha256File({ file }: { file: string }): Promise<string> {
	return createHash("sha256")
		.update(await readFile(file))
		.digest("hex");
}

export interface Clip {
	name: string;
	file: string;
	duration: number;
	frames: number;
	sha256: string;
}
export interface Timeline {
	tracks: Array<{
		id: string;
		isMain?: boolean;
		elements: Array<{
			id: string;
			name?: string;
			sourceName?: string;
			startTime: number;
			duration: number;
		}>;
	}>;
}
export interface Session {
	projectId: string;
	clips: Clip[];
	timelineDuration?: number;
}

export function verifyTimeline({
	timeline,
	clips,
}: {
	timeline: Timeline;
	clips: Clip[];
}) {
	const elements = timeline.tracks.flatMap((track) => track.elements);
	assert.equal(elements.length, 32, "No missing or duplicated elements");
	assert.equal(new Set(elements.map((element) => element.id)).size, 32);
	let end = 0;
	for (const [index, element] of elements.entries()) {
		assert.equal(element.name ?? element.sourceName, clips[index].name);
		assert(
			Math.abs(element.startTime - end) < 0.0001,
			`Non-contiguous clip ${index}`
		);
		assert(
			Math.abs(element.duration - clips[index].duration) < 0.00001,
			`Wrong video duration ${index}`
		);
		end = element.startTime + element.duration;
	}
	return end;
}

export async function sourceClips({
	assetRoot,
}: {
	assetRoot: string;
}): Promise<Clip[]> {
	const names = (await readdir(assetRoot))
		.filter((name) => name.endsWith(".mp4"))
		.sort();
	assert.equal(
		names.length,
		32,
		"Asset root must contain exactly 32 real MP4 clips"
	);
	return Promise.all(
		names.map(async (name) => {
			const file = path.join(assetRoot, name);
			const { stdout } = await execute("ffprobe", [
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=width,height,r_frame_rate,duration,nb_frames",
				"-of",
				"json",
				file,
			]);
			const stream = JSON.parse(stdout).streams[0];
			assert.equal(stream.width, 1470);
			assert.equal(stream.height, 630);
			assert.equal(stream.r_frame_rate, "24/1");
			return {
				name,
				file,
				duration: Number(stream.duration),
				frames: Number(stream.nb_frames),
				sha256: await sha256File({ file }),
			};
		})
	);
}
