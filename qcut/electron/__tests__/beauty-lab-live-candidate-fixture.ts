import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	BEAUTY_LAB_CANDIDATE_STAGES,
	type BeautyLabCandidateRequest,
} from "../beauty-lab/beauty-lab-candidate-contract.js";
import { LIVE_NATIVE_STAGES } from "../beauty-lab-live-candidate-result.js";
import { beautyLabCandidateIdentity } from "../beauty-lab/beauty-lab-candidate-request.js";
import {
	captureBeautyLabLiveRequestDependencies,
	type LiveExpectedDependencies,
} from "../beauty-lab-live-candidate-inventory.js";
import { captureBeautyLabLiveDependencies } from "../beauty-lab-live-candidate-provenance.js";
import { pinRoot } from "../beauty-lab-research-files.js";

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
		mkdir(path.join(runtime, "Models"), { recursive: true }),
		mkdir(path.join(runtime, "Frameworks"), { recursive: true }),
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
		writeFile(
			path.join(runtime, "Models/face.model"),
			"synthetic native model"
		),
		writeFile(path.join(packagePath, "algorithmConfig.json"), "{}"),
		...[
			"libcccreator.dylib",
			"libAGFX.dylib",
			"liblens.dylib",
			"libbytenn.dylib",
		].map((name) =>
			writeFile(
				path.join(runtime, "Frameworks", name),
				`synthetic ${name}; never loaded`
			)
		),
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
	const token = "synthetic-private-launch-token";
	const sourceKey = "synthetic-native-source";
	const workerLog = Buffer.from(
		[0, 1]
			.map((prediction) =>
				JSON.stringify({
					ok: true,
					token,
					pid: 123,
					prediction,
					timestamp_us: 0,
					stage_ownership: {
						full_frame_rgba: "native",
						detection: "native",
						crop_caller_and_geometry: "native-live-observed",
						sampling: "owned",
						heads: "owned-onnx-cpu",
						temporal: "owned",
						acceptance_and_reset: "native",
						renderer: "native-owned-clone-required",
						native_analysis_bypassed: false,
						live_parity_verified: false,
						product_backend_registered: false,
					},
					result: {
						backend_version: workerBackendVersion,
						prediction,
						frame_number: prediction,
						timestamp_us: 0,
						schema: "face-live-candidate-result-v1",
						source: "dependency-fed-research-inference",
						source_key: sourceKey,
						algorithm_rgba_sha256: request.inputSha256,
						dependency_sha256: "e".repeat(64),
						algorithm_width: request.width,
						algorithm_height: request.height,
						faces: [
							{ id: 0, points: Array.from({ length: 106 }, () => [0.5, 0.5]) },
						],
						native_final_point_input_used: false,
						captured_tensor_input_used: false,
						native_analysis_bypassed: false,
						product_parity_verified: false,
						candidate_parity_verified: false,
						arbitrary_frame_backend_connected: false,
					},
				})
			)
			.join("\n") + "\n"
	);
	const records = [0, 1].flatMap((prediction) => [
		{ event: "live_candidate_received", prediction, timestamp_us: 0 },
		{
			event: "face_clone_audit",
			distinct_buffer: true,
			initial_refcount: 0,
			owned_refcount: 1,
			source_refcount: 2,
			vector_counts: [1, 0, 0, 0, 0, 1],
			primary_metadata_equal: true,
			primary_points_isolated: true,
			native_analysis_bypassed: false,
		},
		{
			event: "live_owned_conversion",
			prediction,
			timestamp_us: 0,
			binding_id: prediction + 1,
			graph_id: 1,
			faces: 1,
			conversion_scope: "native-seek",
			source_points_unchanged: true,
			candidate_source: "fresh-worker-inference",
			native_analysis_bypassed: false,
		},
		...(prediction === 1
			? [
					{
						event: "algorithm_update",
						timestamp_us: 0,
						native_update_call: 1,
						eye_shift: 0,
						external_points: false,
					},
				]
			: []),
		{
			event: "live_owned_restored",
			prediction,
			timestamp_us: 0,
			binding_id: prediction + 1,
			graph_id: 1,
			gpu_complete: true,
			original_restored: true,
		},
	]);
	const recordsLog = Buffer.from(
		records.map((row) => JSON.stringify(row)).join("\n") + "\n"
	);
	const source = await pinRoot({ root: cwd });
	const backend = await captureBeautyLabLiveDependencies({ source });
	const dependencies = await captureBeautyLabLiveRequestDependencies({
		source,
		backendFiles: backend.files,
		runtime: argument({ name: "--runtime" }),
		models: argument({ name: "--root" }),
		packagePath: argument({ name: "--package" }),
		additionalPackagePath: args.includes("--additional-package")
			? argument({ name: "--additional-package" })
			: undefined,
	});
	const reportFiles = ({
		files,
	}: {
		files: LiveExpectedDependencies["libraries"];
	}) =>
		Object.fromEntries(
			Object.entries(files).map(([filename, file]) => [
				filename,
				{ sha256: file.sha256, identity: [filename, 1, 1, file.size, 0] },
			])
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
		cold_frame_audit: true,
		warmup_request_count: 0,
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
		source_key: sourceKey,
		token_sha256: digest({ data: Buffer.from(token) }),
		host_identity: {
			...hostReceipt,
			path: hostPath,
			reused: false,
			permission_granted_by_launcher: false,
			desktop_authorization: "manual macOS allowance; synthetic test only",
		},
		input_frames: [{ input_sha256: request.inputSha256, parameters }],
		requests: {
			baseline: [
				{
					id: "frame-00",
					frame: 0,
					warmup: false,
					timestamp: 0,
					timestamp_us: 0,
					output: path.join(directory, "audit/baseline/frame-00.rgba"),
				},
			],
			live: [
				{
					id: "frame-00",
					frame: 0,
					warmup: false,
					timestamp: 0,
					timestamp_us: 0,
					output: path.join(directory, "audit/live/frame-00.rgba"),
				},
			],
		},
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
			"live/records.jsonl": { sha256: digest({ data: recordsLog }) },
			"live/frame-00.rgba": { sha256: outputSha256 },
			"baseline/frame-00.rgba": { sha256: outputSha256 },
		},
		dependencies: {
			files: {
				[hostPath]: hostReceipt.sha256,
				[receiptPath]: digest({ data: receiptBytes }),
			},
			libraries: reportFiles({ files: dependencies.expected.libraries }),
			trees: dependencies.expected.trees.map((tree) => ({
				...tree,
				files: reportFiles({ files: tree.files }),
			})),
		},
		callback_audit: {
			predictions: 2,
			conversions: 2,
			restorations: 2,
			bootstrap_unrendered_predictions: [],
			backend_version: workerBackendVersion,
			native_pid: 123,
			clone_audit: {
				audited_clones: 2,
				primary_faces_audited: 2,
				native_update_calls: 1,
				native_analysis_bypassed: false,
				audit_basis: "live-owned-conversion",
			},
		},
	};
	await mkdir(path.join(directory, "audit/live"), { recursive: true });
	await mkdir(path.join(directory, "audit/baseline"), { recursive: true });
	await Promise.all([
		writeFile(path.join(directory, "candidate.rgba"), rgba),
		writeFile(path.join(directory, "audit/live/frame-00.rgba"), rgba),
		writeFile(path.join(directory, "audit/baseline/frame-00.rgba"), rgba),
		writeFile(path.join(directory, "audit/live/worker.jsonl"), workerLog),
		writeFile(path.join(directory, "audit/live/records.jsonl"), recordsLog),
		writeFile(path.join(directory, "audit/live-host.snapshot"), hostBytes),
		writeFile(
			path.join(directory, "audit/live-host-receipt.json"),
			receiptBytes
		),
		writeFile(path.join(directory, "audit/lldb-config.json"), launchConfig),
		writeFile(path.join(directory, "audit/report.json"), JSON.stringify(audit)),
		writeFile(path.join(directory, "result.json"), JSON.stringify(result)),
	]);
	return {
		directory,
		request,
		result,
		audit,
		expectedDependencies: dependencies.expected,
	};
}

