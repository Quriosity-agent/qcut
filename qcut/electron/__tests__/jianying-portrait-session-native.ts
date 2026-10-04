// Bundle with esbuild --platform=node --format=cjs --packages=external; run on Node >=22.
// Arguments: <local-video> <fresh-output-directory> <first-frame>. Ten frames are decoded.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { createJianyingPortraitAdjustmentProvider } from "../jianying-portrait-adjustment-runtime/provider";
import { parseJianyingPortraitRenderRequest } from "../jianying-portrait-adjustment-runtime/request";
import {
	buildPortraitSessionPlan,
	runPortraitSessionPlan,
	SESSION_COMBINED_ADJUSTMENTS,
	type PortraitSessionSample,
} from "./jianying-portrait-session-plan";
import {
	runBoundedPortraitWorker,
	capturePortraitAuditIdentity,
	finalizePortraitAuditAcceptance,
} from "./jianying-portrait-session-process";

const execFileAsync = promisify(execFile);
const CANCEL_MARKER = "QCUT_SESSION_CANCEL_QUEUED";
const sha256 = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");
const json = async ({ file, value }: { file: string; value: unknown }) =>
	writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

async function decodeFixture({
	source,
	firstFrame,
}: {
	source: string;
	firstFrame: number;
}) {
	assert(
		Number.isSafeInteger(firstFrame) && firstFrame >= 0 && firstFrame <= 1800,
		"Bound first frame to 0..1800"
	);
	const sourceStat = await stat(source);
	assert(
		sourceStat.isFile() && sourceStat.size <= 256 * 1024 * 1024,
		"Use a local video <=256 MiB"
	);
	const sourceSha256 = sha256({ bytes: await readFile(source) });
	const probe = await execFileAsync(
		"ffprobe",
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-read_intervals",
			`%+#${firstFrame + 10}`,
			"-show_streams",
			"-show_frames",
			"-show_entries",
			"stream=width,height,codec_name,sample_aspect_ratio:frame=best_effort_timestamp_time",
			"-of",
			"json",
			source,
		],
		{ timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 }
	);
	const metadata = JSON.parse(probe.stdout) as {
		streams: {
			width: number;
			height: number;
			codec_name: string;
			sample_aspect_ratio?: string;
		}[];
		frames: { best_effort_timestamp_time: string }[];
	};
	const { width, height } = metadata.streams[0];
	assert(
		Number.isSafeInteger(width) &&
			Number.isSafeInteger(height) &&
			width > 0 &&
			height > 0 &&
			width * height <= 2_100_000,
		"Use a pre-sized <=2.1MP video"
	);
	assert(
		!metadata.streams[0].sample_aspect_ratio ||
			["1:1", "0:1"].includes(metadata.streams[0].sample_aspect_ratio),
		"Non-square pixels need a separate fixture"
	);
	const times = metadata.frames
		.slice(firstFrame, firstFrame + 10)
		.map((frame) => Number(frame.best_effort_timestamp_time));
	buildPortraitSessionPlan({ times });
	const byteLength = width * height * 4;
	const decoded = await execFileAsync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-nostdin",
			"-threads",
			"1",
			"-hwaccel",
			"none",
			"-noautorotate",
			"-i",
			source,
			"-map",
			"0:v:0",
			"-an",
			"-sn",
			"-dn",
			"-vf",
			`select=between(n\\,${firstFrame}\\,${firstFrame + 9})`,
			"-fps_mode",
			"passthrough",
			"-frames:v",
			"10",
			"-threads",
			"1",
			"-pix_fmt",
			"rgba",
			"-f",
			"rawvideo",
			"pipe:1",
		],
		{
			encoding: "buffer",
			timeout: 30_000,
			killSignal: "SIGKILL",
			maxBuffer: byteLength * 10 + 65_536,
		}
	);
	assert.equal(
		decoded.stdout.byteLength,
		byteLength * 10,
		"Incomplete ten-frame decode"
	);
	const frames = times.map(
		(_time, index) =>
			new Uint8Array(
				decoded.stdout.subarray(index * byteLength, (index + 1) * byteLength)
			)
	);
	const hashes = frames.map((bytes) => sha256({ bytes }));
	assert(new Set(hashes).size >= 3, "Repeated stills are not a motion fixture");
	assert.equal(
		sha256({ bytes: await readFile(source) }),
		sourceSha256,
		"Source changed during decode"
	);
	return {
		frames,
		width,
		height,
		times,
		provenance: {
			source,
			sourceSha256,
			firstFrame,
			frameCount: 10,
			frameNumbers: times.map((_time, index) => firstFrame + index),
			timestampsSeconds: times,
			decodedRgbaSha256: hashes,
			uniqueFrames: new Set(hashes).size,
			sampledSpanSeconds: times[9] - times[0],
			decoder: "ffmpeg CPU RGBA, no scaling, no autorotation",
			stream: metadata.streams[0],
			coverage: "short-local-video-window; not minute-long validation",
		},
	};
}

