import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getFFmpegPath } from "../../../../../../electron/ffmpeg/paths";

const run = promisify(execFile);

/** Stream-copies the real video and adds explicitly synthetic, sample-positioned audio markers. */
export async function createBodyPlaybackAudioFixture({
	source,
	output,
	seconds,
}: {
	source: string;
	output: string;
	seconds: number;
}) {
	if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60)
		throw new Error("Synthetic audio fixture duration must be 1..60 seconds");
	await mkdir(output, { recursive: true });
	const sampleRate = 48_000;
	const samples = Math.round(seconds * sampleRate);
	const pcm = Buffer.alloc(44 + samples * 2);
	pcm.write("RIFF", 0);
	pcm.writeUInt32LE(pcm.length - 8, 4);
	pcm.write("WAVEfmt ", 8);
	pcm.writeUInt32LE(16, 16);
	pcm.writeUInt16LE(1, 20);
	pcm.writeUInt16LE(1, 22);
	pcm.writeUInt32LE(sampleRate, 24);
	pcm.writeUInt32LE(sampleRate * 2, 28);
	pcm.writeUInt16LE(2, 32);
	pcm.writeUInt16LE(16, 34);
	pcm.write("data", 36);
	pcm.writeUInt32LE(samples * 2, 40);
	const markers = Array.from(
		{ length: Math.ceil(seconds * 2) },
		(_, index) => 0.25 + index * 0.5
	).filter((time) => time + 0.04 < seconds);
	for (let index = 0; index < samples; index++) {
		const time = index / sampleRate;
		const local = (((time - 0.25) % 0.5) + 0.5) % 0.5;
		const active = time >= 0.25 && local < 0.04;
		const envelope = active
			? Math.min(1, local / 0.001, (0.04 - local) / 0.001)
			: 0;
		pcm.writeInt16LE(
			Math.round(
				0.45 * 32767 * envelope * Math.sin(2 * Math.PI * 1000 * local)
			),
			44 + index * 2
		);
	}
	const audio = path.join(output, "synthetic-marker-audio.wav");
	const video = path.join(output, "synthetic-audio-body.mov");
	await writeFile(audio, pcm);
	const args = [
		"-y",
		"-v",
		"error",
		"-i",
		source,
		"-i",
		audio,
		"-map",
		"0:v:0",
		"-map",
		"1:a:0",
		"-t",
		String(seconds),
		"-c:v",
		"copy",
		"-c:a",
		"pcm_s16le",
		"-shortest",
		video,
	];
	await run(getFFmpegPath(), args, { timeout: 120_000 });
	const manifest = {
		synthetic: true,
		purpose:
			"Local playback A/V clock fixture; original video with generated marker audio, not a real recorded sync sample",
		source,
		sourceSha256: createHash("sha256")
			.update(await readFile(source))
			.digest("hex"),
		video,
		videoSha256: createHash("sha256")
			.update(await readFile(video))
			.digest("hex"),
		audio,
		audioSha256: createHash("sha256").update(pcm).digest("hex"),
		seconds,
		sampleRate,
		markers,
		markerSeconds: 0.04,
		markerFrequencyHz: 1000,
		markerAmplitude: 0.45,
		generation:
			"mono PCM16; sample-positioned 1000 Hz bursts, 1 ms ramps, first at 0.25 s, interval 0.5 s",
		command: { executable: getFFmpegPath(), args },
	};
	await writeFile(
		path.join(output, "synthetic-fixture.json"),
		`${JSON.stringify(manifest, null, 2)}\n`
	);
	return manifest;
}
