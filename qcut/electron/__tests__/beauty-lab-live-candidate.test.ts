// @vitest-environment node
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rm,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBeautyLabCandidateProvider } from "../beauty-lab/beauty-lab-candidate-provider.js";
import { beautyLabCandidateIdentity } from "../beauty-lab/beauty-lab-candidate-request.js";
import { createBeautyLabLiveCandidateBackend } from "../beauty-lab-live-candidate.js";
import {
	createBeautyLabLiveSelectionResolver,
	selectBeautyLabLiveRequest,
} from "../beauty-lab-live-selection.js";
import { pinRoot } from "../beauty-lab-research-files.js";
import { JIANYING_PORTRAIT_PACKAGE_IDENTITIES } from "../jianying-portrait-adjustment-runtime/catalog.js";
import {
	JOB_SCRIPT,
	LOCAL,
	OPT_IN,
	requestFor,
	setupFiles,
	successfulJob,
} from "./beauty-lab-live-candidate-fixture.js";

const mocks = vi.hoisted(() => ({
	run: vi.fn(),
	installed: vi.fn(),
	current: vi.fn(),
	resolve: vi.fn(),
	makeup: vi.fn(),
}));
vi.mock("../beauty-lab-live-candidate-process.js", () => ({
	runBeautyLabLiveCandidateJob: mocks.run,
}));
vi.mock("../jianying-filter-local-runtime/private-runtime.js", () => ({
	hasJianyingFilterPrivateRuntime: mocks.installed,
	jianyingFilterPrivateRuntimeCurrent: mocks.current,
}));
vi.mock("../jianying-portrait-adjustment-runtime/package-resolver.js", () => ({
	resolveJianyingPortraitPackage: mocks.resolve,
}));
vi.mock("../jianying-portrait-adjustment-runtime/makeup-resolver.js", () => ({
	resolveJianyingPortraitMakeupCard: mocks.makeup,
}));

// Dependency capture before launch can exceed vi.waitFor's 1s default on slow
// runners; let the configured test timeout be the only bound.
const JOB_START = { timeout: 30_000 };
let root: string;
let files: Awaited<ReturnType<typeof setupFiles>>;
beforeEach(async () => {
	vi.clearAllMocks();
	root = await realpath(
		await mkdtemp(path.join(os.tmpdir(), "qcut-static-contract-"))
	);
	files = await setupFiles({ root });
	mocks.current.mockReturnValue(files.runtime);
	mocks.installed.mockResolvedValue(true);
	mocks.resolve.mockResolvedValue({
		runtimePackage: "features",
		group: "face",
		source: "qcut-private",
		packagePath: files.packagePath,
	});
	mocks.run.mockImplementation(successfulJob);
});
afterEach(async () => {
	vi.restoreAllMocks();
	await rm(root, { recursive: true, force: true });
});

async function fixture() {
	const backend = await createBeautyLabLiveCandidateBackend({
		sourceRoot: root,
		isPackaged: false,
		platform: "darwin",
		arch: "arm64",
		env: OPT_IN,
	});
	if (!backend) throw new Error("Synthetic backend should be available");
	const request = requestFor({ version: backend.version });
	return {
		backend,
		request,
		provider: createBeautyLabCandidateProvider({ backend }),
	};
}