async function worker({
	source,
	output,
	firstFrame,
	cancel,
}: {
	source: string;
	output: string;
	firstFrame: number;
	cancel: boolean;
}) {
	const fixture = await decodeFixture({ source, firstFrame });
	const executionIdentity = JSON.parse(
		await readFile(path.join(output, "provenance.json"), "utf8")
	).identity;
	const { width, height, frames, times } = fixture;
	const canvas = createCanvas(width, height);
	const context = canvas.getContext("2d");
	const save = async ({ name, rgba }: { name: string; rgba: Uint8Array }) => {
		context.putImageData(
			new ImageData(new Uint8ClampedArray(rgba), width, height),
			0,
			0
		);
		const png = canvas.toBuffer("image/png");
		await writeFile(path.join(output, name), png);
		context.drawImage(await loadImage(png), 0, 0);
		assert.deepEqual(
			new Uint8Array(context.getImageData(0, 0, width, height).data),
			rgba,
			"PNG roundtrip changed pixels"
		);
		return {
			file: name,
			pngSha256: sha256({ bytes: png }),
			rgbaSha256: sha256({ bytes: rgba }),
		};
	};
	const createProvider = () => {
		const provider = createJianyingPortraitAdjustmentProvider();
		return {
			clear: provider.clear,
			render: (request: Parameters<typeof provider.render>[0]) =>
				provider.render(
					parseJianyingPortraitRenderRequest({
						request: {
							...request,
							frameNumber: (request.frameNumber ?? 0) + firstFrame,
						},
					})
				),
		};
	};
	if (cancel) {
		const provider = createProvider();
		try {
			const request = ({ frame }: { frame: number }) => ({
				width,
				height,
				rgba: frames[frame],
				sourceKey: "cancel-native",
				frameNumber: frame,
				timestampSeconds: times[frame],
				adjustments: SESSION_COMBINED_ADJUSTMENTS,
			});
			const warm = await provider.render(request({ frame: 0 }));
			const artifact = await save({
				name: "cancel-warm-native.png",
				rgba: warm.rgba,
			});
			await json({
				file: path.join(output, "cancel-start.json"),
				value: {
					provenance: fixture.provenance,
					executionIdentity,
					artifact,
					warmActiveGroups: warm.activeGroups,
					queued: 3,
					nativeAbortApi: false,
					scope:
						"external worker/process-group cancellation after real native warmup",
				},
			});
			const pending = [1, 2, 3].map((frame) =>
				provider.render(request({ frame }))
			);
			process.stdout.write(`${CANCEL_MARKER}\n`);
			await Promise.all(pending);
		} finally {
			await provider.clear();
		}
		return;
	}
	const samples: (PortraitSessionSample & {
		actual: unknown;
		expected: unknown;
		diff: unknown;
	})[] = [];
	const report = {
		passed: false,
		executionIdentity,
		backend: "real-native-product-provider",
		provenance: fixture.provenance,
		jianyingUiComparisonPerformed: false,
		arbitraryFrameCandidateReady: false,
		nativeAbortApi: false,
		cancellation:
			"clear drains queued work; separate worker cancellation is not UI cancellation",
		samples,
		error: null as string | null,
		clearDrainedRequests: 0,
	};
	const reportPath = path.join(output, "report.json");
	await json({ file: reportPath, value: report });
	try {
		await frames.reduce(async (previous, rgba, index) => {
			await previous;
			await save({ name: `input-${index}.png`, rgba });
		}, Promise.resolve());
		const results = await runPortraitSessionPlan({
			steps: buildPortraitSessionPlan({ times }),
			frames,
			width,
			height,
			createProvider,
			onSample: async ({ sample, actual, expected }) => {
				const delta = new Uint8Array(actual.length);
				for (let offset = 0; offset < actual.length; offset += 4) {
					const gray = Math.min(
						255,
						8 *
							Math.max(
								...[0, 1, 2].map((channel) =>
									Math.abs(
										actual[offset + channel] - expected[offset + channel]
									)
								)
							)
					);
					delta.set([gray, gray, gray, 255], offset);
				}
				const actualArtifact = await save({
					name: `${sample.id}-native.png`,
					rgba: actual,
				});
				const expectedArtifact = await save({
					name: `${sample.id}-isolated.png`,
					rgba: expected,
				});
				const diffArtifact = await save({
					name: `${sample.id}-diff-x8.png`,
					rgba: delta,
				});
				samples.push({
					...sample,
					actual: actualArtifact,
					expected: expectedArtifact,
					diff: diffArtifact,
				});
				await json({ file: reportPath, value: report });
				console.log(
					JSON.stringify({
						id: sample.id,
						passed: sample.passed,
						violations: sample.violations,
						difference: sample.difference,
					})
				);
			},
		});
		const queued = createProvider();
		try {
			const completed: number[] = [];
			const pending = [0, 1, 2].map((frame) =>
				queued
					.render({
						width,
						height,
						rgba: frames[frame],
						sourceKey: "clear-drain",
						frameNumber: frame,
						timestampSeconds: times[frame],
						adjustments: SESSION_COMBINED_ADJUSTMENTS,
					})
					.then(() => {
						completed.push(frame);
					})
			);
			await queued.clear();
			assert.deepEqual(
				completed,
				[0, 1, 2],
				"clear must drain the existing queue before disposing"
			);
			await Promise.all(pending);
			report.clearDrainedRequests = completed.length;
		} finally {
			await queued.clear();
		}
		report.passed = results.every(({ passed }) => passed);
	} catch (cause) {
		report.error = String(cause);
		throw cause;
	} finally {
		await json({ file: reportPath, value: report });
	}
	if (!report.passed) process.exitCode = 1;
}

