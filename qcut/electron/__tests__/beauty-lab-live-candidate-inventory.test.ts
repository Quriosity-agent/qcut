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
import { captureBeautyLabLiveRequestDependencies } from "../beauty-lab/beauty-lab-live-candidate-inventory.js";
import { pinRoot } from "../beauty-lab/beauty-lab-research-files.js";
import { digest, setupFiles } from "./beauty-lab-live-candidate-fixture.js";

vi.mock("node:path", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:path")>();
	return {
		...actual,
		default: {
			...actual.default,
			get sep() {
				return actual.default.sep;
			},
		},
	};
});

const contents = Buffer.from("synthetic nested dependency; never executed");
let root: string;
let nestedFiles: string[];
let input: Parameters<typeof captureBeautyLabLiveRequestDependencies>[0];

beforeEach(async () => {
	root = await realpath(
		await mkdtemp(path.join(os.tmpdir(), "qcut-live-inventory-"))
	);
	const files = await setupFiles({ root });
	const additionalPackagePath = path.join(root, "additional-package");
	nestedFiles = [
		path.join(root, "research/local-model-pytorch/nested/worker.py"),
		path.join(root, "research/jianying-runtime-probe/nested/host.h"),
		path.join(files.runtime, "Models/nested/detector.model"),
		path.join(files.models, "nested/model.onnx"),
		path.join(files.packagePath, "nested/effect.bin"),
		path.join(additionalPackagePath, "nested/makeup.bin"),
	];
	await Promise.all(
		nestedFiles.map(async (filename) => {
			await mkdir(path.dirname(filename), { recursive: true });
			await writeFile(filename, contents);
		})
	);
	input = {
		source: await pinRoot({ root }),
		backendFiles: { [nestedFiles[0]]: digest({ data: contents }) },
		runtime: files.runtime,
		models: files.models,
		packagePath: files.packagePath,
		additionalPackagePath,
	};
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(root, { recursive: true, force: true });
});

const pathModes = [{ windows: false }, { windows: true }];
describe.each(pathModes)("inventory paths (Windows: $windows)", ({
	windows,
}) => {
	beforeEach(() => {
		if (!windows) return;
		// Emulate native relative paths without replacing real filesystem checks.
		vi.spyOn(path, "relative").mockImplementation(path.win32.relative);
		vi.spyOn(path, "sep", "get").mockReturnValue(path.win32.sep);
	});

	it("captures nested files in all six trees and retains native absolute keys", async () => {
		const snapshot = await captureBeautyLabLiveRequestDependencies(input);
		expect(snapshot.expected.trees).toHaveLength(6);
		for (const [index, filename] of nestedFiles.entries()) {
			expect(snapshot.expected.trees[index].files[filename]).toEqual({
				sha256: digest({ data: contents }),
				size: contents.length,
			});
		}
		await expect(snapshot.verify()).resolves.toBeUndefined();
	});

	it.each([
		{ index: 0, kind: "worker source" },
		{ index: 1, kind: "native source" },
		{ index: 2, kind: "runtime model" },
		{ index: 3, kind: "owned model" },
		{ index: 4, kind: "package" },
		{ index: 5, kind: "additional package" },
	])("rejects changed nested $kind bytes", async ({ index }) => {
		const snapshot = await captureBeautyLabLiveRequestDependencies(input);
		await writeFile(nestedFiles[index], "changed dependency");
		await expect(snapshot.verify()).rejects.toThrow(/inventory changed/);
	});

	it.each([
		{ directory: false },
		{ directory: true },
	])("rejects nested symlinks (directory: $directory)", async ({
		directory,
	}) => {
		const target = directory ? path.dirname(nestedFiles[4]) : nestedFiles[4];
		await symlink(
			target,
			path.join(input.packagePath, "alias"),
			directory ? "junction" : "file"
		);
		await expect(
			captureBeautyLabLiveRequestDependencies(input)
		).rejects.toThrow(/symlink rejected/);
	});

	it.each([
		{ relativePath: "nested/../worker.py" },
		{ relativePath: "../outside.py" },
		{ relativePath: "./worker.py" },
		{ relativePath: "nested//worker.py" },
		{ relativePath: "C:/outside.py" },
	])("does not normalize unsafe relative paths: $relativePath", async ({
		relativePath,
	}) => {
		vi.spyOn(path, "relative").mockReturnValue(
			relativePath.split("/").join(path.sep)
		);
		await expect(
			captureBeautyLabLiveRequestDependencies(input)
		).rejects.toThrow(/unsafe research path/);
	});
});

it.skipIf(path.sep !== "/")(
	"rejects a literal POSIX backslash instead of treating it as a separator",
	async () => {
		await writeFile(
			path.join(root, "research/local-model-pytorch", "nested\\worker.py"),
			contents
		);
		await expect(
			captureBeautyLabLiveRequestDependencies(input)
		).rejects.toThrow(/unsafe research path/);
	}
);
