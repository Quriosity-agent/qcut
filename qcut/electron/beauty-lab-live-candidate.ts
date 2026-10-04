import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { BEAUTY_LAB_CANDIDATE_STAGES } from "./beauty-lab-candidate-contract.js";
import type { BeautyLabCandidateBackend } from "./beauty-lab-candidate-provider.js";
import {
	beautyLabCandidateIdentity,
	parseBeautyLabCandidateRequest,
} from "./beauty-lab-candidate-request.js";
import { runBeautyLabLiveCandidateJob } from "./beauty-lab-live-candidate-process.js";
import { captureBeautyLabLiveDependencies } from "./beauty-lab-live-candidate-provenance.js";
import {
	LIVE_NATIVE_STAGES,
	readBeautyLabLiveCandidateResult,
} from "./beauty-lab-live-candidate-result.js";
import { checkPath, pinRoot } from "./beauty-lab-research-files.js";
import {
	hasJianyingFilterPrivateRuntime,
	jianyingFilterPrivateRuntimeCurrent,
} from "./jianying-filter-local-runtime/private-runtime.js";
import {
	buildJianyingPortraitFeatureParameters,
	jianyingPortraitControl,
	jianyingPortraitRuntimePackageForControl,
} from "./jianying-portrait-adjustment-runtime/catalog.js";
import { resolveJianyingPortraitPackage } from "./jianying-portrait-adjustment-runtime/package-resolver.js";

const LOCAL = ".local/jianying-model-pytorch";
const JOB = "research/local-model-pytorch/face_live_candidate_job.py";
const MODELS = `${LOCAL}/face-heads-20261003-stable-r2`;
const PYTHON = `${LOCAL}/face-heads-runtime122/bin/python`;
const JOBS = `${LOCAL}/beauty-live-candidate-jobs`;
const PACKAGE =
	"Cache/effect/7408077472211668276/f662ff9c955ee319f1ae03b2aa27df76";
const MAX_RGBA = 16 * 1024 ** 2;

function parametersForRequest({
	request,
}: {
	request: Parameters<BeautyLabCandidateBackend["render"]>[0];
}) {
	const { adjustments } = request;
	const unsupported = Object.entries(adjustments).some(([key, value]) => {
		if (
			["enabled", "values", "faceTarget"].includes(key) ||
			value === undefined
		)
			return false;
		if (key === "faces") return !Array.isArray(value) || value.length > 0;
		if (key === "makeup" || key === "manualBody")
			return (
				!value || typeof value !== "object" || Object.keys(value).length > 0
			);
		if (
			key === "manualRetouch" &&
			value &&
			typeof value === "object" &&
			"strokes" in value
		) {
			return (
				Object.keys(value).length !== 1 ||
				!Array.isArray(value.strokes) ||
				value.strokes.length > 0
			);
		}
		return true;
	});
	if (
		!adjustments.enabled ||
		unsupported ||
		(adjustments.faceTarget !== undefined &&
			adjustments.faceTarget.mode !== "all") ||
		"sourcePreRoll" in request
	) {
		throw new Error(
			"Live static candidate accepts global numeric face controls only"
		);
	}
	const controls = Object.entries(adjustments.values).map(([key, value]) => {
		const control = jianyingPortraitControl({ key });
		if (
			!control ||
			(value !== 0 && control.group !== "face") ||
			typeof value !== "number" ||
			!Number.isFinite(value) ||
			value < control.min ||
			value > control.max
		) {
			throw new Error("Unsupported live static face control");
		}
		const runtimePackage = jianyingPortraitRuntimePackageForControl({
			control,
		});
		if (value !== 0 && runtimePackage !== "features") {
			throw new Error("Only the audited features package is supported");
		}
		return { runtimePackage, value };
	});
	const active = controls.filter(({ value }) => value !== 0);
	const packages = new Set(active.map(({ runtimePackage }) => runtimePackage));
	if (packages.size !== 1 || !active.length) {
		throw new Error(
			"Exactly one nonzero face package is required for a static audit"
		);
	}
	const runtimePackage = active[0].runtimePackage;
	return {
		runtimePackage,
		parameters: JSON.parse(
			buildJianyingPortraitFeatureParameters({
				runtimePackage,
				values: adjustments.values,
			})
		) as unknown,
	};
}

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
	const models = await realpath(path.join(source.canonical, MODELS));
	const version = `audited-static-v2:${snapshot.digest}`;
	let disposed = false;
	let blocker: string | undefined;
	let active: { controller: AbortController; done: Promise<void> } | undefined;
	return {
		version,
		getBlocker: () => blocker,
		scope: "audited-single-static-frame",
		timingScope: "cumulative-owned-worker-including-warmup",
		stages: BEAUTY_LAB_CANDIDATE_STAGES.map((id) => ({
			id,
			implementation: LIVE_NATIVE_STAGES.some((name) => name === id)
				? "native"
				: "qcut",
			parity: "accepted",
			message:
				"Per-request audited single static frame only; native full-frame RGBA, detection, geometry and renderer remain. No timeline, minute-scale or multi-face acceptance. Owned timings include warmup; native timings unavailable.",
		})),
		dispose: async () => {
			disposed = true;
			active?.controller.abort(new Error("Live static audit cancelled"));
			await active?.done;
		},
		render: async (request) => {
			if (disposed) throw new Error("Live static backend disposed");
			if (blocker) throw new Error(blocker);
			if (active) throw new Error("Live static audit is already running");
			const { runtimePackage, parameters } = parametersForRequest({ request });
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
			try {
				await snapshot.verify();
				controller.signal.throwIfAborted();
				const resolved = await resolveJianyingPortraitPackage({
					runtimePackage,
				});
				if (
					!resolved.packagePath ||
					resolved.group !== "face" ||
					resolved.source !== "qcut-private" ||
					resolved.runtimePackage !== "features"
				)
					throw new Error("Trusted face package unavailable");
				const packagePath = await checkPath({
					root: runtimeRoot,
					relativePath: PACKAGE,
				});
				if ((await realpath(resolved.packagePath)) !== packagePath)
					throw new Error(
						"Resolved package differs from pinned private runtime package"
					);
				await mkdir(path.join(source.canonical, JOBS), {
					recursive: true,
					mode: 0o700,
				});
				const jobs = await checkPath({ root: source, relativePath: JOBS });
				const directory = await mkdtemp(path.join(jobs, "static-"));
				const lease = `beauty-lab-static:${randomUUID()}`;
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
						path.join(source.canonical, JOB),
						"--request",
						path.join(directory, "request.json"),
						"--runtime",
						runtime,
						"--package",
						packagePath,
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
				});
				await snapshot.verify();
				controller.signal.throwIfAborted();
				return result;
			} catch (error) {
				if (attempted) blocker = "live-static-audit-failed-restart-required";
				throw error;
			} finally {
				active = undefined;
				finish();
			}
		},
	};
}