async function main() {
	assert(
		process.env.QCUT_PORTRAIT_NATIVE_LEASE,
		"Set QCUT_PORTRAIT_NATIVE_LEASE only after the parent grants a GPU lease"
	);
	const args = process.argv.slice(2);
	const isWorker = args[0] === "--worker" || args[0] === "--cancel-worker";
	const cancel = args[0] === "--cancel-worker";
	if (isWorker) args.shift();
	const [input, destination, start] = args;
	assert(
		input && destination && start !== undefined,
		"Expected local-video, fresh-output-directory, first-frame"
	);
	const source = path.resolve(input);
	const output = path.resolve(destination);
	const firstFrame = Number(start);
	if (isWorker) return worker({ source, output, firstFrame, cancel });
	await mkdir(output);
	const identityArgs = { bundlePath: process.argv[1], repoRoot: process.cwd() };
	const identity = await capturePortraitAuditIdentity(identityArgs);
	const provenance = {
		identity,
		unchangedAtEnd: false,
		error: null as string | null,
	};
	const provenancePath = path.join(output, "provenance.json");
	await json({ file: provenancePath, value: provenance });
	const controller = new AbortController();
	const stop = () => controller.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	const run = async ({
		mode,
		timeoutMs,
	}: {
		mode: string;
		timeoutMs: number;
	}) => {
		const temp = await mkdtemp(path.join(output, "owned-worker-tmp-"));
		try {
			return await runBoundedPortraitWorker({
				command: process.execPath,
				args: [process.argv[1], mode, source, output, String(firstFrame)],
				env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp },
				timeoutMs,
				abortMarker: mode === "--cancel-worker" ? CANCEL_MARKER : undefined,
				signal: controller.signal,
			});
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	};
	let summary: Record<string, unknown> & { passed: boolean } = {
		passed: false,
		output,
		lease: process.env.QCUT_PORTRAIT_NATIVE_LEASE,
		nativeAbortApi: false,
	};
	try {
		const sequence = await run({ mode: "--worker", timeoutMs: 480_000 });
		summary.sequence = sequence;
		await json({
			file: path.join(output, "supervisor.json"),
			value: { passed: false, sequence },
		});
		process.stdout.write(sequence.stdout);
		process.stderr.write(sequence.stderr);
		assert(sequence.processGroupGone, "Sequence left child processes alive");
		if (sequence.reason || controller.signal.aborted)
			throw new Error(`Sequence stopped: ${sequence.reason}`);
		const cancellation = await run({
			mode: "--cancel-worker",
			timeoutMs: 90_000,
		});
		const cancellationPassed =
			cancellation.reason === "abort-marker" && cancellation.processGroupGone;
		const passed = sequence.code === 0 && cancellationPassed;
		summary = {
			...summary,
			passed,
			cancellation,
			cancellationPassed,
			processGroupsGone:
				sequence.processGroupGone && cancellation.processGroupGone,
		};
	} catch (cause) {
		summary.error = String(cause);
	} finally {
		process.removeListener("SIGINT", stop);
		process.removeListener("SIGTERM", stop);
		summary = await finalizePortraitAuditAcceptance({
			output,
			identity,
			summary,
			captureIdentity: () => capturePortraitAuditIdentity(identityArgs),
		});
	}
	console.log(
		JSON.stringify({
			passed: summary.passed,
			output,
			cancellationPassed: summary.cancellationPassed,
			processGroupsGone: summary.processGroupsGone,
			provenanceUnchangedAtEnd: summary.provenanceUnchangedAtEnd,
			error: summary.error,
			provenanceError: summary.provenanceError,
		})
	);
	if (!summary.passed) process.exitCode = 1;
}

void main().catch((cause: unknown) => {
	console.error(cause);
	process.exitCode = 1;
});
