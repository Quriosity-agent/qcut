// @vitest-environment node
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	beautyLabLiveFailureAllowsRetry,
	beautyLabLiveJobFailure,
	createBeautyLabLiveJobError,
	type BeautyLabLiveJobFailureKind,
} from "../beauty-lab/beauty-lab-live-candidate-failure.js";

const LEASE = "beauty-lab-static:synthetic-lease";
let directory: string;

beforeEach(async () => {
	directory = await realpath(
		await mkdtemp(path.join(os.tmpdir(), "qcut-live-failure-"))
	);
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

function receipt(patch: Record<string, unknown> = {}) {
	return {
		passed: false,
		phase: "live-native-lldb",
		native_launch_lease: LEASE,
		dependencies_unchanged: true,
		failures: [{ phase: "live-native-lldb", error: "KeyboardInterrupt" }],
		cleanup: {
			completed: true,
			failures: [],
			roots: [
				{ pid: 101, reaped: true },
				{ pid: 102, reaped: true },
			],
		},
		...patch,
	};
}

async function writeReceipt(value: unknown) {
	await mkdir(path.join(directory, "audit"), { recursive: true });
	await writeFile(
		path.join(directory, "audit/report.json"),
		JSON.stringify(value)
	);
}

function allows({
	kind,
	forced = false,
	verify = vi.fn(async () => {}),
	error = createBeautyLabLiveJobError({ message: "failed", kind, forced }),
}: {
	kind: BeautyLabLiveJobFailureKind;
	forced?: boolean;
	verify?: () => Promise<void>;
	error?: unknown;
}) {
	return beautyLabLiveFailureAllowsRetry({
		error,
		directory,
		lease: LEASE,
		verify,
	});
}

describe("failure classification registry", () => {
	it("keeps a plain Error with the original message", () => {
		const error = createBeautyLabLiveJobError({
			message: "Live candidate job cancelled",
			kind: "cancelled",
			forced: false,
		});
		expect(error).toEqual(new Error("Live candidate job cancelled"));
		expect(beautyLabLiveJobFailure({ error })).toEqual({
			kind: "cancelled",
			forced: false,
		});
	});
	it.each([
		new Error("look-alike"),
		"cancelled",
		undefined,
	])("does not classify foreign failures: %j", (error) => {
		expect(beautyLabLiveJobFailure({ error })).toBeUndefined();
	});
});

describe("retry without restart requires proof of clean native cleanup", () => {
	it("allows a cancelled job with a lease-bound clean receipt", async () => {
		await writeReceipt(receipt());
		const verify = vi.fn(async () => {});
		await expect(allows({ kind: "cancelled", verify })).resolves.toBe(true);
		expect(verify).toHaveBeenCalledOnce();
	});
	it("allows a self-reported audit failure with a clean receipt", async () => {
		await writeReceipt(receipt());
		await expect(allows({ kind: "exit-code" })).resolves.toBe(true);
	});
	it("allows a job that never started once dependencies verify", async () => {
		const verify = vi.fn(async () => {});
		await expect(allows({ kind: "not-started", verify })).resolves.toBe(true);
		expect(verify).toHaveBeenCalledOnce();
	});
	it.each([
		"timeout",
		"output-budget",
		"process-error",
		"exit-signal",
	] as const)("latches %s even with a clean receipt", async (kind) => {
		await writeReceipt(receipt());
		await expect(allows({ kind })).resolves.toBe(false);
	});
	it("latches a forced cancellation even with a clean receipt", async () => {
		await writeReceipt(receipt());
		await expect(allows({ kind: "cancelled", forced: true })).resolves.toBe(
			false
		);
	});
	it("latches an unclassified error", async () => {
		await writeReceipt(receipt());
		await expect(
			allows({ kind: "cancelled", error: new Error("cancelled") })
		).resolves.toBe(false);
	});
	it.each([
		{ name: "another job's lease", patch: { native_launch_lease: "other" } },
		{ name: "a passing report", patch: { passed: true } },
		{ name: "changed dependencies", patch: { dependencies_unchanged: false } },
		{
			name: "incomplete cleanup",
			patch: { cleanup: { completed: false, failures: [], roots: [] } },
		},
		{
			name: "cleanup failures",
			patch: {
				cleanup: { completed: true, failures: ["pid 101: alive"], roots: [] },
			},
		},
		{
			name: "an unreaped root",
			patch: {
				cleanup: {
					completed: true,
					failures: [],
					roots: [{ pid: 101, reaped: false }],
				},
			},
		},
		{ name: "a missing lease", patch: { native_launch_lease: null } },
	])("latches a receipt with $name", async ({ patch }) => {
		await writeReceipt(receipt(patch));
		await expect(allows({ kind: "cancelled" })).resolves.toBe(false);
	});
	it("latches when the job left no report", async () => {
		await expect(allows({ kind: "exit-code" })).resolves.toBe(false);
	});
	it("latches a symlinked report", async () => {
		const outside = path.join(directory, "outside.json");
		await writeFile(outside, JSON.stringify(receipt()));
		await mkdir(path.join(directory, "audit"));
		await symlink(outside, path.join(directory, "audit/report.json"));
		await expect(allows({ kind: "cancelled" })).resolves.toBe(false);
	});
	it("latches when dependencies changed after a clean receipt", async () => {
		await writeReceipt(receipt());
		const verify = vi.fn(async () => {
			throw new Error("inventory changed");
		});
		await expect(allows({ kind: "cancelled", verify })).resolves.toBe(false);
		await expect(allows({ kind: "not-started", verify })).resolves.toBe(false);
	});
	it("latches a malformed report", async () => {
		await mkdir(path.join(directory, "audit"));
		await writeFile(path.join(directory, "audit/report.json"), "{not json");
		await expect(allows({ kind: "cancelled" })).resolves.toBe(false);
	});
});