describe("development static candidate registration (synthetic jobs only)", () => {
	it("disposal during an active job waits and never publishes cancelled pixels", async () => {
		const { backend, provider, request } = await fixture();
		let close = () => {};
		mocks.run.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					close = resolve;
				})
		);
		const pending = expect(provider.render({ request })).rejects.toThrow(
			/cancelled/
		);
		await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce(), JOB_START);
		const signal = mocks.run.mock.calls[0][0].signal as AbortSignal;
		let finished = false;
		const disposal = provider.dispose().then(() => {
			finished = true;
		});
		await Promise.resolve();
		expect(signal.aborted).toBe(true);
		expect(finished).toBe(false);
		expect(provider.inspect().available).toBe(false);
		await expect(
			backend.render({ ...request, ...beautyLabCandidateIdentity({ request }) })
		).rejects.toThrow(/disposed/);
		close();
		await pending;
		await disposal;
		expect(finished).toBe(true);
	});
	it("disposal before job preparation prevents a process launch", async () => {
		const { provider, request } = await fixture();
		const pending = expect(provider.render({ request })).rejects.toThrow(
			/cancelled/
		);
		await provider.dispose();
		await pending;
		expect(mocks.run).not.toHaveBeenCalled();
		await expect(provider.render({ request })).rejects.toThrow(/disposed/);
	});
	it.each([
		{ isPackaged: true },
		{ platform: "win32" as const },
		{ platform: "linux" as const },
		{ arch: "x64" },
		{ env: {} },
		{ env: { ...OPT_IN, NODE_ENV: "production" } },
		{ env: { ...OPT_IN, QCUT_BEAUTY_LAB_LIVE_CANDIDATE: "true" } },
	])("is disabled without the exact development opt-in: %j", async (patch) => {
		expect(
			await createBeautyLabLiveCandidateBackend({
				sourceRoot: "/must-not-open",
				isPackaged: false,
				platform: "darwin",
				arch: "arm64",
				env: OPT_IN,
				...patch,
			})
		).toBeUndefined();
		expect(mocks.installed).not.toHaveBeenCalled();
		expect(mocks.run).not.toHaveBeenCalled();
	});
	it("does not register when the private runtime is unavailable", async () => {
		mocks.installed.mockResolvedValue(false);
		expect(
			await createBeautyLabLiveCandidateBackend({
				sourceRoot: root,
				isPackaged: false,
				platform: "darwin",
				arch: "arm64",
				env: OPT_IN,
			})
		).toBeUndefined();
	});
	it("registers explicit static scope and retains native timing gaps", async () => {
		const { provider, request } = await fixture();
		expect(request.backendVersion).toMatch(/^audited-static-v4:[a-f0-9]{64}$/);
		expect(provider.inspect()).toMatchObject({
			available: true,
			scope: "audited-single-static-frame",
			timingScope: "cumulative-owned-worker-including-warmup",
		});
		expect(
			provider
				.inspect()
				.stages.every((stage) =>
					stage.message.includes("native full-frame RGBA")
				)
		).toBe(true);
		const result = await provider.render({ request });
		expect(result.rgba).toEqual(new Uint8Array(8).fill(42));
		expect(result.scope).toBe("audited-single-static-frame");
		expect(result.timingScope).toBe("cumulative-owned-worker-including-warmup");
		expect(result.provenance).toEqual({
			auditSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
			dependenciesSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
			workerLogSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
			workerBackendVersion: `dependency-core-v1:${"a".repeat(64)}`,
		});
		expect(
			result.stageMetrics.filter(({ durationMs }) => durationMs === null)
		).toEqual(
			["detection", "geometry", "effect-rendering"].map((id) => ({
				id,
				durationMs: null,
				unavailableReason: "native-stage-not-instrumented",
			}))
		);
		expect(mocks.resolve).toHaveBeenCalledWith({ runtimePackage: "features" });
		const call = mocks.run.mock.calls[0][0];
		expect(call.python).toBe(files.python);
		expect(call.args).toContain(files.models);
		expect(call.args).toContain(path.join(root, JOB_SCRIPT));
		const requestPath = call.args[call.args.indexOf("--request") + 1];
		expect(call.args.slice(0, 3)).toEqual([
			"-B",
			"-X",
			`pycache_prefix=${path.join(path.dirname(requestPath), "python-cache")}`,
		]);
		const job = JSON.parse(await readFile(requestPath, "utf8"));
		expect(job.parameters.face_adjust_eye).toEqual([
			{ id: -1, intensity: 0.4 },
		]);
		expect(job.requestFingerprint).toBe(result.requestFingerprint);
		expect(job).not.toHaveProperty("rgba");
		expect(job).not.toHaveProperty("adjustments");
	});
	it("creates fresh jobs and audits on every identical request", async () => {
		const { provider, request } = await fixture();
		await provider.render({ request });
		await provider.render({ request });
		const jobs = await readdir(
			path.join(root, LOCAL, "beauty-live-candidate-jobs")
		);
		expect(jobs).toHaveLength(2);
		expect(mocks.run).toHaveBeenCalledTimes(2);
		expect(mocks.run.mock.calls[0][0].args).not.toEqual(
			mocks.run.mock.calls[1][0].args
		);
	});
	it.each([
		{ enabled: false, values: { face_adjust_eye: 40 } },
		{ enabled: true, values: {} },
		{ enabled: true, values: { face_adjust_eye: 0 } },
		{ enabled: true, values: { face_adjust_eye: Number.NaN } },
		{ enabled: true, values: { face_adjust_eye: 101 } },
		{ enabled: true, values: { body_adjust_SlimBody: 40 } },
		{
			enabled: true,
			values: { face_adjust_skin_Intensity: 40 },
			skinToneResourceId: null,
		},
		{ enabled: true, values: { face_adjust_eye: 40, face_adjust_Smooth: 10 } },
		{
			enabled: true,
			values: { face_adjust_eye: 40 },
			faceTarget: { mode: "single", faceId: 0 },
		},
		{ enabled: true, values: { face_adjust_eye: 40 }, faces: [{}] },
		{
			enabled: true,
			values: { face_adjust_eye: 40 },
			makeup: { lipstick: {} },
		},
		{ enabled: true, values: { face_adjust_eye: 40 }, manualRetouch: {} },
		{ enabled: true, values: { face_adjust_eye: 40 }, ignored: undefined },
		{
			enabled: true,
			values: {},
			makeup: {
				lip: { cardId: "lip-soft-pink", intensity: 40, path: "/forged" },
			},
		},
		{
			enabled: true,
			values: { face_adjust_eye: 40 },
			manualBody: { zoom: {} },
		},
	])("rejects unsupported controls before any spawn: %j", async (adjustments) => {
		const { backend, request } = await fixture();
		const changed = { ...request, adjustments } as typeof request;
		await expect(
			backend.render({
				...changed,
				...beautyLabCandidateIdentity({ request: changed }),
			})
		).rejects.toThrow();
		expect(mocks.run).not.toHaveBeenCalled();
		expect(mocks.resolve).not.toHaveBeenCalled();
		expect(mocks.makeup).not.toHaveBeenCalled();
	});
	it.each([
		{ sourcePreRoll: undefined },
		{ packagePath: "/forged" },
		{
			adjustments: {
				enabled: true,
				values: { face_adjust_eye: 40 },
				ignored: undefined,
			},
		},
		{
			adjustments: {
				enabled: true,
				values: { face_adjust_eye: 40 },
				faceTarget: { mode: "all", faceId: 0 },
			},
		},
		{
			adjustments: {
				enabled: true,
				values: {},
				makeup: {
					lip: { cardId: "lip-soft-pink", intensity: 40, path: "/forged" },
				},
			},
		},
		{
			adjustments: {
				enabled: true,
				values: { face_adjust_eye: 40 },
				manualRetouch: {},
			},
		},
		{
			adjustments: {
				enabled: true,
				values: { face_adjust_skin_Intensity: 40 },
				skinToneResourceId: null,
			},
		},
	])("rejects raw provider input before normalization can drop unsupported fields: %j", async (patch) => {
		const { provider, request } = await fixture();
		await expect(
			provider.render({ request: { ...request, ...patch } })
		).rejects.toThrow();
		expect(mocks.run).not.toHaveBeenCalled();
		expect(mocks.resolve).not.toHaveBeenCalled();
		expect(mocks.makeup).not.toHaveBeenCalled();
		expect(provider.inspect().available).toBe(true);
	});
	it.each([
		{
			label: "face",
			adjustments: { enabled: true, values: { face_adjust_TotalFace: 40 } },
		},
		{
			label: "scalar smooth",
			adjustments: { enabled: true, values: { face_adjust_Smooth: 40 } },
		},
		{
			label: "standalone makeup",
			adjustments: {
				enabled: true,
				values: {},
				makeup: { look: { cardId: "look-oxygen", intensity: 60 } },
			},
		},
		{
			label: "dynamic makeup",
			adjustments: {
				enabled: true,
				values: {},
				makeup: { lip: { cardId: "lip-soft-pink", intensity: 60 } },
			},
		},
	])("keeps per-request audit mandatory for $label", async ({
		adjustments,
	}) => {
		const { backend, provider, request } = await fixture();
		request.adjustments = adjustments;
		const selection = selectBeautyLabLiveRequest({ request });
		const runtimePackage =
			selection.kind === "numeric" ? selection.runtimePackage : "makeup";
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES[runtimePackage];
		const packagePath = path.join(
			files.runtime,
			"Cache/effect",
			identity.resourceId,
			identity.version
		);
		await mkdir(packagePath, { recursive: true });
		await writeFile(path.join(packagePath, "algorithmConfig.json"), "{}");
		mocks.resolve.mockResolvedValue({
			runtimePackage,
			group: "face",
			source: "qcut-private",
			packagePath,
		});
		if (selection.kind === "makeup") {
			const { card } = selection;
			const cardPath = path.join(
				files.runtime,
				"Cache/effect",
				card.resourceId,
				card.version
			);
			await mkdir(cardPath, { recursive: true });
			await writeFile(path.join(cardPath, "algorithmConfig.json"), "{}");
			mocks.makeup.mockResolvedValue({
				card,
				packagePath: cardPath,
				source: "qcut-private",
			});
		}
		const resolveSelection = createBeautyLabLiveSelectionResolver({
			runtimeRoot: await pinRoot({ root: files.runtime }),
		});
		const expected = await resolveSelection({ selection });
		const result = await provider.render({ request });
		expect(result.scope).toBe("audited-single-static-frame");
		expect(backend.stages[0].message).toContain(
			"unverified requests fail closed"
		);
		const { args } = mocks.run.mock.calls[0][0] as { args: string[] };
		expect(args[args.indexOf("--package") + 1]).toBe(expected.packagePath);
		const job = JSON.parse(
			await readFile(args[args.indexOf("--request") + 1], "utf8")
		);
		expect(job.parameters).toEqual(expected.parameters);
		if (expected.additionalPackagePath) {
			expect(args[args.indexOf("--additional-package") + 1]).toBe(
				expected.additionalPackagePath
			);
		} else {
			expect(args).not.toContain("--additional-package");
		}
		mocks.run.mockImplementation(async (jobArgs) => {
			const row = await successfulJob(jobArgs);
			await writeFile(
				path.join(row.directory, "audit/report.json"),
				JSON.stringify({ ...row.audit, live_callback_handoff_verified: false })
			);
		});
		await expect(provider.render({ request })).rejects.toThrow();
		expect(provider.inspect().blockers).toContain(
			"live-static-audit-failed-restart-required"
		);
		expect(mocks.run).toHaveBeenCalledTimes(2);
	});
	it.each([
		{ optIn: undefined, disabled: undefined, allowed: false },
		{ optIn: "true", disabled: undefined, allowed: false },
		{ optIn: "1", disabled: "1", allowed: false },
		{ optIn: "1", disabled: undefined, allowed: true },
	])("gates normal cache fallback explicitly: %j", async ({
		optIn,
		disabled,
		allowed,
	}) => {
		vi.spyOn(os, "homedir").mockReturnValue(root);
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES.features;
		const packagePath = path.join(
			root,
			"Movies/JianyingPro/User Data/Cache/effect",
			identity.resourceId,
			identity.version
		);
		await mkdir(packagePath, { recursive: true });
		await writeFile(path.join(packagePath, "algorithmConfig.json"), "{}");
		mocks.resolve.mockResolvedValue({
			runtimePackage: "features",
			group: "face",
			source: "jianying-installation",
			packagePath,
		});
		const backend = await createBeautyLabLiveCandidateBackend({
			sourceRoot: root,
			isPackaged: false,
			platform: "darwin",
			arch: "arm64",
			env: {
				...OPT_IN,
				QCUT_BEAUTY_LAB_LIVE_ALLOW_PRODUCT_CACHE: optIn,
				QCUT_JIANYING_DISABLE_USER_CACHE: disabled,
			},
		});
		if (!backend) throw new Error("Missing synthetic backend");
		const provider = createBeautyLabCandidateProvider({ backend });
		const pending = provider.render({
			request: requestFor({ version: backend.version }),
		});
		if (allowed) {
			await expect(pending).resolves.toHaveProperty(
				"scope",
				"audited-single-static-frame"
			);
			return;
		}
		await expect(pending).rejects.toThrow(/disabled/);
		expect(mocks.run).not.toHaveBeenCalled();
	});
	it("allows test mode and empty UI metadata/zero-valued unrelated defaults", async () => {
		const backend = await createBeautyLabLiveCandidateBackend({
			sourceRoot: root,
			isPackaged: false,
			platform: "darwin",
			arch: "arm64",
			env: { ...OPT_IN, NODE_ENV: "test" },
		});
		if (!backend) throw new Error("Local test backend unavailable");
		const request = requestFor({ version: backend.version });
		request.adjustments = {
			...request.adjustments,
			faces: [],
			makeup: {},
			manualBody: {},
			manualRetouch: { strokes: [] },
			values: {
				face_adjust_eye: 40,
				face_adjust_Smooth: 0,
				body_adjust_SlimBody: 0,
			},
		};
		const provider = createBeautyLabCandidateProvider({ backend });
		await expect(provider.render({ request })).resolves.toHaveProperty(
			"scope",
			"audited-single-static-frame"
		);
	});
	it("rejects forged identity before native work", async () => {
		const { backend, request } = await fixture();
		await expect(
			backend.render({
				...request,
				...beautyLabCandidateIdentity({ request }),
				inputSha256: "0".repeat(64),
			})
		).rejects.toThrow(/identity/);
		expect(mocks.run).not.toHaveBeenCalled();
	});
	it("rejects changed runner source, without rewriting or falling back", async () => {
		const { provider, request } = await fixture();
		await writeFile(path.join(root, JOB_SCRIPT), "changed");
		await expect(provider.render({ request })).rejects.toThrow(/changed/);
		expect(mocks.run).not.toHaveBeenCalled();
	});
	it.each([
		"model",
		"runtime",
		"package",
	])("rejects changed %s bytes during the job", async (kind) => {
		const { provider, request } = await fixture();
		mocks.run.mockImplementation(async (args) => {
			await successfulJob(args);
			const target =
				kind === "model"
					? path.join(files.models, "align-120/artifacts/model.onnx")
					: kind === "runtime"
						? path.join(files.runtime, "Frameworks/liblens.dylib")
						: path.join(files.packagePath, "algorithmConfig.json");
			await writeFile(target, "changed after native audit");
		});
		await expect(provider.render({ request })).rejects.toThrow(
			/inventory changed/
		);
		expect(provider.inspect().available).toBe(false);
	});
	it.each([
		"timeout",
		"cleanup deadline exceeded",
		"unknown process failure",
	])("latches %s until a new backend is created", async (failure) => {
		const { provider, request } = await fixture();
		mocks.run.mockRejectedValueOnce(new Error(failure));
		await expect(provider.render({ request })).rejects.toThrow(failure);
		expect(provider.inspect()).toMatchObject({
			available: false,
			state: "blocked",
			blockers: ["live-static-audit-failed-restart-required"],
		});
		await expect(provider.render({ request })).rejects.toThrow(
			/restart-required/
		);
		expect(mocks.run).toHaveBeenCalledOnce();
		const fresh = await fixture();
		await expect(
			fresh.provider.render({ request: fresh.request })
		).resolves.toHaveProperty("scope", "audited-single-static-frame");
	});
	it.each([
		"cache",
		"outside",
		"sibling-prefix",
		"symlink",
	])("rejects %s package resolution before launch", async (kind) => {
		const { provider, request } = await fixture();
		let packagePath = files.packagePath;
		if (kind === "outside") packagePath = files.models;
		if (kind === "sibling-prefix") {
			packagePath = `${files.runtime}-outside`;
			await mkdir(packagePath);
		}
		if (kind === "symlink") {
			await rm(files.packagePath, { recursive: true });
			await symlink(files.models, files.packagePath);
		}
		mocks.resolve.mockResolvedValue({
			group: "face",
			runtimePackage: "features",
			source: kind === "cache" ? "jianying-installation" : "qcut-private",
			packagePath,
		});
		await expect(provider.render({ request })).rejects.toThrow();
		expect(mocks.run).not.toHaveBeenCalled();
	});
	it.each([
		"missing",
		"hash",
		"oversized",
		"symlink",
	])("requires real bounded baseline bytes: %s", async (kind) => {
		const { provider, request } = await fixture();
		mocks.run.mockImplementation(async (args) => {
			const row = await successfulJob(args);
			const baseline = path.join(row.directory, "audit/baseline/frame-00.rgba");
			if (kind === "missing" || kind === "symlink") await rm(baseline);
			if (kind === "hash") await writeFile(baseline, new Uint8Array(8));
			if (kind === "oversized") await truncate(baseline, 17 * 1024 ** 2);
			if (kind === "symlink")
				await symlink(path.join(row.directory, "candidate.rgba"), baseline);
		});
		await expect(provider.render({ request })).rejects.toThrow();
		expect(provider.inspect().available).toBe(false);
	});
	it.each([
		"requestId",
		"requestFingerprint",
		"inputSha256",
		"sourceKey",
		"backendVersion",
		"scope",
		"timingScope",
	])("rejects altered result %s", async (key) => {
		const { provider, request } = await fixture();
		mocks.run.mockImplementation(async (args) => {
			const row = await successfulJob(args);
			await writeFile(
				path.join(row.directory, "result.json"),
				JSON.stringify({ ...row.result, [key]: "changed" })
			);
		});
		await expect(provider.render({ request })).rejects.toThrow();
	});
	it.each([
		"hash",
		"identity",
		"count",
	])("rejects mismatched worker receipt %s", async (kind) => {
		const { provider, request } = await fixture();
		mocks.run.mockImplementation(async (args) => {
			const row = await successfulJob(args);
			if (kind === "hash")
				await writeFile(
					path.join(row.directory, "audit/live/worker.jsonl"),
					"altered"
				);
			if (kind === "identity")
				row.audit.callback_audit.backend_version = `dependency-core-v1:${"b".repeat(64)}`;
			if (kind === "count") row.audit.callback_audit.predictions = 1;
			await writeFile(
				path.join(row.directory, "audit/report.json"),
				JSON.stringify(row.audit)
			);
		});
		await expect(provider.render({ request })).rejects.toThrow();
		expect(provider.inspect().available).toBe(false);
	});
	it.each([
		"passed",
		"dependencies_unchanged",
		"live_callback_handoff_verified",
		"single_frame_audit",
		"cold_frame_audit",
	])("rejects failed baseline audit %s", async (key) => {
		const { provider, request } = await fixture();
		mocks.run.mockImplementation(async (args) => {
			const row = await successfulJob(args);
			await writeFile(
				path.join(row.directory, "audit/report.json"),
				JSON.stringify({ ...row.audit, [key]: false })
			);
		});
		await expect(provider.render({ request })).rejects.toThrow();
	});
	it.each([
		"hash",
		"short",
		"oversized",
		"symlink",
		"missing-audit",
		"foreign-lease",
	])("fails closed for %s outputs", async (kind) => {
		const { provider, request } = await fixture();
		mocks.run.mockImplementation(async (args) => {
			const row = await successfulJob(args);
			const output = path.join(row.directory, "candidate.rgba");
			if (kind === "hash") await writeFile(output, new Uint8Array(8));
			if (kind === "short") await truncate(output, 4);
			if (kind === "oversized") await truncate(output, 17 * 1024 ** 2);
			if (kind === "symlink") {
				await rm(output);
				await symlink(
					path.join(row.directory, "audit/live/frame-00.rgba"),
					output
				);
			}
			if (kind === "missing-audit")
				await rm(path.join(row.directory, "audit/report.json"));
			if (kind === "foreign-lease")
				await writeFile(
					path.join(row.directory, "audit/report.json"),
					JSON.stringify({ ...row.audit, native_launch_lease: "old-job" })
				);
		});
		await expect(provider.render({ request })).rejects.toThrow();
	});
});