export async function setupResultJob({ root }: { root: string }) {
	const files = await setupFiles({ root });
	const request = requestFor({
		version: `audited-static-v4:${"d".repeat(64)}`,
	});
	const bound = { ...request, ...beautyLabCandidateIdentity({ request }) };
	const directory = path.join(root, LOCAL, "beauty-live-candidate-jobs/static");
	await mkdir(directory, { recursive: true });
	const parameters = { face_adjust_eye: [{ id: -1, intensity: 0.4 }] };
	const {
		rgba,
		adjustments: _adjustments,
		protocol: _protocol,
		...metadata
	} = bound;
	const requestPath = path.join(directory, "request.json");
	await writeFile(path.join(directory, "input.rgba"), rgba);
	await writeFile(requestPath, JSON.stringify({ ...metadata, parameters }));
	const lease = "synthetic-receipt-test";
	const job = await successfulJob({
		cwd: root,
		args: [
			"--request",
			requestPath,
			"--runtime",
			files.runtime,
			"--package",
			files.packagePath,
			"--root",
			files.models,
			"--lease",
			lease,
		],
	});
	return {
		files,
		job,
		input: {
			directory,
			hostDirectory: files.hostDirectory,
			request: bound,
			runtime: files.runtime,
			packagePath: files.packagePath,
			models: files.models,
			lease,
			manifest: path.join(directory, "manifest.json"),
			parameters,
			expectedDependencies: job.expectedDependencies,
		},
	};
}
