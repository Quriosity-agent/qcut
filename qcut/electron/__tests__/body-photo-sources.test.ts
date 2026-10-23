import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stageBodyPhotoBuild } from "../../scripts/stage-body-photo";
import {
	BODY_PHOTO_SOURCE_MANIFEST_SHA256,
	bodyPhotoPathsOverlap,
	stageBodyPhotoSources,
	verifyStagedBodyPhotoSources,
} from "../body-photo/body-photo-sources";

const project = path.resolve(__dirname, "../..");
const originalSource = path.join(project, "research/body-photo");
const sharedEngineRoot = path.join(
	project,
	"research/independent-beauty/research"
);
let temporary: string;
let sourceRoot: string;
let destinationRoot: string;

beforeEach(() => {
	temporary = mkdtempSync(
		path.join(realpathSync(tmpdir()), "qcut-body-photo-sources-")
	);
	sourceRoot = path.join(temporary, "source");
	destinationRoot = path.join(temporary, "stage");
	cpSync(originalSource, sourceRoot, { recursive: true });
});

afterEach(() => rmSync(temporary, { recursive: true, force: true }));

function stage() {
	return stageBodyPhotoSources({
		sourceRoot,
		sharedEngineRoot,
		destinationRoot,
	});
}

describe("body photo source-only assembly", () => {
	test.each([
		["C:\\repo", "D:\\temp\\stage", false],
		["C:\\repo", "C:\\repo2", false],
		["C:\\repo", "C:\\repo\\stage", true],
		["C:\\repo\\source", "C:\\repo", true],
		["C:\\repo", "c:\\REPO", true],
		["\\\\host\\share1\\repo", "\\\\host\\share2\\stage", false],
	])("classifies Windows source overlap: %s / %s", (left, right, expected) => {
		expect(bodyPhotoPathsOverlap({ left, right, pathApi: path.win32 })).toBe(
			expected
		);
	});

	test("repeated owned builds replace the source stage safely", () => {
		const first = stageBodyPhotoBuild({
			sourceRoot,
			sharedEngineRoot,
			destinationRoot,
		});
		const second = stageBodyPhotoBuild({
			sourceRoot,
			sharedEngineRoot,
			destinationRoot,
		});
		expect(second).toEqual(first);
		expect(verifyStagedBodyPhotoSources({ root: destinationRoot })).toEqual(
			second
		);
	});

	test("build replacement preserves unowned and tampered destinations", () => {
		cpSync(sourceRoot, destinationRoot, { recursive: true });
		expect(() =>
			stageBodyPhotoBuild({ sourceRoot, sharedEngineRoot, destinationRoot })
		).toThrow();
		expect(
			readFileSync(path.join(destinationRoot, "README.md"), "utf8")
		).toContain("Independent body photo");
		rmSync(destinationRoot, { recursive: true });
		stageBodyPhotoBuild({ sourceRoot, sharedEngineRoot, destinationRoot });
		const module = path.join(destinationRoot, "body/local_shape.py");
		writeFileSync(module, "# preserve tampered source for inspection\n");
		expect(() =>
			stageBodyPhotoBuild({ sourceRoot, sharedEngineRoot, destinationRoot })
		).toThrow("integrity failed");
		expect(readFileSync(module, "utf8")).toContain("preserve tampered");
	});
	test("assembles exactly107 frozen engine files and the curated app without a runtime", () => {
		const staged = stage();
		expect(staged.bodyRoot).toBe(path.join(destinationRoot, "body"));
		expect(staged.manifestSha256).toBe(BODY_PHOTO_SOURCE_MANIFEST_SHA256);
		expect(verifyStagedBodyPhotoSources({ root: destinationRoot })).toEqual(
			staged
		);
		const manifest = JSON.parse(
			readFileSync(
				path.join(staged.bodyRoot, "engine-source-manifest.json"),
				"utf8"
			)
		);
		expect(Object.keys(manifest.files)).toHaveLength(107);
		for (const [name, entry] of Object.entries(manifest.files)) {
			const pin = entry as { sha256: string };
			const bytes = readFileSync(path.join(staged.bodyRoot, name));
			expect(createHash("sha256").update(bytes).digest("hex")).toBe(pin.sha256);
		}
		expect(() =>
			readFileSync(
				path.join(destinationRoot, "runtime/body-portable/coarse.onnx")
			)
		).toThrow();
	});

	test("rejects a changed app file before creating output", () => {
		writeFileSync(
			path.join(sourceRoot, "body/region_shape.py"),
			"raise RuntimeError('tamper')\n"
		);
		expect(stage).toThrow("integrity failed");
		expect(() =>
			readFileSync(path.join(destinationRoot, "source-manifest.json"))
		).toThrow();
	});

	test("rejects a self-repaired manifest rather than trusting local hashes", () => {
		const manifestPath = path.join(sourceRoot, "source-manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		const data = Buffer.from("raise RuntimeError('tamper')\n");
		writeFileSync(path.join(sourceRoot, "body/region_shape.py"), data);
		manifest.files["body/region_shape.py"] = {
			bytes: data.length,
			sha256: createHash("sha256").update(data).digest("hex"),
		};
		writeFileSync(manifestPath, JSON.stringify(manifest));
		expect(stage).toThrow("manifest integrity failed");
	});

	test.skipIf(process.platform === "win32")(
		"rejects source symlinks even when target bytes are correct",
		() => {
			const source = path.join(sourceRoot, "body/local_shape.py");
			const saved = path.join(temporary, "saved.py");
			writeFileSync(saved, readFileSync(source));
			rmSync(source);
			symlinkSync(saved, source);
			expect(stage).toThrow("regular body photo source");
		}
	);

	test("rejects model files and unexpected source additions", () => {
		writeFileSync(
			path.join(sourceRoot, "body/private.onnx"),
			Buffer.from([0, 1, 2])
		);
		expect(stage).toThrow("Unsafe body photo source path");
	});

	test("never overwrites an existing destination", () => {
		stage();
		const marker = path.join(destinationRoot, "keep.txt");
		writeFileSync(marker, "keep");
		expect(stage).toThrow("must be fresh");
		expect(readFileSync(marker, "utf8")).toBe("keep");
	});

	test("rejects destinations inside a source tree", () => {
		expect(() =>
			stageBodyPhotoSources({
				sourceRoot,
				sharedEngineRoot,
				destinationRoot: path.join(sourceRoot, "nested"),
			})
		).toThrow("overlaps source");
	});

	test("rejects destination parent symlinks", () => {
		const link = path.join(temporary, "link");
		symlinkSync(
			temporary,
			link,
			process.platform === "win32" ? "junction" : "dir"
		);
		expect(() =>
			stageBodyPhotoSources({
				sourceRoot,
				sharedEngineRoot,
				destinationRoot: path.join(link, "new-stage"),
			})
		).toThrow("symlinks");
	});

	test("rejects tampering, extra files and missing files in a packaged stage", () => {
		stage();
		const module = path.join(destinationRoot, "body/photo_controls.py");
		const original = readFileSync(module);
		writeFileSync(module, "# tampered\n");
		expect(() =>
			verifyStagedBodyPhotoSources({ root: destinationRoot })
		).toThrow("integrity failed");
		writeFileSync(module, original);
		const extra = path.join(destinationRoot, "extra.txt");
		writeFileSync(extra, "unexpected");
		expect(() =>
			verifyStagedBodyPhotoSources({ root: destinationRoot })
		).toThrow("Unexpected or missing");
		rmSync(extra);
		rmSync(module);
		expect(() =>
			verifyStagedBodyPhotoSources({ root: destinationRoot })
		).toThrow("Unexpected or missing");
	});

	test("rejects a shared engine whose bytes differ from its frozen manifest", () => {
		const shared = path.join(temporary, "shared");
		cpSync(sharedEngineRoot, shared, {
			recursive: true,
			filter: (name) =>
				!name.includes("__pycache__") &&
				!name.endsWith(".onnx") &&
				!name.endsWith(".npz"),
		});
		writeFileSync(
			path.join(shared, "body_smart_render.py"),
			"# changed video engine\n"
		);
		expect(() =>
			stageBodyPhotoSources({
				sourceRoot,
				sharedEngineRoot: shared,
				destinationRoot,
			})
		).toThrow("integrity failed");
	});
});
