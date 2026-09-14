// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	EXPECTED_JIANYING_BUNDLE_ID,
	EXPECTED_JIANYING_VERSION,
	EXPECTED_SHOT_SPLIT_CORE_SHA256,
	EXPECTED_SHOT_SPLIT_CORE_UUID,
	EXPECTED_SHOT_SPLIT_RUNTIME_FILE_COUNT,
	parseShotSplitRuntimeManifest,
	SHOT_SPLIT_CORE_RELATIVE_PATH,
	SHOT_SPLIT_GRAPH_RELATIVE_PATH,
	SHOT_SPLIT_MODEL_RELATIVE_PATHS,
} from "../jianying-shot-split/runtime-assets.js";
import {
	buildShotSplitDecodeArguments,
	estimateShotSplitFrameCount,
	probeFailureDetail,
	requireShotSplitSourceFile,
	validateShotSplitSampling,
} from "../jianying-shot-split/video-input.js";
import { buildShotSplitBridgeArguments } from "../jianying-shot-split/process-pipeline.js";

function manifestFixture() {
	const named = [
		SHOT_SPLIT_CORE_RELATIVE_PATH,
		SHOT_SPLIT_GRAPH_RELATIVE_PATH,
		...SHOT_SPLIT_MODEL_RELATIVE_PATHS,
	];
	const files = named.map((relativePath, index) => ({
		bytes: 1000 + index,
		path: relativePath,
		sha256:
			relativePath === SHOT_SPLIT_CORE_RELATIVE_PATH
				? EXPECTED_SHOT_SPLIT_CORE_SHA256
				: "a".repeat(64),
	}));
	while (files.length < EXPECTED_SHOT_SPLIT_RUNTIME_FILE_COUNT) {
		files.push({
			bytes: 10,
			path: `Frameworks/lib${files.length}.dylib`,
			sha256: "b".repeat(64),
		});
	}
	return {
		schemaVersion: 1,
		purpose: "jianying-shot-split-research",
		app: {
			bundleId: EXPECTED_JIANYING_BUNDLE_ID,
			version: EXPECTED_JIANYING_VERSION,
		},
		core: {
			library: SHOT_SPLIT_CORE_RELATIVE_PATH,
			arm64Uuid: EXPECTED_SHOT_SPLIT_CORE_UUID,
		},
		architecture: "arm64",
		localOnly: true,
		cloudUpload: false,
		createdAt: "2026-09-14T06:12:46.447154+00:00",
		files,
		totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
	};
}

describe("shot-split runtime manifest", () => {
	it("names the first mismatch when the manifest is not the verified snapshot", () => {
		expect(() =>
			parseShotSplitRuntimeManifest({
				value: { ...manifestFixture(), purpose: "something-else" },
			})
		).toThrow("清单格式不受支持");
		expect(() =>
			parseShotSplitRuntimeManifest({
				value: {
					...manifestFixture(),
					app: { bundleId: EXPECTED_JIANYING_BUNDLE_ID, version: "11.4.0" },
				},
			})
		).toThrow("需要剪映 11.3.0");
		expect(() =>
			parseShotSplitRuntimeManifest({
				value: {
					...manifestFixture(),
					core: { library: SHOT_SPLIT_CORE_RELATIVE_PATH, arm64Uuid: "0" },
				},
			})
		).toThrow("UUID");
		const missingGraph = manifestFixture();
		missingGraph.files = missingGraph.files.filter(
			(file) => file.path !== SHOT_SPLIT_GRAPH_RELATIVE_PATH
		);
		expect(() =>
			parseShotSplitRuntimeManifest({ value: missingGraph })
		).toThrow(SHOT_SPLIT_GRAPH_RELATIVE_PATH);
		expect(() =>
			parseShotSplitRuntimeManifest({
				value: {
					...manifestFixture(),
					files: [
						...manifestFixture().files,
						{ bytes: 1, path: "../escape", sha256: "c".repeat(64) },
					],
				},
			})
		).toThrow("文件列表无效");
	});

	it("rejects a structurally valid manifest whose file set is not the pinned one", () => {
		expect(() =>
			parseShotSplitRuntimeManifest({ value: manifestFixture() })
		).toThrow("文件集与已验证快照不符");
	});
});

describe("shot-split sampling", () => {
	it("applies the measured defaults and validates ranges", () => {
		expect(validateShotSplitSampling({})).toEqual({
			fps: 24,
			height: 180,
			width: 320,
		});
		expect(validateShotSplitSampling({ fps: 12 })).toMatchObject({ fps: 12 });
		expect(() => validateShotSplitSampling({ fps: 0 })).toThrow("采样帧率");
		expect(() => validateShotSplitSampling({ fps: Number.NaN })).toThrow(
			"采样帧率"
		);
		expect(() => validateShotSplitSampling({ width: 8 })).toThrow("采样尺寸");
		expect(() => validateShotSplitSampling({ height: 100.5 })).toThrow(
			"采样尺寸"
		);
	});

	it("streams resampled RGBA frames into the named pipe", () => {
		const args = buildShotSplitDecodeArguments({
			fps: 23.976,
			height: 180,
			rawPath: "/tmp/pipe/frames.rgba",
			sourcePath: "/tmp/clip.mp4",
			width: 320,
		});
		expect(args).toEqual(
			expect.arrayContaining([
				"-y",
				"-i",
				"/tmp/clip.mp4",
				"-vf",
				"fps=23.976,scale=320:180:flags=bilinear",
				"-pix_fmt",
				"rgba",
			])
		);
		expect(args.at(-1)).toBe("/tmp/pipe/frames.rgba");
	});

	it("passes the sandbox profile and the frame pipe to the bridge", () => {
		const args = buildShotSplitBridgeArguments({
			bridgePath: "/cache/bridge",
			framePath: "/tmp/pipe/frames.rgba",
			graphPath: "/runtime/Resources/SceneEditDetection/config.json",
			runtimeRoot: "/runtime",
			sampling: { fps: 24, height: 180, width: 320 },
		});
		expect(args[0]).toBe("-p");
		expect(args[1]).toContain("(deny network*)");
		expect(args.slice(2)).toEqual([
			"/cache/bridge",
			"/runtime",
			"VESDK",
			"",
			"/runtime/Resources/SceneEditDetection/config.json",
			"/tmp/pipe/frames.rgba",
			"320",
			"180",
			"24",
			"0",
			"1",
		]);
	});

	it("names a missing source file and keeps only ffprobe's last stderr line", async () => {
		await expect(
			requireShotSplitSourceFile({ sourcePath: "/nonexistent/clip.mp4" })
		).rejects.toThrow("镜头分割素材不存在: /nonexistent/clip.mp4");
		const failure = Object.assign(new Error("Command failed: ffprobe …"), {
			stderr: "[mov @ 0x1] moov atom not found\nclip.mp4: Invalid data found\n",
		});
		expect(probeFailureDetail({ error: failure })).toBe(
			"clip.mp4: Invalid data found"
		);
		expect(probeFailureDetail({ error: new Error("spawn ENOENT") })).toBe(
			"spawn ENOENT"
		);
	});

	it("estimates the sampled frame count from the duration", () => {
		expect(estimateShotSplitFrameCount({ durationSeconds: 12, fps: 24 })).toBe(
			288
		);
		expect(
			estimateShotSplitFrameCount({ durationSeconds: 0.01, fps: 24 })
		).toBe(1);
	});
});
