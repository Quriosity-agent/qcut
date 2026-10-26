import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execute, type Session } from "./editor-real-batch-evidence.ts";

interface ExportResult {
	status: string;
	outputPath: string;
	presetId: string;
	audioValidation?: {
		status: string;
		ceilingDbtp: number;
		truePeakDbtp: number;
		limiting?: {
			oversampleFactor: number;
			encodeAttempts: number;
			attenuationDb: number;
		};
	};
}
interface ProbeStream {
	codec_type: string;
	width?: number;
	height?: number;
	r_frame_rate?: string;
	duration?: string;
	nb_frames?: string;
}
type Cli = <T>({ args }: { args: string[] }) => Promise<T>;

async function verifyExport({
	result,
	session,
	outputRoot,
	name,
}: {
	result: ExportResult;
	session: Session;
	outputRoot: string;
	name: string;
}) {
	assert.equal(result.status, "completed");
	assert.equal(result.presetId, "custom");
	const { stdout } = await execute("ffprobe", [
		"-v",
		"error",
		"-show_streams",
		"-show_format",
		"-of",
		"json",
		result.outputPath,
	]);
	const probe = JSON.parse(stdout) as { streams: ProbeStream[] };
	const video = probe.streams.find((stream) => stream.codec_type === "video");
	assert(video);
	assert.equal(video.width, 1470);
	assert.equal(video.height, 630);
	assert.equal(video.r_frame_rate, "24/1");
	assert.equal(
		Number(video.nb_frames),
		session.clips.reduce((sum, clip) => sum + clip.frames, 0)
	);
	assert(
		Math.abs(Number(video.duration) - (session.timelineDuration ?? 0)) <
			1 / 24 + 0.001
	);
	const decoded = await execute(
		"ffmpeg",
		[
			"-hide_banner",
			"-nostdin",
			"-v",
			"error",
			"-xerror",
			"-i",
			result.outputPath,
			"-f",
			"null",
			"-",
		],
		{ timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }
	);
	assert.equal(decoded.stderr.trim(), "");
	const metered = await execute(
		"ffmpeg",
		[
			"-hide_banner",
			"-nostdin",
			"-nostats",
			"-i",
			result.outputPath,
			"-map",
			"0:a:0",
			"-af",
			"ebur128=peak=true:framelog=verbose",
			"-f",
			"null",
			"-",
		],
		{ timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }
	);
	const summary = metered.stderr.slice(metered.stderr.lastIndexOf("Summary:"));
	const peak = summary.match(/Peak:\s+(-?[\d.]+) dBFS/);
	assert(peak, "Independent FFmpeg true peak summary exists");
	const truePeakDbtp = Number(peak[1]);
	const packets = await execute(
		"ffprobe",
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_packets",
			"-show_data_hash",
			"sha256",
			"-show_entries",
			"packet=data_hash",
			"-of",
			"json",
			result.outputPath,
		],
		{ maxBuffer: 4 * 1024 * 1024 }
	);
	const packetData = JSON.parse(packets.stdout) as {
		packets: Array<{ data_hash: string }>;
	};
	assert.equal(packetData.packets.length, Number(video.nb_frames));
	const packetHash = createHash("sha256")
		.update(packetData.packets.map((packet) => packet.data_hash).join("\n"))
		.digest("hex");
	await writeFile(
		path.join(outputRoot, `${name}-true-peak.log`),
		metered.stderr
	);
	await writeFile(path.join(outputRoot, `${name}-probe.json`), stdout);
	return {
		result,
		truePeakDbtp,
		fullDecode: true,
		videoPacketHash: packetHash,
		frames: Number(video.nb_frames),
		duration: Number(video.duration),
	};
}

