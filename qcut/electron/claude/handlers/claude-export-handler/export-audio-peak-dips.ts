import { promises as fs } from "node:fs";
import type { TruePeakBlock } from "../../../ffmpeg/audio-true-peak.js";

/** Lowers a stretch of the mix by depthDb, easing in and out just outside it. */
export interface PeakDip {
	start: number;
	end: number;
	depthDb: number;
}

const RAMP_SECONDS = 0.02;
const BYTES_PER_SAMPLE = 4;

/**
 * The dips that bring every block above `targetDb` down to it, and a block
 * above `overDb` `extraDb` further. Each covers its block and `padSeconds`
 * either side: the encoder spreads what it does to a moment over the frames
 * around it.
 */
export function planPeakDips({
	blocks,
	targetDb,
	overDb,
	extraDb,
	padSeconds,
}: {
	blocks: TruePeakBlock[];
	targetDb: number;
	overDb: number;
	extraDb: number;
	padSeconds: number;
}): PeakDip[] {
	return blocks.flatMap((block) => {
		const blockTargetDb = targetDb - (block.peakDb > overDb ? extraDb : 0);
		if (block.peakDb <= blockTargetDb) return [];
		return [
			{
				start: Math.max(0, block.start - padSeconds),
				end: block.end + padSeconds,
				depthDb: block.peakDb - blockTargetDb,
			},
		];
	});
}

/**
 * How long the dips lowered the mix for, in seconds of `duration`, and the
 * most any one stretch came down over every pass, in dB.
 */
export function summarizePeakDips({
	dips,
	duration,
}: {
	dips: PeakDip[];
	duration: number;
}): { correctedSeconds: number; maxCorrectionDb: number } {
	const depths = new Map<string, number>();
	let seconds = 0;
	let reach = 0;
	for (const dip of [...dips].sort((left, right) => left.start - right.start)) {
		const key = `${dip.start}:${dip.end}`;
		depths.set(key, (depths.get(key) ?? 0) + dip.depthDb);
		const end = Math.min(duration, dip.end);
		seconds += Math.max(0, end - Math.max(reach, dip.start));
		reach = Math.max(reach, end);
	}
	return {
		correctedSeconds: Number(seconds.toFixed(2)),
		maxCorrectionDb: Number(Math.max(0, ...depths.values()).toFixed(2)),
	};
}

function depthAt({ dip, time }: { dip: PeakDip; time: number }): number {
	if (time >= dip.start && time <= dip.end) return dip.depthDb;
	const distance = time < dip.start ? dip.start - time : time - dip.end;
	if (distance >= RAMP_SECONDS) return 0;
	// Raised cosine, so the level eases into and out of the dip without a step.
	return (
		dip.depthDb * (0.5 + 0.5 * Math.cos((Math.PI * distance) / RAMP_SECONDS))
	);
}

/** Dips whose ramps touch, in start order: each stretch is read once. */
function groupDips({
	dips,
}: {
	dips: PeakDip[];
}): Array<{ dips: PeakDip[]; start: number; end: number }> {
	const groups: Array<{ dips: PeakDip[]; start: number; end: number }> = [];
	for (const dip of [...dips].sort((left, right) => left.start - right.start)) {
		const group = groups.at(-1);
		if (group && dip.start - RAMP_SECONDS <= group.end) {
			group.dips.push(dip);
			group.end = Math.max(group.end, dip.end + RAMP_SECONDS);
		} else {
			groups.push({
				dips: [dip],
				start: dip.start - RAMP_SECONDS,
				end: dip.end + RAMP_SECONDS,
			});
		}
	}
	return groups;
}

/**
 * Applies dips in place to raw interleaved 32-bit float PCM; where dips
 * overlap, the deepest holds. Only the dipped stretches are read and written.
 */
export async function applyPeakDips({
	file,
	dips,
	sampleRate,
	channels,
}: {
	file: string;
	dips: PeakDip[];
	sampleRate: number;
	channels: number;
}): Promise<void> {
	if (dips.length === 0) return;
	const handle = await fs.open(file, "r+");
	try {
		const frameBytes = channels * BYTES_PER_SAMPLE;
		const totalFrames = Math.floor((await handle.stat()).size / frameBytes);
		for (const group of groupDips({ dips })) {
			const first = Math.max(0, Math.floor(group.start * sampleRate));
			const last = Math.min(totalFrames, Math.ceil(group.end * sampleRate));
			let next = 0;
			let active: PeakDip[] = [];
			// A second of audio at a time keeps memory flat for any length.
			for (let chunk = first; chunk < last; chunk += sampleRate) {
				const frames = Math.min(sampleRate, last - chunk);
				const chunkStart = chunk / sampleRate;
				const chunkEnd = (chunk + frames) / sampleRate;
				while (
					next < group.dips.length &&
					group.dips[next].start - RAMP_SECONDS < chunkEnd
				) {
					active.push(group.dips[next]);
					next += 1;
				}
				active = active.filter((dip) => dip.end + RAMP_SECONDS > chunkStart);
				const samples = new Float32Array(frames * channels);
				const bytes = new Uint8Array(samples.buffer);
				const position = chunk * frameBytes;
				const { bytesRead } = await handle.read(
					bytes,
					0,
					bytes.length,
					position
				);
				if (bytesRead !== bytes.length) {
					throw new Error("The limited mix ended before a peak correction");
				}
				for (let frame = 0; frame < frames; frame++) {
					const time = (chunk + frame) / sampleRate;
					let depth = 0;
					for (const dip of active) {
						depth = Math.max(depth, depthAt({ dip, time }));
					}
					if (depth === 0) continue;
					const gain = 10 ** (-depth / 20);
					for (let channel = 0; channel < channels; channel++) {
						samples[frame * channels + channel] *= gain;
					}
				}
				await handle.write(bytes, 0, bytes.length, position);
			}
		}
	} finally {
		await handle.close();
	}
}
