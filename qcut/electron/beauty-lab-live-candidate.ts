import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { BEAUTY_LAB_CANDIDATE_STAGES } from "./beauty-lab/beauty-lab-candidate-contract.js";
import type { BeautyLabCandidateBackend } from "./beauty-lab/beauty-lab-candidate-provider.js";
import {
	beautyLabCandidateIdentity,
	parseBeautyLabCandidateRequest,
} from "./beauty-lab/beauty-lab-candidate-request.js";
import { beautyLabLiveFailureAllowsRetry } from "./beauty-lab/beauty-lab-live-candidate-failure.js";
import { runBeautyLabLiveCandidateJob } from "./beauty-lab/beauty-lab-live-candidate-process.js";
import { captureBeautyLabLiveRequestDependencies } from "./beauty-lab/beauty-lab-live-candidate-inventory.js";
import { captureBeautyLabLiveDependencies } from "./beauty-lab-live-candidate-provenance.js";
import {
	LIVE_NATIVE_STAGES,
	readBeautyLabLiveCandidateResult,
} from "./beauty-lab-live-candidate-result.js";
import {
	createBeautyLabLiveSelectionResolver,
	selectBeautyLabLiveRequest,
} from "./beauty-lab-live-selection.js";
import { checkPath, pinRoot } from "./beauty-lab-research-files.js";
import {
	hasJianyingFilterPrivateRuntime,
	jianyingFilterPrivateRuntimeCurrent,
} from "./jianying-filter-local-runtime/private-runtime.js";

const LOCAL = ".local/jianying-model-pytorch";
const JOB = "research/local-model-pytorch/face_live_candidate_job.py";
const MODELS = `${LOCAL}/face-heads-20261003-stable-r2`;
const PYTHON = `${LOCAL}/face-heads-runtime122/bin/python`;
const JOBS = `${LOCAL}/beauty-live-candidate-jobs`;
const MAX_RGBA = 16 * 1024 ** 2;

