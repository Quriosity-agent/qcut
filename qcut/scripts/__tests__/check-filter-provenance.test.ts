// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	checkBuildManifest,
	checkTrackedPaths,
	readTrackedPaths,
} from "../check-filter-provenance";

describe("readTrackedPaths", () => {
	const temporaryDirectories: string[] = [];

	afterEach(() => {
		for (const directory of temporaryDirectories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	function trackedRepository({
		paths,
		name = "repository",
	}: {
		paths: string[];
		name?: string;
	}) {
		const temporary = mkdtempSync(join(tmpdir(), "qcut-provenance-"));
		temporaryDirectories.push(temporary);
		const root = join(temporary, name);
		const nested = join(root, "qcut", "scripts");
		mkdirSync(nested, { recursive: true });
		execFileSync("git", ["init", "--quiet"], { cwd: root });
		const emptyBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
			cwd: root,
			input: "",
			encoding: "utf-8",
		}).trim();
		// Index-only empty blobs exercise real Git paths without private payloads.
		execFileSync("git", ["update-index", "-z", "--index-info"], {
			cwd: root,
			input: paths.map((path) => `100644 ${emptyBlob}\t${path}\0`).join(""),
		});
		return { root, nested };
	}

	it("returns no paths for an empty Git index", () => {
		const { nested } = trackedRepository({ paths: [] });
		expect(readTrackedPaths({ cwd: nested })).toEqual([]);
	});

	it("preserves portable spaces and Unicode paths from a nested directory", () => {
		const artifact = "outside qcut/\u79c1\u6709/libAGFX.dylib";
		const paths = ["qcut/docs/\u6d4b\u8bd5 guide.md", artifact];
		const { nested } = trackedRepository({
			paths,
			name: "repository \u6d4b\u8bd5",
		});
		const tracked = readTrackedPaths({ cwd: nested });
		expect(new Set(tracked)).toEqual(new Set(paths));
		expect(checkTrackedPaths(tracked)).toEqual([
			expect.objectContaining({
				rule: "no-private-framework-binary",
				subject: artifact,
			}),
		]);
	});

	it.skipIf(process.platform === "win32")(
		"preserves POSIX-only names and artifact component boundaries",
		() => {
			const forbidden = [
				"outside qcut/line\nbreak/libcccreator.dylib",
				"outside qcut/\u79c1\u6709/libAGFX.dylib",
				"outside qcut/tab\tscope/rp.db",
				'outside qcut/quoted "scope"/portrait.mlmodelc/core.bin',
				"outside qcut/.local/jianying-runtime/Frameworks/empty.txt",
			];
			const legitimate = [
				" libcccreator.dylib",
				"libcccreator.dylib ",
				"safe\nrp.db",
				"docs/line\nartistEffect/reference.md",
				"docs/back\\slash-\u6d4b\u8bd5\t\r.md",
				"outside qcut/.local/jianying-runtime-archive/README.md",
				"outside qcut/artistEffect-not/README.md",
			];
			const paths = [...forbidden, ...legitimate];
			const { nested } = trackedRepository({
				paths,
				name: "repository \u6d4b\u8bd5\n ",
			});
			const tracked = readTrackedPaths({ cwd: nested });
			expect(new Set(tracked)).toEqual(new Set(paths));
			expect(tracked).toHaveLength(paths.length);
			const violations = checkTrackedPaths(tracked);
			expect(new Set(violations.map((violation) => violation.subject))).toEqual(
				new Set(forbidden)
			);
			expect(violations).toHaveLength(forbidden.length);
		}
	);

	it("scans the whole Git root when its tracked paths exceed the old 1 MiB cap", () => {
		const bulkPaths = Array.from(
			{ length: 6000 },
			(_, index) =>
				`qcut/docs/${String(index).padStart(5, "0")}-${"x".repeat(190)}.md`
		);
		const artifact = "zz-outside-qcut/after-limit/libbytenn.so";
		const paths = [...bulkPaths, artifact];
		const { root, nested } = trackedRepository({ paths });
		const raw = execFileSync("git", ["ls-files", "-z"], {
			cwd: root,
			maxBuffer: 4 * 1024 * 1024,
		});
		expect(raw.byteLength).toBeGreaterThan(1024 * 1024);
		expect(raw.indexOf(Buffer.from(artifact))).toBeGreaterThan(1024 * 1024);
		const tracked = readTrackedPaths({ cwd: nested });
		expect(tracked).toHaveLength(paths.length);
		expect(new Set(tracked)).toEqual(new Set(paths));
		expect(checkTrackedPaths(tracked)).toEqual([
			expect.objectContaining({
				rule: "no-private-framework-binary",
				subject: artifact,
			}),
		]);
	});

	it("does not turn a Git failure into a clean empty scan", () => {
		const directory = mkdtempSync(join(tmpdir(), "qcut-provenance-no-git-"));
		temporaryDirectories.push(directory);
		expect(() => readTrackedPaths({ cwd: directory })).toThrow();
	});
});

describe("checkTrackedPaths", () => {
	it("passes legitimate interop source and research docs", () => {
		expect(
			checkTrackedPaths([
				"electron/jianying-draft-export-handler.ts",
				"electron/jianying-filter-metadata.ts",
				"apps/web/src/lib/filters/jianying-parity/film-presets.ts",
				"docs/task/jianying-filter-runtime-research/current-coverage.zh.md",
				"research/jianying-runtime-probe/filter-probe.mm",
				"resources/bin/README.md",
			])
		).toEqual([]);
	});

	it("flags a tracked private framework binary", () => {
		const violations = checkTrackedPaths([
			"electron/resources/libcccreator.dylib",
		]);
		expect(violations).toHaveLength(1);
		expect(violations[0]?.rule).toBe("no-private-framework-binary");
	});

	it("flags tracked segmentation model files in any location", () => {
		const violations = checkTrackedPaths([
			"resources/models/tt_skin_seg_v5.1.model",
			"apps/web/public/skin.mlmodelc/coremldata.bin",
			"electron/native-pipeline/weights/portrait.bytenn",
		]);
		expect(violations.map((violation) => violation.rule)).toEqual([
			"no-segmentation-model-file",
			"no-segmentation-model-file",
			"no-segmentation-model-file",
		]);
	});

	it("flags effect-package payloads and cache databases", () => {
		const violations = checkTrackedPaths([
			"fixtures/artistEffect/filter-id/v1/AmazingFeature/image/filter.png",
			"fixtures/ressdk/rp.db",
		]);
		expect(violations.map((violation) => violation.rule)).toEqual([
			"no-effect-package-payload",
			"no-effect-package-payload",
		]);
	});

	it("flags a tracked copy of the private runtime", () => {
		const violations = checkTrackedPaths([
			".local/jianying-runtime/Frameworks/libx.dylib",
		]);
		expect(
			violations.some(
				(violation) => violation.rule === "no-private-runtime-copy"
			)
		).toBe(true);
	});

	it("does not flag source files that merely mention model names", () => {
		// String mentions live inside files; only tracked file PATHS count.
		expect(
			checkTrackedPaths([
				"electron/jianying-text-runtime/runtime-discovery.ts",
				"docs/task/jianying-filter-runtime-research/model-input-boundary.zh.md",
			])
		).toEqual([]);
	});
});

describe("checkBuildManifest", () => {
	it("passes the current shape of QCut's build manifest", () => {
		expect(
			checkBuildManifest({
				files: [
					"package.json",
					{ from: "dist/electron", to: "electron" },
					"apps/web/dist/**/*",
					"!**/docs/**/*",
				],
				extraResources: [
					{ from: "resources/default-skills", to: "default-skills" },
					{ from: "electron/resources/ffmpeg", to: "ffmpeg" },
				],
			})
		).toEqual([]);
	});

	it("flags packing the research tree", () => {
		const violations = checkBuildManifest({
			extraResources: [
				{ from: "research/jianying-runtime-probe", to: "probe" },
			],
		});
		expect(violations).toHaveLength(1);
		expect(violations[0]?.rule).toBe("no-research-in-build");
	});

	it("flags packing a private local runtime", () => {
		const violations = checkBuildManifest({
			files: [".local/jianying-runtime/**/*"],
		});
		expect(violations).toHaveLength(1);
		expect(violations[0]?.rule).toBe("no-private-runtime-in-build");
	});

	it("ignores exclusion entries", () => {
		expect(checkBuildManifest({ files: ["!research/**/*"] })).toEqual([]);
	});
});
