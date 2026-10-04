// @vitest-environment node
import {
	mkdtemp,
	realpath,
	rm,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureBeautyLabLiveDependencies } from "../beauty-lab-live-candidate-provenance.js";
import { pinRoot } from "../beauty-lab-research-files.js";
import { JOB_SCRIPT, setupFiles } from "./beauty-lab-live-candidate-fixture.js";

let root: string;
let files: Awaited<ReturnType<typeof setupFiles>>;
beforeEach(async () => {
	root = await realpath(
		await mkdtemp(path.join(os.tmpdir(), "qcut-static-provenance-"))
	);
	files = await setupFiles({ root });
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("static backend executing-source and ONNX identity (synthetic only)", () => {
	it.each([
		"runner",
		"native",
		"onnx",
	])("changes version and rejects stale %s bytes", async (kind) => {
		const source = await pinRoot({ root });
		const snapshot = await captureBeautyLabLiveDependencies({ source });
		const target =
			kind === "runner"
				? path.join(root, JOB_SCRIPT)
				: kind === "native"
					? path.join(root, "research/jianying-runtime-probe/host.mm")
					: path.join(files.models, "align-120/artifacts/model.onnx");
		await writeFile(target, "changed source or model bytes");
		await expect(snapshot.verify()).rejects.toThrow(/changed/);
		expect(
			(await captureBeautyLabLiveDependencies({ source })).digest
		).not.toBe(snapshot.digest);
	});
	it("rejects new executing sources while ignoring nonexecuting test additions", async () => {
		const source = await pinRoot({ root });
		const snapshot = await captureBeautyLabLiveDependencies({ source });
		await writeFile(
			path.join(root, "research/local-model-pytorch/contract_test.py"),
			"test"
		);
		await snapshot.verify();
		await writeFile(
			path.join(root, "research/local-model-pytorch/new_worker.py"),
			"worker"
		);
		await expect(snapshot.verify()).rejects.toThrow(/inventory changed/);
	});
	it("rejects source symlinks even when the target is readable", async () => {
		await symlink(
			path.join(root, JOB_SCRIPT),
			path.join(root, "research/local-model-pytorch/alias.py")
		);
		await expect(
			captureBeautyLabLiveDependencies({ source: await pinRoot({ root }) })
		).rejects.toThrow(/symlink/);
	});
	it("bounds actual model reads", async () => {
		await truncate(
			path.join(files.models, "align-160/artifacts/model.onnx"),
			32 * 1024 ** 2 + 1
		);
		await expect(
			captureBeautyLabLiveDependencies({ source: await pinRoot({ root }) })
		).rejects.toThrow(/oversized/);
	});
});
