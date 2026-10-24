// @vitest-environment node
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIndependentCoreMLInspector } from "../beauty-lab/beauty-lab-independent-coreml-inspector";
import type { createIndependentBeautyWorker } from "../beauty-lab/beauty-lab-independent-worker";

const receipt = {
	schemaVersion: 1,
	profile: "swing-coreml-v1",
	identity: {
		execution: {
			profile: "swing-coreml-v1",
			sources: "validated-current-bytes",
		},
		helper: { sourceSha256: "a".repeat(64), binarySha256: "b".repeat(64) },
		python: "3.12.9",
		hardwareModel: "Mac15,7",
	},
};
type Worker = ReturnType<typeof createIndependentBeautyWorker>;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanup.splice(0).map((dispose) => dispose()));
});

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function fixture({ execute }: { execute?: Worker["run"] } = {}) {
	const directory = await mkdtemp(path.join(os.tmpdir(), "coreml-inspector-"));
	const python = path.join(directory, "python");
	await writeFile(python, "validated executable bytes");
	const run = vi.fn<Worker["run"]>(
		execute ??
			(async ({ request }) => {
				await writeFile(request.report, JSON.stringify(receipt));
				return {};
			})
	);
	const dispose = vi.fn(async () => {});
	const createWorker = vi.fn(() => ({ run, dispose }));
	const inspector = createIndependentCoreMLInspector({
		python,
		engineRoot: directory,
		runtimeRoot: path.join(directory, "runtime"),
		createWorker,
	});
	cleanup.push(async () => {
		await inspector.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	const inspect = (
		overrides: Partial<Parameters<typeof inspector.inspect>[0]> = {}
	) =>
		inspector.inspect({
			sourceIdentity: "manifest-1",
			platform: "darwin",
			environment: { QCUT_BODY_COREML_MODEL_ROOT: "/external/models" },
			...overrides,
		});
	return { inspector, inspect, run, dispose, createWorker, directory, python };
}

describe("resident CoreML capability inspection", () => {
	it("revalidates each call through its isolated report-only worker", async () => {
		const probe = await fixture();
		const first = await probe.inspect();
		expect(await probe.inspect()).toEqual(first);
		expect(first).toMatchObject({
			available: true,
			identity: receipt.identity,
		});
		expect(probe.createWorker).toHaveBeenCalledTimes(1);
		expect(probe.createWorker).toHaveBeenCalledWith(
			expect.objectContaining({ script: "body_coreml_capability_worker.py" })
		);
		expect(probe.run).toHaveBeenCalledTimes(2);
		for (const [input] of probe.run.mock.calls) {
			expect(Object.keys(input.request)).toEqual(["report"]);
		}
		await expect(
			access(probe.run.mock.calls[0][0].request.report)
		).rejects.toThrow();
		await expect(
			access(probe.run.mock.calls[1][0].request.report)
		).rejects.toThrow();
	});

	it("binds recycling to source and actual interpreter bytes, even at the same path", async () => {
		const probe = await fixture();
		await probe.inspect();
		await probe.inspect({ sourceIdentity: "manifest-2" });
		await writeFile(probe.python, "modified executable bytes");
		await probe.inspect({ sourceIdentity: "manifest-2" });
		const identities = probe.run.mock.calls.map(
			([input]) => input.sourceIdentity
		);
		expect(new Set(identities).size).toBe(3);
	});

	it("passes current cleaned environment to the worker identity each time", async () => {
		const probe = await fixture();
		await probe.inspect();
		await probe.inspect({
			environment: {
				QCUT_BODY_COREML_MODEL_ROOT: "/external/changed",
				DYLD_INSERT_LIBRARIES: "/vendor/library",
				PYTHONPATH: "/vendor/python",
			},
		});
		const environment = probe.run.mock.calls[1][0].environment;
		expect(environment.QCUT_BODY_COREML_MODEL_ROOT).toBe("/external/changed");
		expect(environment).not.toHaveProperty("DYLD_INSERT_LIBRARIES");
		expect(environment).not.toHaveProperty("PYTHONPATH");
	});

	it("cancels a queued caller without stopping the active inspection", async () => {
		const gate = deferred();
		const probe = await fixture({
			execute: async ({ request, signal }) => {
				await gate.promise;
				signal.throwIfAborted();
				await writeFile(request.report, JSON.stringify(receipt));
				return {};
			},
		});
		const first = probe.inspect();
		await vi.waitFor(() => expect(probe.run).toHaveBeenCalledTimes(1));
		const controller = new AbortController();
		const queued = probe.inspect({ signal: controller.signal });
		const cancelled = expect(queued).rejects.toThrow("queued cancelled");
		controller.abort(new Error("queued cancelled"));
		await cancelled;
		expect(probe.run.mock.calls[0][0].signal.aborted).toBe(false);
		gate.resolve();
		expect(await first).toMatchObject({ available: true });
		expect(await probe.inspect()).toMatchObject({ available: true });
		expect(probe.run).toHaveBeenCalledTimes(2);
	});

	it("drains a cancelled active worker before removing its private directory", async () => {
		const gate = deferred();
		const closed = deferred();
		const probe = await fixture({
			execute: async ({ request, signal }) => {
				signal.addEventListener("abort", gate.resolve, { once: true });
				await gate.promise;
				await access(path.dirname(request.report));
				await closed.promise;
				signal.throwIfAborted();
				return {};
			},
		});
		const controller = new AbortController();
		const pending = probe.inspect({ signal: controller.signal });
		const cancelled = expect(pending).rejects.toThrow("active cancelled");
		await vi.waitFor(() => expect(probe.run).toHaveBeenCalledTimes(1));
		controller.abort(new Error("active cancelled"));
		await gate.promise;
		await access(path.dirname(probe.run.mock.calls[0][0].request.report));
		closed.resolve();
		await cancelled;
		await expect(
			access(path.dirname(probe.run.mock.calls[0][0].request.report))
		).rejects.toThrow();
	});

	it("surfaces failed validation and revalidates the next request", async () => {
		const probe = await fixture();
		probe.run.mockRejectedValueOnce(new Error("model content mismatch"));
		expect(await probe.inspect()).toMatchObject({
			available: false,
			message: expect.stringContaining("content mismatch"),
		});
		expect(await probe.inspect()).toMatchObject({ available: true });
		expect(probe.run).toHaveBeenCalledTimes(2);
	});

	it("rejects oversized or generation-dependent receipts", async () => {
		const probe = await fixture();
		probe.run.mockImplementationOnce(async ({ request }) => {
			await writeFile(request.report, "x".repeat(65_537));
			return {};
		});
		expect(await probe.inspect()).toMatchObject({
			available: false,
			message: expect.stringContaining("budget"),
		});
		probe.run.mockImplementationOnce(async ({ request }) => {
			await writeFile(
				request.report,
				JSON.stringify({
					...receipt,
					identity: {
						...receipt.identity,
						execution: {
							...receipt.identity.execution,
							generation: "forbidden",
						},
					},
				})
			);
			return {};
		});
		expect(await probe.inspect()).toMatchObject({
			available: false,
			message: expect.stringContaining("generation"),
		});
	});

	it("does not spawn for unsupported hosts and cannot restart after disposal", async () => {
		const probe = await fixture();
		expect(await probe.inspect({ platform: "linux" })).toMatchObject({
			available: false,
		});
		expect(probe.run).not.toHaveBeenCalled();
		await probe.inspector.dispose();
		await expect(probe.inspect()).rejects.toThrow("disposed");
	});
});
