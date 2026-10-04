import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	BEAUTY_LAB_CANDIDATE_STAGES,
	type BeautyLabCandidateRequest,
} from "../beauty-lab-candidate-contract.js";
import { LIVE_NATIVE_STAGES } from "../beauty-lab-live-candidate-result.js";

export const OPT_IN = {
	NODE_ENV: "development",
	QCUT_BEAUTY_LAB_LIVE_CANDIDATE: "1",
};
export const LOCAL = ".local/jianying-model-pytorch";
export const JOB_SCRIPT =
	"research/local-model-pytorch/face_live_candidate_job.py";

export function digest({ data }: { data: Uint8Array }) {
	return createHash("sha256").update(data).digest("hex");
}

export function requestFor({
	version,
}: {
	version: string;
}): BeautyLabCandidateRequest {
	return {
		protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
		requestId: "synthetic:request-1",
		backendVersion: version,
		width: 2,
		height: 1,
		rgba: new Uint8Array([0, 1, 2, 255, 3, 4, 5, 255]),
		adjustments: { enabled: true, values: { face_adjust_eye: 40 } },
		sourceKey: "synthetic:portrait-1",
		frameNumber: 3,
		timestampSeconds: 0.125,
	};
}

export async function setupFiles({ root }: { root: string }) {
	const python = path.join(root, LOCAL, "face-heads-runtime122/bin/python");
	const models = path.join(root, LOCAL, "face-heads-20261003-stable-r2");
	const runtime = path.join(root, "synthetic-runtime");
	const hostDirectory = path.join(root, LOCAL, "beauty-live-host");
	const hostPath = path.join(hostDirectory, "live-host");
	const receiptPath = path.join(hostDirectory, "receipt.json");
	const hostBytes = Buffer.from("synthetic signed live host; never executed");
	const hostReceipt = {
		recipe: "c".repeat(64),
		sha256: digest({ data: hostBytes }),
		identity: "A".repeat(40),
		signature: {
			identifier: "com.qcut.beauty-lab.live-host",
			team: "TESTTEAM01",
			cdhash: "b".repeat(40),
			requirement:
				'identifier "com.qcut.beauty-lab.live-host" and anchor apple generic and certificate leaf[subject.CN] = "Apple Development: Synthetic Developer (TESTUSER01)" and certificate 1[field.1.2.840.113635.100.6.2.1] /* exists */',
		},
	};
	const packagePath = path.join(
		runtime,
		"Cache/effect/7408077472211668276/f662ff9c955ee319f1ae03b2aa27df76"
	);
	await Promise.all([
		mkdir(path.dirname(python), { recursive: true }),
		mkdir(models, { recursive: true }),
		mkdir(hostDirectory, { recursive: true }),
		mkdir(path.dirname(path.join(root, JOB_SCRIPT)), { recursive: true }),
		mkdir(packagePath, { recursive: true }),
		mkdir(path.join(root, "research/jianying-runtime-probe"), {
			recursive: true,
		}),
		mkdir(path.join(models, "align-120/artifacts"), { recursive: true }),
		mkdir(path.join(models, "align-160/artifacts"), { recursive: true }),
	]);
	await Promise.all([
		writeFile(python, "synthetic; never executed"),
		writeFile(hostPath, hostBytes),
		writeFile(receiptPath, JSON.stringify(hostReceipt)),
		writeFile(path.join(models, "summary.json"), "{}"),
		writeFile(
			path.join(models, "align-120/artifacts/model.onnx"),
			"synthetic120"
		),
		writeFile(
			path.join(models, "align-160/artifacts/model.onnx"),
			"synthetic160"
		),
		writeFile(
			path.join(root, "research/jianying-runtime-probe/host.mm"),
			"synthetic"
		),
		writeFile(
			path.join(root, JOB_SCRIPT),
			"# synthetic runner; never executed\n"
		),
	]);
	await chmod(python, 0o700);
	return {
		python,
		models,
		runtime,
		packagePath,
		hostDirectory,
		hostPath,
		receiptPath,
		hostReceipt,
	};
}

