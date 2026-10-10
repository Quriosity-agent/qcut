// @vitest-environment node
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBeautyLabLiveCandidateResult } from "../beauty-lab/beauty-lab-live-candidate-result.js";
import { digest, setupResultJob } from "./beauty-lab-live-candidate-fixture.js";

let root: string;
let fixture: Awaited<ReturnType<typeof setupResultJob>>;

beforeEach(async () => {
	root = await realpath(
		await mkdtemp(path.join(os.tmpdir(), "qcut-cold-frame-"))
	);
	fixture = await setupResultJob({ root });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function saveAudit({
	patch = {},
}: {
	patch?: Record<string, unknown>;
} = {}) {
	await writeFile(
		path.join(fixture.input.directory, "audit/report.json"),
		JSON.stringify({ ...fixture.job.audit, ...patch })
	);
}

async function rewriteLog({
	name,
	change,
}: {
	name: "worker" | "records";
	change: ({
		rows,
	}: {
		rows: Record<string, unknown>[];
	}) => Record<string, unknown>[];
}) {
	const filename = path.join(
		fixture.input.directory,
		`audit/live/${name}.jsonl`
	);
	const rows = (await readFile(filename, "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
	const bytes = Buffer.from(
		change({ rows })
			.map((row) => JSON.stringify(row))
			.join("\n") + "\n"
	);
	await writeFile(filename, bytes);
	fixture.job.audit.artifacts[`live/${name}.jsonl`].sha256 = digest({
		data: bytes,
	});
	await saveAudit();
}

describe("cold consumer and ownership evidence", () => {
	it.each([
		"missing",
		"hash",
		"truncated",
	])("rejects %s consumer log", async (kind) => {
		const filename = path.join(
			fixture.input.directory,
			"audit/live/records.jsonl"
		);
		if (kind === "missing") await rm(filename);
		if (kind === "hash") await writeFile(filename, "{}\n");
		if (kind === "truncated") {
			const bytes = (await readFile(filename)).subarray(0, -1);
			await writeFile(filename, bytes);
			fixture.job.audit.artifacts["live/records.jsonl"].sha256 = digest({
				data: bytes,
			});
			await saveAudit();
		}
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow(/receipts/);
	});

	it.each([
		["live_owned_conversion", { source_points_unchanged: false }],
		["live_owned_conversion", { source_points_unchanged: undefined }],
		["live_owned_conversion", { candidate_source: "native-points" }],
		["live_owned_conversion", { native_analysis_bypassed: true }],
		["live_owned_conversion", { conversion_scope: "inspection" }],
		["live_owned_conversion", { prediction: 1 }],
		["live_owned_conversion", { faces: 0 }],
		["live_owned_conversion", { timestamp_us: 1 }],
		["live_owned_restored", { gpu_complete: false }],
		["live_owned_restored", { original_restored: false }],
		["live_owned_restored", { binding_id: 99 }],
		["live_owned_restored", { graph_id: 99 }],
		["live_owned_restored", { event: "live_owned_rollback" }],
		["face_clone_audit", { primary_points_isolated: false }],
		["face_clone_audit", { vector_counts: [2, 0, 0, 0, 0, 1] }],
		["algorithm_update", { external_points: true }],
	] as const)("rejects invalid %s fields %j with a matching hash", async (event, patch) => {
		await rewriteLog({
			name: "records",
			change: ({ rows }) =>
				rows.map((row) => (row.event === event ? { ...row, ...patch } : row)),
		});
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow(/receipts/);
	});

	it.each([
		"live_candidate_received",
		"live_owned_conversion",
		"live_owned_restored",
		"face_clone_audit",
	])("rejects missing %s even when summary counts still claim two", async (event) => {
		await rewriteLog({
			name: "records",
			change: ({ rows }) => rows.filter((row) => row.event !== event),
		});
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow(/receipts/);
	});
	it.each([
		"duplicate",
		"reversed",
		"unsupported",
		"detached-clones",
	])("rejects %s consumer order", async (kind) => {
		await rewriteLog({
			name: "records",
			change: ({ rows }) => {
				if (kind === "reversed") return rows.reverse();
				if (kind === "duplicate") return [...rows, ...rows];
				if (kind === "detached-clones")
					return [
						...rows.filter((row) => row.event !== "face_clone_audit"),
						...rows.filter((row) => row.event === "face_clone_audit"),
					];
				return [
					...rows,
					{ event: "live_native_fallback", renderer_consumption: true },
				];
			},
		});
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow(/receipts/);
	});

	it.each([
		"full_frame_rgba",
		"detection",
		"crop_caller_and_geometry",
		"sampling",
		"heads",
		"temporal",
		"acceptance_and_reset",
		"renderer",
		"native_analysis_bypassed",
		"live_parity_verified",
		"product_backend_registered",
	])("rejects missing or changed second-worker ownership %s", async (field) => {
		await rewriteLog({
			name: "worker",
			change: ({ rows }) =>
				rows.map((row, index) =>
					index === 0
						? row
						: {
								...row,
								stage_ownership: {
									...(row.stage_ownership as Record<string, unknown>),
									[field]: undefined,
								},
							}
				),
		});
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow(/receipts/);
	});
	it.each([
		{ native_final_point_input_used: true },
		{ captured_tensor_input_used: true },
		{ native_analysis_bypassed: true },
		{ candidate_parity_verified: true },
		{ product_parity_verified: true },
		{ arbitrary_frame_backend_connected: true },
		{ source: "native-fallback" },
		{ source_key: "foreign" },
		{ timestamp_us: 1 },
	])("rejects contradictory worker result provenance %j", async (patch) => {
		await rewriteLog({
			name: "worker",
			change: ({ rows }) =>
				rows.map((row) => ({
					...row,
					result: { ...(row.result as Record<string, unknown>), ...patch },
				})),
		});
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow(/receipts/);
	});
	it("rejects foreign worker session without exposing the token", async () => {
		await rewriteLog({
			name: "worker",
			change: ({ rows }) =>
				rows.map((row) => ({ ...row, token: "foreign-private-session-token" })),
		});
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toEqual(
			new Error("Beauty Lab research: invalid cold worker/consumer receipts")
		);
	});
	it("rejects stale clone audit basis", async () => {
		fixture.job.audit.callback_audit.clone_audit.audit_basis =
			"algorithm-update";
		await saveAudit();
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow();
	});
});

describe("request-bound dependency inventory", () => {
	it.each([
		"source",
		"model",
		"runtime-model",
		"package",
	])("rejects substituted %s bytes in report", async (kind) => {
		const directory =
			kind === "source"
				? path.join(root, "research/local-model-pytorch")
				: kind === "model"
					? fixture.files.models
					: kind === "runtime-model"
						? path.join(fixture.files.runtime, "Models")
						: fixture.files.packagePath;
		const tree = fixture.job.audit.dependencies.trees.find(
			(row) => row.directory === directory
		);
		if (!tree) throw new Error("Missing test inventory");
		tree.files[Object.keys(tree.files)[0]].sha256 = "0".repeat(64);
		await saveAudit();
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow(/inventory differs/);
	});
	it.each([
		"missing-file",
		"extra-file",
		"duplicate-tree",
		"wrong-source-flag",
		"wrong-path",
		"wrong-size",
	])("rejects %s even with a nonempty inventory", async (kind) => {
		const tree = fixture.job.audit.dependencies.trees[0];
		const [filename, file] = Object.entries(tree.files)[0];
		if (kind === "missing-file") tree.files = {};
		if (kind === "extra-file")
			tree.files[`${filename}.extra`] = {
				...file,
				identity: [`${filename}.extra`, 1, 1, 0, 0],
			};
		if (kind === "duplicate-tree")
			fixture.job.audit.dependencies.trees[1] = tree;
		if (kind === "wrong-source-flag") tree.source = !tree.source;
		if (kind === "wrong-path") file.identity[0] = "/foreign/file.py";
		if (kind === "wrong-size") file.identity[3] = 0;
		await saveAudit();
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow(/inventory differs|fingerprint path/);
	});
	it.each([
		"empty",
		"changed",
		"extra",
	])("rejects %s native library inventory", async (kind) => {
		const libraries = fixture.job.audit.dependencies.libraries;
		const [filename, file] = Object.entries(libraries)[0];
		if (kind === "empty") fixture.job.audit.dependencies.libraries = {};
		if (kind === "changed") file.sha256 = "0".repeat(64);
		if (kind === "extra")
			libraries[`${filename}.extra`] = {
				...file,
				identity: [`${filename}.extra`, 1, 1, 0, 0],
			};
		await saveAudit();
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow(/inventory differs/);
	});
	it("accepts inventory order changes without relaxing identity", async () => {
		fixture.job.audit.dependencies.trees.reverse();
		await saveAudit();
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).resolves.toHaveProperty("rgba");
	});
});

describe("cold-frame receipts (synthetic files, no native launch)", () => {
	it("accepts exactly two cold predictions and retains static scope", async () => {
		const result = await readBeautyLabLiveCandidateResult(fixture.input);
		expect(result.scope).toBe("audited-single-static-frame");
		expect(result.timingScope).toBe("cumulative-owned-worker-including-warmup");
		expect(result.rgba).toEqual(new Uint8Array(8).fill(42));
	});

	it.each([
		{ cold_frame_audit: undefined },
		{ cold_frame_audit: false },
		{ cold_frame_audit: 1 },
		{ cold_frame_audit: "true" },
		{ warmup_request_count: undefined },
		{ warmup_request_count: false },
		{ warmup_request_count: "0" },
		{ warmup_request_count: -1 },
		{ warmup_request_count: 1 },
		{ warmup_request_count: 6 },
	])("rejects missing or non-cold markers %j", async (patch) => {
		await saveAudit({ patch });
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow();
	});

	describe.each([
		"predictions",
		"conversions",
		"restorations",
	] as const)("exact %s count", (field) => {
		it.each([
			undefined,
			null,
			true,
			"2",
			0,
			1,
			3,
			14,
			2.5,
		])("rejects %j", async (value) => {
			await saveAudit({
				patch: {
					callback_audit: {
						...fixture.job.audit.callback_audit,
						[field]: value,
					},
				},
			});
			await expect(
				readBeautyLabLiveCandidateResult(fixture.input)
			).rejects.toThrow();
		});
	});

	it.each([
		undefined,
		null,
		false,
		{},
		[0],
		[1],
		[0, 1],
	])("rejects absent or nonempty bootstrap inventory %j", async (bootstrap) => {
		await saveAudit({
			patch: {
				callback_audit: {
					...fixture.job.audit.callback_audit,
					bootstrap_unrendered_predictions: bootstrap,
				},
			},
		});
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow();
	});

	it("requires the request inventory", async () => {
		await saveAudit({ patch: { requests: undefined } });
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow();
	});

	describe.each([
		"baseline",
		"live",
	] as const)("%s request inventory", (phase) => {
		it.each([
			"missing",
			"empty",
			"duplicate",
		])("rejects %s requests", async (kind) => {
			const rows = fixture.job.audit.requests[phase];
			await saveAudit({
				patch: {
					requests: {
						...fixture.job.audit.requests,
						[phase]:
							kind === "missing"
								? undefined
								: kind === "empty"
									? []
									: [...rows, ...rows],
					},
				},
			});
			await expect(
				readBeautyLabLiveCandidateResult(fixture.input)
			).rejects.toThrow();
		});

		it.each([
			{ warmup: true },
			{ warmup: undefined },
			{ warmup: 0 },
			{ id: "warmup-0" },
			{ frame: 1 },
			{ frame: false },
			{ timestamp: 0.125 },
			{ timestamp_us: 125000 },
			{ output: "frame-00.rgba" },
			{ output: "/foreign/frame-00.rgba" },
		])("rejects altered request %j", async (patch) => {
			await saveAudit({
				patch: {
					requests: {
						...fixture.job.audit.requests,
						[phase]: [{ ...fixture.job.audit.requests[phase][0], ...patch }],
					},
				},
			});
			await expect(
				readBeautyLabLiveCandidateResult(fixture.input)
			).rejects.toThrow();
		});

		it("rejects the other branch's output path", async () => {
			fixture.job.audit.requests[phase][0].output =
				fixture.job.audit.requests[
					phase === "live" ? "baseline" : "live"
				][0].output;
			await saveAudit();
			await expect(
				readBeautyLabLiveCandidateResult(fixture.input)
			).rejects.toThrow(/output binding/);
		});
	});

	it.each([
		[],
		[0],
		[0, 1, 2],
		[1, 0],
		[0, 0],
		[1, 1],
		[0, 2],
		[false, 1],
		[0, "1"],
		[0, null],
	])("rejects worker prediction inventory %j even with an updated hash", async (...predictions) => {
		const bytes = Buffer.from(
			predictions
				.map((prediction) =>
					JSON.stringify({
						ok: true,
						result: {
							backend_version: fixture.job.audit.callback_audit.backend_version,
							prediction,
						},
					})
				)
				.join("\n") + "\n"
		);
		await writeFile(
			path.join(fixture.input.directory, "audit/live/worker.jsonl"),
			bytes
		);
		fixture.job.audit.artifacts["live/worker.jsonl"].sha256 = digest({
			data: bytes,
		});
		await saveAudit();
		await expect(
			readBeautyLabLiveCandidateResult(fixture.input)
		).rejects.toThrow();
	});
});