async function frameGallery({
	baseline,
	limited,
	outputRoot,
}: {
	baseline: string;
	limited: string;
	outputRoot: string;
}) {
	const times = [1, 16, 30];
	await Promise.all(
		times.map(async (time) => {
			await Promise.all(
				[
					{ name: "baseline", file: baseline },
					{ name: "limited", file: limited },
				].map(({ name, file }) =>
					execute("ffmpeg", [
						"-hide_banner",
						"-nostdin",
						"-v",
						"error",
						"-y",
						"-ss",
						String(time),
						"-i",
						file,
						"-frames:v",
						"1",
						path.join(outputRoot, `${name}-${time}.png`),
					])
				)
			);
			await execute("ffmpeg", [
				"-hide_banner",
				"-nostdin",
				"-v",
				"error",
				"-y",
				"-i",
				path.join(outputRoot, `baseline-${time}.png`),
				"-i",
				path.join(outputRoot, `limited-${time}.png`),
				"-filter_complex",
				"blend=all_mode=difference",
				"-frames:v",
				"1",
				path.join(outputRoot, `difference-${time}.png`),
			]);
		})
	);
	const rows = times
		.map(
			(time) =>
				`<tr><th>${time}s</th>${["baseline", "limited", "difference"].map((name) => `<td><img src="${name}-${time}.png" alt="${name} ${time}s"></td>`).join("")}</tr>`
		)
		.join("");
	await writeFile(
		path.join(outputRoot, "index.html"),
		`<!doctype html><meta charset="utf-8"><title>Real 32 clip export comparison</title><style>body{background:#111;color:#eee;font:16px system-ui;margin:24px}table{width:100%;border-collapse:collapse}td{width:32%;padding:8px}img{width:100%}th{text-align:left}a{color:#6dcaff}</style><h1>真实 32 段素材：完整桌面导出对比</h1><p>同一时间线、1470×630、24fps、主增益 +12dB。基线关闭限幅；对照开启 -1dBTP 限幅。</p><p><a href="export-pair-result.json">完整机器验证结果</a> · <a href="playback.json">播放证据</a> · <a href="prepare-result.json">批量添加与重开结果</a></p><table><tr><th>时间</th><th>关闭限幅</th><th>开启限幅</th><th>画面差分</th></tr>${rows}</table>`
	);
}

export async function runExportPair({
	session,
	outputRoot,
	cli,
}: {
	session: Session;
	outputRoot: string;
	cli: Cli;
}) {
	const render = async ({
		enabled,
		name,
	}: {
		enabled: boolean;
		name: string;
	}) => {
		await cli({
			args: [
				"editor:mix:master-set",
				"--project-id",
				session.projectId,
				"--gain-db",
				"12",
				"--effects",
				JSON.stringify({ limiter: { enabled, ceilingDb: -1, releaseMs: 50 } }),
			],
		});
		const destination = path.join(outputRoot, "exports", name);
		await mkdir(destination, { recursive: true });
		const result = await cli<ExportResult>({
			args: [
				"editor:export:start",
				"--project-id",
				session.projectId,
				"--data",
				JSON.stringify({
					engine: "native",
					width: 1470,
					height: 630,
					fps: 24,
					format: "mp4",
				}),
				"--output-dir",
				destination,
				"--poll",
				"--timeout",
				"600",
			],
		});
		const verified = await verifyExport({ result, session, outputRoot, name });
		await writeFile(
			path.join(outputRoot, `${name}-export.json`),
			JSON.stringify(verified, null, 2)
		);
		return verified;
	};
	const baseline = await render({ enabled: false, name: "baseline" });
	assert(
		baseline.truePeakDbtp > -1,
		"Baseline exercises the configured ceiling"
	);
	assert.equal(baseline.result.audioValidation, undefined);
	const limited = await render({ enabled: true, name: "limited" });
	assert(
		limited.truePeakDbtp <= -1,
		"Independent encoded true peak respects the ceiling"
	);
	assert.equal(limited.result.audioValidation?.status, "passed");
	assert(
		limited.result.audioValidation.limiting,
		"Native limiting metadata is present"
	);
	assert.equal(
		limited.videoPacketHash,
		baseline.videoPacketHash,
		"Audio limiting preserves every video packet"
	);
	const unchanged = await Promise.all(
		session.clips.map(
			async (clip) =>
				createHash("sha256")
					.update(await readFile(clip.file))
					.digest("hex") === clip.sha256
		)
	);
	assert(
		unchanged.every(Boolean),
		"All original source clip hashes are unchanged"
	);
	const result = {
		baseline,
		limited,
		sourceHashesUnchanged: true,
		matchingVideoPackets: true,
		sameMasterGainDb: 12,
	};
	await writeFile(
		path.join(outputRoot, "export-pair-result.json"),
		JSON.stringify(result, null, 2)
	);
	await frameGallery({
		baseline: baseline.result.outputPath,
		limited: limited.result.outputPath,
		outputRoot,
	});
	return result;
}