export async function successfulJob({
	args,
	cwd,
}: {
	args: string[];
	cwd: string;
}) {
	const argument = ({ name }: { name: string }) => args[args.indexOf(name) + 1];
	const requestPath = argument({ name: "--request" });
	const directory = path.dirname(requestPath);
	const hostDirectory = path.join(cwd, LOCAL, "beauty-live-host");
	const hostPath = path.join(hostDirectory, "live-host");
	const receiptPath = path.join(hostDirectory, "receipt.json");
	const hostBytes = await readFile(hostPath);
	const receiptBytes = await readFile(receiptPath);
	const hostReceipt = JSON.parse(receiptBytes.toString("utf8")) as Awaited<
		ReturnType<typeof setupFiles>
	>["hostReceipt"];
	const launchConfig = Buffer.from(
		JSON.stringify({ host: hostPath, token: "synthetic-private-launch-token" })
	);
	const request = JSON.parse(await readFile(requestPath, "utf8"));
	const original = await readFile(path.join(directory, "input.rgba"));
	const rgba = new Uint8Array(original).fill(42);
	const outputSha256 = digest({ data: rgba });
	const workerBackendVersion = `dependency-core-v1:${"a".repeat(64)}`;
	const workerLog = Buffer.from(
		JSON.stringify({
			ok: true,
			result: { backend_version: workerBackendVersion },
		}) + "\n"
	);
	const { parameters, ...identity } = request;
	const result = {
		...identity,
		protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
		source: "live-candidate",
		backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
		nativeDependencies: [...LIVE_NATIVE_STAGES],
		stageMetrics: BEAUTY_LAB_CANDIDATE_STAGES.map((id) =>
			LIVE_NATIVE_STAGES.some((stage) => stage === id)
				? {
						id,
						durationMs: null,
						unavailableReason: "native-stage-not-instrumented",
					}
				: { id, durationMs: 0.125 }
		),
		outputSha256,
		scope: "audited-single-static-frame",
		temporal_sequence_acceptance: false,
		full_frame_preprocessing: "native",
		native_baseline_used_as_output: false,
		audit: "audit/report.json",
		timingScope: "cumulative-owned-worker-including-warmup",
	};
	const audit = {
		schema: "face-live-bridge-probe-v1",
		passed: true,
		completed: true,
		scope: "single-frame-native-dependent-live-audit",
		single_frame_audit: true,
		temporal_sequence_acceptance: false,
		dependencies_unchanged: true,
		native_execution_performed: true,
		live_checks_completed: true,
		live_callback_handoff_verified: true,
		render_tolerance: 0,
		native_analysis_bypassed: false,
		captured_tensor_input_used: false,
		native_final_point_input_used: false,
		failures: [],
		cleanup: { completed: true, failures: [] },
		native_launch_lease: argument({ name: "--lease" }),
		runtime: argument({ name: "--runtime" }),
		package: argument({ name: "--package" }),
		root: argument({ name: "--root" }),
		width: request.width,
		height: request.height,
		manifest: path.join(directory, "manifest.json"),
		host_identity: {
			...hostReceipt,
			path: hostPath,
			reused: false,
			permission_granted_by_launcher: false,
			desktop_authorization: "manual macOS allowance; synthetic test only",
		},
		input_frames: [{ input_sha256: request.inputSha256, parameters }],
		frames: [
			{
				frame: 0,
				equal: true,
				changed_pixels: 0,
				max_delta: 0,
				sha256: outputSha256,
				native_sha256: outputSha256,
				original_difference: { changed_pixels: 2 },
			},
		],
		artifacts: {
			"live-host.snapshot": { sha256: digest({ data: hostBytes }) },
			"live-host-receipt.json": { sha256: digest({ data: receiptBytes }) },
			"lldb-config.json": { sha256: digest({ data: launchConfig }) },
			"live/worker.jsonl": { sha256: digest({ data: workerLog }) },
			"live/frame-00.rgba": { sha256: outputSha256 },
			"baseline/frame-00.rgba": { sha256: outputSha256 },
		},
		dependencies: {
			files: {
				[hostPath]: hostReceipt.sha256,
				[receiptPath]: digest({ data: receiptBytes }),
			},
			libraries: {},
			trees: [{ synthetic: true }],
		},
		callback_audit: { predictions: 1, backend_version: workerBackendVersion },
	};
	await mkdir(path.join(directory, "audit/live"), { recursive: true });
	await mkdir(path.join(directory, "audit/baseline"), { recursive: true });
	await Promise.all([
		writeFile(path.join(directory, "candidate.rgba"), rgba),
		writeFile(path.join(directory, "audit/live/frame-00.rgba"), rgba),
		writeFile(path.join(directory, "audit/baseline/frame-00.rgba"), rgba),
		writeFile(path.join(directory, "audit/live/worker.jsonl"), workerLog),
		writeFile(path.join(directory, "audit/live-host.snapshot"), hostBytes),
		writeFile(
			path.join(directory, "audit/live-host-receipt.json"),
			receiptBytes
		),
		writeFile(path.join(directory, "audit/lldb-config.json"), launchConfig),
		writeFile(path.join(directory, "audit/report.json"), JSON.stringify(audit)),
		writeFile(path.join(directory, "result.json"), JSON.stringify(result)),
	]);
	return { directory, request, result, audit };
}
