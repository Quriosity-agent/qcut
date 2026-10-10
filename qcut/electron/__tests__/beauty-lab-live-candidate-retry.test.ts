// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBeautyLabCandidateProvider } from "../beauty-lab/beauty-lab-candidate-provider.js";
import {
	createBeautyLabLiveJobError,
	type BeautyLabLiveJobFailureKind,
} from "../beauty-lab/beauty-lab-live-candidate-failure.js";
import { createBeautyLabLiveCandidateBackend } from "../beauty-lab-live-candidate.js";
import {
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

const RESTART = "live-static-audit-failed-restart-required";
// Dependency capture before launch can exceed vi.waitFor's 1s default on slow
// runners; let the configured test timeout be the only bound.
const JOB_START = { timeout: 30_000 };
let root: string;
let files: Awaited<ReturnType<typeof setupFiles>>;

beforeEach(async () => {
	// Reset (not just clear) so an unconsumed mockImplementationOnce from a
	// failed test cannot leak into the next one.
	vi.resetAllMocks();
	root = await realpath(
		await mkdtemp(path.join(os.tmpdir(), "qcut-static-retry-"))
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
	return {
		request: requestFor({ version: backend.version }),
		provider: createBeautyLabCandidateProvider({ backend }),
	};
}

function jobArguments({ args }: { args: string[] }) {
	return {
		directory: path.dirname(args[args.indexOf("--request") + 1]),
		lease: args[args.indexOf("--lease") + 1],
	};
}

async function writeReceipt({
	directory,
	lease,
}: {
	directory: string;
	lease: string;
}) {
	await mkdir(path.join(directory, "audit"), { recursive: true });
	await writeFile(
		path.join(directory, "audit/report.json"),
		JSON.stringify({
			passed: false,
			phase: "live-native-lldb",
			native_launch_lease: lease,
			dependencies_unchanged: true,
			failures: [{ phase: "live-native-lldb", error: "cancelled" }],
			cleanup: {
				completed: true,
				failures: [],
				roots: [{ pid: 7, reaped: true }],
			},
		})
	);
}

function failingJob({
	kind,
	forced = false,
	receipt = "matching",
	afterReceipt = async () => {},
	waitForAbort = false,
}: {
	kind: BeautyLabLiveJobFailureKind;
	forced?: boolean;
	receipt?: "matching" | "other-lease" | "none";
	afterReceipt?: () => Promise<void>;
	waitForAbort?: boolean;
}) {
	return async ({ args, signal }: { args: string[]; signal: AbortSignal }) => {
		if (waitForAbort && !signal.aborted)
			await new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), { once: true })
			);
		const { directory, lease } = jobArguments({ args });
		if (receipt !== "none")
			await writeReceipt({
				directory,
				lease: receipt === "matching" ? lease : "beauty-lab-static:other",
			});
		await afterReceipt();
		throw createBeautyLabLiveJobError({
			message: `Live candidate job ${kind}`,
			kind,
			forced,
		});
	};
}

describe("cancelling the running static audit", () => {
	it("cancels a running job and keeps the backend usable after clean cleanup", async () => {
		const { provider, request } = await fixture();
		mocks.run.mockImplementationOnce(
			failingJob({ kind: "cancelled", waitForAbort: true })
		);
		const pending = provider.render({ request });
		await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce(), JOB_START);
		expect(
			provider.cancel({ request: { requestId: request.requestId } })
		).toEqual({ cancelled: true });
		expect((mocks.run.mock.calls[0][0].signal as AbortSignal).aborted).toBe(
			true
		);
		await expect(pending).rejects.toThrow(/cancelled/);
		expect(provider.inspect()).toMatchObject({
			available: true,
			state: "ready",
			blockers: [],
		});
		await expect(provider.render({ request })).resolves.toHaveProperty(
			"scope",
			"audited-single-static-frame"
		);
		expect(mocks.run).toHaveBeenCalledTimes(2);
	});
	it("cancels during preparation without launching a job", async () => {
		const { provider, request } = await fixture();
		const pending = provider.render({ request });
		expect(
			provider.cancel({ request: { requestId: request.requestId } })
		).toEqual({ cancelled: true });
		await expect(pending).rejects.toThrow(/cancelled/);
		expect(mocks.run).not.toHaveBeenCalled();
		expect(provider.inspect().available).toBe(true);
	});
	it("latches a cancellation that needed SIGKILL", async () => {
		const { provider, request } = await fixture();
		mocks.run.mockImplementationOnce(
			failingJob({ kind: "cancelled", forced: true, waitForAbort: true })
		);
		const pending = provider.render({ request });
		await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce(), JOB_START);
		provider.cancel({ request: { requestId: request.requestId } });
		await expect(pending).rejects.toThrow(/cancelled/);
		expect(provider.inspect().blockers).toContain(RESTART);
		await expect(provider.render({ request })).rejects.toThrow(RESTART);
		expect(mocks.run).toHaveBeenCalledOnce();
	});
});

describe("retrying after a failed static audit", () => {
	it("allows a retry after a self-reported failure with a clean receipt", async () => {
		const { provider, request } = await fixture();
		mocks.run.mockImplementationOnce(failingJob({ kind: "exit-code" }));
		await expect(provider.render({ request })).rejects.toThrow(/exit-code/);
		expect(provider.inspect().available).toBe(true);
		await expect(provider.render({ request })).resolves.toHaveProperty(
			"scope",
			"audited-single-static-frame"
		);
	});
	it.each([
		{ name: "no receipt", options: { kind: "exit-code", receipt: "none" } },
		{
			name: "another job's receipt",
			options: { kind: "exit-code", receipt: "other-lease" },
		},
		{ name: "a timeout", options: { kind: "timeout" } },
		{ name: "a signal death", options: { kind: "exit-signal" } },
	] as const)("latches $name", async ({ options }) => {
		const { provider, request } = await fixture();
		mocks.run.mockImplementationOnce(failingJob(options));
		await expect(provider.render({ request })).rejects.toThrow();
		expect(provider.inspect()).toMatchObject({
			available: false,
			blockers: [RESTART],
		});
		expect(mocks.run).toHaveBeenCalledOnce();
	});
	it("latches when a dependency changed despite a clean receipt", async () => {
		const { provider, request } = await fixture();
		mocks.run.mockImplementationOnce(
			failingJob({
				kind: "exit-code",
				afterReceipt: () =>
					writeFile(
						path.join(files.runtime, "Frameworks/liblens.dylib"),
						"changed during the failed audit"
					),
			})
		);
		await expect(provider.render({ request })).rejects.toThrow(/exit-code/);
		expect(provider.inspect().blockers).toContain(RESTART);
	});
});