export async function createBeautyLabLiveCandidateBackend({
	sourceRoot,
	isPackaged,
	platform = process.platform,
	arch = process.arch,
	env = process.env,
}: {
	sourceRoot: string;
	isPackaged: boolean;
	platform?: NodeJS.Platform;
	arch?: string;
	env?: NodeJS.ProcessEnv;
}): Promise<BeautyLabCandidateBackend | undefined> {
	if (
		isPackaged !== false ||
		platform !== "darwin" ||
		arch !== "arm64" ||
		!["development", "test"].includes(env.NODE_ENV ?? "") ||
		env.QCUT_BEAUTY_LAB_LIVE_CANDIDATE !== "1"
	)
		return undefined;
	const source = await pinRoot({ root: sourceRoot });
	const snapshot = await captureBeautyLabLiveDependencies({ source });
	const python = path.join(source.canonical, PYTHON);
	await access(python, constants.X_OK);
	if (!(await hasJianyingFilterPrivateRuntime())) return undefined;
	const runtimeRoot = await pinRoot({
		root: jianyingFilterPrivateRuntimeCurrent(),
	});
	const runtime = runtimeRoot.canonical;
	const resolveSelection = createBeautyLabLiveSelectionResolver({
		runtimeRoot,
		allowProductCache:
			env.QCUT_BEAUTY_LAB_LIVE_ALLOW_PRODUCT_CACHE === "1" &&
			env.QCUT_JIANYING_DISABLE_USER_CACHE !== "1",
	});
	const models = await realpath(path.join(source.canonical, MODELS));
	const version = `audited-static-v4:${snapshot.digest}`;
	let disposed = false;
	let blocker: string | undefined;
	let active: { controller: AbortController; done: Promise<void> } | undefined;
	return {
		version,
		getBlocker: () => blocker,
		validateRequest: ({ request }) => {
			selectBeautyLabLiveRequest({ request });
		},
		scope: "audited-single-static-frame",
		timingScope: "cumulative-owned-worker-including-warmup",
		stages: BEAUTY_LAB_CANDIDATE_STAGES.map((id) => ({
			id,
			implementation: LIVE_NATIVE_STAGES.some((name) => name === id)
				? "native"
				: "qcut",
			parity: "accepted",
			message:
				"Per-request audited single cold static frame only, with zero warmup requests; native full-frame RGBA, detection, geometry and renderer remain. Broader face/makeup selection is not package acceptance; unverified requests fail closed. No production, live-video, timeline or multi-face acceptance. Owned timings cover both internal predictions; native timings unavailable.",
		})),
		dispose: async () => {
			disposed = true;
			active?.controller.abort(new Error("Live static audit cancelled"));
			await active?.done;
		},
		cancel: () => {
			active?.controller.abort(new Error("Live static audit cancelled"));
		},
		render: async (request) => {
			if (disposed) throw new Error("Live static backend disposed");
			if (blocker) throw new Error(blocker);
			if (active) throw new Error("Live static audit is already running");
			const selection = selectBeautyLabLiveRequest({ request });
			const parsed = parseBeautyLabCandidateRequest({ request });
			const identity = beautyLabCandidateIdentity({ request: parsed });
			if (
				parsed.backendVersion !== version ||
				identity.inputSha256 !== request.inputSha256 ||
				identity.requestFingerprint !== request.requestFingerprint ||
				parsed.rgba.length > MAX_RGBA
			) {
				throw new Error("Live static request identity or RGBA budget mismatch");
			}
			const controller = new AbortController();
			let finish = () => {};
			active = {
				controller,
				done: new Promise<void>((resolve) => {
					finish = resolve;
				}),
			};
			let attempted = false;
			let job:
				| { directory: string; lease: string; verify: () => Promise<void> }
				| undefined;
			try {
				await snapshot.verify();
				controller.signal.throwIfAborted();
				const { packagePath, parameters, additionalPackagePath } =
					await resolveSelection({ selection });
				const dependencies = await captureBeautyLabLiveRequestDependencies({
					source,
					backendFiles: snapshot.files,
					runtime,
					models,
					packagePath,
					additionalPackagePath,
				});
				await mkdir(path.join(source.canonical, JOBS), {
					recursive: true,
					mode: 0o700,
				});
				const jobs = await checkPath({ root: source, relativePath: JOBS });
				const directory = await mkdtemp(path.join(jobs, "static-"));
				const lease = `beauty-lab-static:${randomUUID()}`;
				job = {
					directory,
					lease,
					verify: async () => {
						await dependencies.verify();
						await snapshot.verify();
					},
				};
				const bound = { ...parsed, ...identity };
				const {
					rgba: _rgba,
					adjustments: _adjustments,
					protocol: _protocol,
					...metadata
				} = bound;
				await writeFile(path.join(directory, "input.rgba"), parsed.rgba, {
					flag: "wx",
					mode: 0o600,
				});
				await writeFile(
					path.join(directory, "request.json"),
					JSON.stringify({ ...metadata, parameters }),
					{ flag: "wx", mode: 0o600 }
				);
				controller.signal.throwIfAborted();
				attempted = true;
				await runBeautyLabLiveCandidateJob({
					python,
					cwd: source.canonical,
					signal: controller.signal,
					args: [
						"-B",
						"-X",
						`pycache_prefix=${path.join(directory, "python-cache")}`,
						path.join(source.canonical, JOB),
						"--request",
						path.join(directory, "request.json"),
						"--runtime",
						runtime,
						"--package",
						packagePath,
						...(additionalPackagePath
							? ["--additional-package", additionalPackagePath]
							: []),
						"--root",
						models,
						"--lease",
						lease,
						"--timeout",
						"120",
					],
				});
				controller.signal.throwIfAborted();
				const result = await readBeautyLabLiveCandidateResult({
					directory,
					hostDirectory: path.join(source.canonical, LOCAL, "beauty-live-host"),
					request: bound,
					runtime,
					packagePath,
					models,
					lease,
					manifest: path.join(directory, "manifest.json"),
					parameters,
					expectedDependencies: dependencies.expected,
				});
				await dependencies.verify();
				await snapshot.verify();
				controller.signal.throwIfAborted();
				return result;
			} catch (error) {
				if (
					attempted &&
					!(job && (await beautyLabLiveFailureAllowsRetry({ error, ...job })))
				)
					blocker = "live-static-audit-failed-restart-required";
				throw error;
			} finally {
				active = undefined;
				finish();
			}
		},
	};
}
