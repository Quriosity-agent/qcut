import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { cpus, release } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { getFFmpegPath, getFFprobePath } from "../electron/ffmpeg/paths.js";
import { resolveAutorotatedVideoDimensions } from "../electron/jianying-person-cutout/video-display-dimensions.js";
import { resolveIndependentFogLut } from "../electron/qcut-independent-filter/assets.js";
import { resolveIndependentFilterHost } from "../electron/qcut-independent-filter/bridge.js";
import {
	QCUT_FOG_RESOURCE,
	QCUT_FOG_VERSION,
} from "../electron/qcut-independent-filter/contract.js";
import { loadIndependentGraph } from "../electron/qcut-independent-filter/graph-data.js";
import { INDEPENDENT_GRAPH_PROFILES } from "../electron/qcut-independent-filter/graph-profiles.js";
import {
	createIndependentFilterSession,
	type IndependentFilterSession,
} from "../electron/qcut-independent-filter/session.js";

const exec = promisify(execFile);
const digest = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");

function summarize({ values }: { values: number[] }) {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		count: sorted.length,
		p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
		p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
		mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
	};
}

function positiveInteger({ value, name }: { value: string; name: string }) {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1)
		throw new Error(`${name} must be a positive integer.`);
	return parsed;
}

async function main() {
	const { values } = parseArgs({
		options: {
			input: { type: "string" },
			output: { type: "string" },
			frames: { type: "string", default: "60" },
			warmup: { type: "string", default: "6" },
			repeats: { type: "string", default: "3" },
			compare: { type: "string" },
			"allow-host-change": { type: "boolean", default: false },
		},
	});
	if (process.platform !== "darwin") throw new Error("Requires macOS Metal.");
	if (!values.input || !values.output)
		throw new Error(
			"--input moving-video.mp4 --output new-directory are required."
		);
	const frames = positiveInteger({ value: values.frames, name: "frames" });
	const warmup = positiveInteger({ value: values.warmup, name: "warmup" });
	const repeats = positiveInteger({ value: values.repeats, name: "repeats" });
	if (frames > 300 || warmup > 60 || repeats > 10)
		throw new Error("Maximum: 300 frames, 60 warmup frames and 10 repeats.");
	const input = resolve(values.input);
	const output = resolve(values.output);
	const ffmpeg = getFFmpegPath();
	const ffprobe = await getFFprobePath();
	const probe = await exec(
		ffprobe,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_streams",
			"-of",
			"json",
			input,
		],
		{ timeout: 30_000, maxBuffer: 1024 * 1024 }
	);
	const stream = (
		JSON.parse(probe.stdout) as {
			streams: {
				width: number;
				height: number;
				r_frame_rate: string;
				side_data_list?: { rotation?: unknown }[];
				tags?: { rotate?: unknown };
			}[];
		}
	).streams[0];
	if (!stream) throw new Error("Input has no video stream.");
	const { width, height } = resolveAutorotatedVideoDimensions({
		width: stream.width,
		height: stream.height,
		sideDataList: stream.side_data_list,
		tags: stream.tags,
	});
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		width > 4096 ||
		height > 4096 ||
		width * height > 1920 * 1080
	)
		throw new Error(
			"Input exceeds the existing Metal session's 1080p pixel limit."
		);
	const frameBytes = width * height * 4;
	if (frameBytes * (frames + warmup) > 768 * 1024 * 1024)
		throw new Error(
			"Decoded input exceeds the 768 MiB benchmark memory limit."
		);
	const decodeStarted = performance.now();
	const { stdout: raw } = await exec(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			input,
			"-map",
			"0:v:0",
			"-an",
			"-frames:v",
			String(frames + warmup),
			"-pix_fmt",
			"rgba",
			"-f",
			"rawvideo",
			"-",
		],
		{
			encoding: "buffer",
			timeout: 120_000,
			maxBuffer: frameBytes * (frames + warmup) + 1024,
		}
	);
	const decodeMs = performance.now() - decodeStarted;
	if (raw.length !== frameBytes * (frames + warmup))
		throw new Error(`Input must contain at least ${frames + warmup} frames.`);
	const inputFrames = Array.from({ length: frames + warmup }, (_, index) =>
		raw.subarray(index * frameBytes, (index + 1) * frameBytes)
	);
	if (new Set(inputFrames.map((bytes) => digest({ bytes }))).size < 2)
		throw new Error(
			"Benchmark requires moving frames, not a repeated still image."
		);

	const setupStarted = performance.now();
	const profile = INDEPENDENT_GRAPH_PROFILES.find(
		(candidate) => candidate.resourceId === "7403664041945681191"
	);
	if (!profile || profile.dualLut)
		throw new Error("Missing independent sharpen profile.");
	const [lutPath, graph, host] = await Promise.all([
		resolveIndependentFogLut(),
		loadIndependentGraph({
			card: {
				...profile,
				available: true,
				cacheStatus: "cached",
				categories: [],
				implementation: "shader",
				verification: "unverified",
				lutCount: 1,
			},
		}),
		resolveIndependentFilterHost(),
	]);
	const assetsAndHostMs = performance.now() - setupStarted;
	const [hostBytes, lutBytes] = await Promise.all([
		readFile(host),
		readFile(lutPath),
	]);
	await mkdir(output);

	const identity = [
		{ resourceId: QCUT_FOG_RESOURCE, version: QCUT_FOG_VERSION },
		{ resourceId: profile.resourceId, version: profile.version },
	];
	type Sample = {
		repeat: number;
		index: number;
		stageMs: number[];
		totalMs: number;
		rgbaSha256: string;
	};
	type Case = {
		name: string;
		intensity: number;
		startupMs: number[][];
		firstFrameMs: number[];
		samples: Sample[];
		steadyMs: ReturnType<typeof summarize>;
		stageMs: ReturnType<typeof summarize>[];
	};
	const cases: Case[] = [];
	let savedFrames: Uint8Array[] = [];

	await [0, 100].reduce(async (previousCase, intensity) => {
		await previousCase;
		const samples: Sample[] = [];
		const startupMs: number[][] = [];
		const firstFrameMs: number[] = [];
		await Array.from({ length: repeats }, (_, repeat) => repeat).reduce(
			async (previousRepeat, repeat) => {
				await previousRepeat;
				const sessions: IndependentFilterSession[] = [];
				try {
					const fogStart = performance.now();
					sessions.push(await createIndependentFilterSession({ lutPath }));
					const fogMs = performance.now() - fogStart;
					const graphStart = performance.now();
					sessions.push(
						await createIndependentFilterSession({ graph, identity: profile })
					);
					startupMs.push([fogMs, performance.now() - graphStart]);
					await inputFrames.reduce(async (previousFrame, rgba, index) => {
						await previousFrame;
						let current: Uint8Array = rgba;
						const stageMs: number[] = [];
						const begin = performance.now();
						await sessions.reduce(async (previousStage, session, stage) => {
							await previousStage;
							const start = performance.now();
							current = (
								await session.render({
									...identity[stage],
									rgba: current,
									width,
									height,
									intensity,
								})
							).rgba;
							stageMs.push(performance.now() - start);
						}, Promise.resolve());
						const totalMs = performance.now() - begin;
						const rgbaSha256 = digest({ bytes: current });
						if (intensity === 0 && rgbaSha256 !== digest({ bytes: rgba }))
							throw new Error("Zero-intensity transport changed pixels.");
						if (index === 0) firstFrameMs.push(totalMs);
						if (index < warmup) return;
						samples.push({ repeat, index, stageMs, totalMs, rgbaSha256 });
						if (intensity === 100 && repeat === repeats - 1)
							savedFrames.push(current);
					}, Promise.resolve());
				} finally {
					await Promise.all(sessions.map((session) => session.dispose()));
				}
			},
			Promise.resolve()
		);
		const firstRepeat = samples.filter((sample) => sample.repeat === 0);
		if (
			samples.some(
				(sample) =>
					sample.rgbaSha256 !== firstRepeat[sample.index - warmup].rgbaSha256
			)
		)
			throw new Error("Repeated sessions returned different output pixels.");
		cases.push({
			name:
				intensity === 0 ? "two-stage-transport-control" : "fog-then-sharpen",
			intensity,
			startupMs,
			firstFrameMs,
			samples,
			steadyMs: summarize({ values: samples.map((sample) => sample.totalMs) }),
			stageMs: identity.map((_, stage) =>
				summarize({
					values: samples.map((sample) => sample.stageMs[stage]),
				})
			),
		});
	}, Promise.resolve());

	const copySamples = Array.from({ length: frames }, () => {
		const start = performance.now();
		const snapshot = new Uint8Array(inputFrames[0]);
		const snapshotMs = performance.now() - start;
		const packStart = performance.now();
		const packed = Buffer.concat([Buffer.alloc(12), snapshot]);
		const packMs = performance.now() - packStart;
		const returnStart = performance.now();
		const returned = new Uint8Array(packed.subarray(12));
		const returnCopyMs = performance.now() - returnStart;
		if (returned.length !== frameBytes)
			throw new Error("Invalid copy control.");
		return { snapshotMs, packMs, returnCopyMs };
	});
	const report = {
		schemaVersion: 1,
		createdAt: new Date().toISOString(),
		environment: {
			platform: process.platform,
			arch: process.arch,
			os: release(),
			cpu: cpus()[0]?.model,
			runtime: process.versions.bun
				? `Bun ${process.versions.bun}`
				: `Node ${process.version}`,
		},
		measurement:
			"Host round trip: input snapshot, packing, pipes, Metal submission/wait/readback, response assembly and return copy. Not isolated GPU time or Electron renderer IPC.",
		recipe: {
			width,
			height,
			frames,
			warmup,
			repeats,
			sourceFrameRate: stream.r_frame_rate,
			inputRgbaSha256: digest({ bytes: raw }),
			hostSha256: digest({ bytes: hostBytes }),
			fogLutSha256: digest({ bytes: lutBytes }),
			graphAssetSha256: profile.assetHash,
			graphControlSha256: profile.controlHash,
			identity,
		},
		setup: { decodeMs, assetsAndHostMs },
		copyControlMs: {
			measurement:
				"Standalone allocation/copy microbenchmark; not additive attribution of frame latency.",
			snapshot: summarize({
				values: copySamples.map((sample) => sample.snapshotMs),
			}),
			packing: summarize({
				values: copySamples.map((sample) => sample.packMs),
			}),
			returnCopy: summarize({
				values: copySamples.map((sample) => sample.returnCopyMs),
			}),
		},
		cases,
		comparison: undefined as
			| { outputsEqual: true; baselineHostSha256: string; p50Ratio: number[] }
			| undefined,
	};
	if (values.compare) {
		const previous = JSON.parse(
			await readFile(resolve(values.compare), "utf8")
		) as typeof report;
		const expectedRecipe = {
			...previous.recipe,
			...(values["allow-host-change"]
				? { hostSha256: report.recipe.hostSha256 }
				: {}),
		};
		if (
			previous.schemaVersion !== 1 ||
			JSON.stringify(expectedRecipe) !== JSON.stringify(report.recipe)
		)
			throw new Error(
				"Baseline has different inputs, host, LUT, dimensions or sampling settings."
			);
		if (
			previous.cases.length !== cases.length ||
			previous.cases.some(
				(entry, caseIndex) =>
					entry.intensity !== cases[caseIndex].intensity ||
					entry.samples.length !== cases[caseIndex].samples.length ||
					entry.samples.some(
						(sample, index) =>
							sample.rgbaSha256 !== cases[caseIndex].samples[index].rgbaSha256
					)
			)
		)
			throw new Error("Baseline and current output frame hashes differ.");
		report.comparison = {
			outputsEqual: true,
			baselineHostSha256: previous.recipe.hostSha256,
			p50Ratio: cases.map(
				(entry, index) =>
					entry.steadyMs.p50 / previous.cases[index].steadyMs.p50
			),
		};
	}

	const rawOutput = join(output, "filtered.rgba");
	try {
		await writeFile(rawOutput, Buffer.concat(savedFrames));
		savedFrames = [];
		await exec(
			ffmpeg,
			[
				"-v",
				"error",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				"-s",
				`${width}x${height}`,
				"-r",
				stream.r_frame_rate,
				"-i",
				rawOutput,
				"-an",
				"-c:v",
				"libx264",
				"-preset",
				"fast",
				"-crf",
				"18",
				"-pix_fmt",
				width % 2 === 0 && height % 2 === 0 ? "yuv420p" : "yuv444p",
				join(output, "filtered.mp4"),
			],
			{ timeout: 120_000, maxBuffer: 1024 * 1024 }
		);
	} finally {
		await rm(rawOutput, { force: true });
	}
	const videoPath = join(output, "filtered.mp4");
	const videoProbe = await exec(
		ffprobe,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-count_frames",
			"-show_entries",
			"stream=width,height,nb_read_frames",
			"-of",
			"json",
			videoPath,
		],
		{ timeout: 120_000, maxBuffer: 1024 * 1024 }
	);
	const savedStream = (
		JSON.parse(videoProbe.stdout) as {
			streams: { width: number; height: number; nb_read_frames: string }[];
		}
	).streams[0];
	if (
		!savedStream ||
		savedStream.width !== width ||
		savedStream.height !== height ||
		Number(savedStream.nb_read_frames) !== frames
	)
		throw new Error(
			"Saved benchmark video has incorrect dimensions or frame count."
		);
	const artifact = {
		file: "filtered.mp4",
		width,
		height,
		frames,
		sha256: digest({ bytes: await readFile(videoPath) }),
	};
	await writeFile(
		join(output, "report.json"),
		`${JSON.stringify({ ...report, artifact }, null, 2)}\n`
	);
	console.log(
		JSON.stringify(
			{
				output,
				recipe: report.recipe,
				cases: cases.map(({ name, steadyMs, stageMs }) => ({
					name,
					steadyMs,
					stageMs,
				})),
				comparison: report.comparison,
			},
			null,
			2
		)
	);
}

void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
