// @vitest-environment node
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageIndependentBeauty } from "../stage-independent-beauty";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(path.join(os.tmpdir(), "qcut-independent-stage-"));
	roots.push(root);
	const sourceRoot = path.join(root, "source"),
		outputRoot = path.join(root, "build", "independent-beauty");
	mkdirSync(path.join(sourceRoot, "research"), { recursive: true });
	const bytes = Buffer.from("print('owned source')\n");
	const file = {
		path: "research/owned.py",
		bytes: bytes.length,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
	writeFileSync(path.join(sourceRoot, file.path), bytes);
	function manifest({ entry = file }: { entry?: typeof file } = {}) {
		writeFileSync(
			path.join(sourceRoot, "source-manifest.json"),
			JSON.stringify({ schemaVersion: 1, files: [entry], generatedFiles: [] })
		);
	}
	manifest();
	return { sourceRoot, outputRoot, file, manifest };
}
describe("independent owned-source staging", () => {
	it("copies only verified manifest files, ignoring local runtimes and caches", () => {
		const value = fixture();
		mkdirSync(path.join(value.sourceRoot, "runtime"));
		writeFileSync(
			path.join(value.sourceRoot, "runtime", "private.dylib"),
			"private"
		);
		writeFileSync(path.join(value.sourceRoot, "untracked.py"), "dirty");
		expect(stageIndependentBeauty(value).files).toBe(1);
		expect(readdirSync(value.outputRoot).sort()).toEqual([
			"research",
			"source-manifest.json",
		]);
		expect(readFileSync(path.join(value.outputRoot, value.file.path))).toEqual(
			readFileSync(path.join(value.sourceRoot, value.file.path))
		);
	});
	it("preserves previous output if source validation fails", () => {
		const value = fixture();
		stageIndependentBeauty(value);
		writeFileSync(path.join(value.sourceRoot, value.file.path), "modified");
		expect(() => stageIndependentBeauty(value)).toThrow("hash mismatch");
		expect(
			readFileSync(path.join(value.outputRoot, value.file.path), "utf8")
		).toContain("owned source");
	});
	it("removes stale unpinned artifacts from generated output", () => {
		const value = fixture();
		stageIndependentBeauty(value);
		writeFileSync(path.join(value.outputRoot, "stale.dylib"), "stale");
		stageIndependentBeauty(value);
		expect(existsSync(path.join(value.outputRoot, "stale.dylib"))).toBe(false);
	});
	it.each([
		"../escape.py",
		"/absolute.py",
		"runtime/owned.py",
		"research/.venv/owned.py",
		"research/private.dylib",
		"research/model.bytenn",
		"research\\escape.py",
		"research/../escape.py",
		"research//owned.py",
		"C:/owned.py",
	])("rejects unsafe or non-source path %s", (name) => {
		const value = fixture();
		value.manifest({ entry: { ...value.file, path: name } });
		expect(() => stageIndependentBeauty(value)).toThrow(
			/Invalid staged source path|Private artifact/
		);
	});
	it("rejects model names even with a source-like extension", () => {
		const value = fixture();
		value.manifest({ entry: { ...value.file, path: "research/tt_face.json" } });
		expect(() => stageIndependentBeauty(value)).toThrow("Private artifact");
	});
	it("rejects duplicate manifest entries", () => {
		const value = fixture();
		writeFileSync(
			path.join(value.sourceRoot, "source-manifest.json"),
			JSON.stringify({
				schemaVersion: 1,
				files: [value.file, value.file],
				generatedFiles: [],
			})
		);
		expect(() => stageIndependentBeauty(value)).toThrow(
			"Invalid staged source path"
		);
	});
	it.skipIf(process.platform === "win32")(
		"rejects source symlinks even when target bytes match",
		() => {
			const value = fixture();
			const original = path.join(value.sourceRoot, value.file.path);
			const target = path.join(value.sourceRoot, "target.py");
			writeFileSync(target, readFileSync(original));
			rmSync(original);
			symlinkSync(target, original);
			expect(() => stageIndependentBeauty(value)).toThrow(
				"Non-regular staged source"
			);
		}
	);
	it("rejects source/output nesting before touching source", () => {
		const value = fixture();
		expect(() =>
			stageIndependentBeauty({ ...value, outputRoot: value.sourceRoot })
		).toThrow("separate");
		expect(() =>
			stageIndependentBeauty({
				...value,
				outputRoot: path.join(value.sourceRoot, "build"),
			})
		).toThrow("separate");
		expect(() =>
			stageIndependentBeauty({
				...value,
				outputRoot: path.dirname(value.sourceRoot),
			})
		).toThrow("separate");
		expect(existsSync(path.join(value.sourceRoot, value.file.path))).toBe(true);
	});
	it("rejects a correct hash with incorrect byte count", () => {
		const value = fixture();
		value.manifest({ entry: { ...value.file, bytes: value.file.bytes + 1 } });
		expect(() => stageIndependentBeauty(value)).toThrow("hash mismatch");
	});
});
