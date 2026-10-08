// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import profile from "../beauty-lab-runtime-payload.json";
import { verifyIndependentBeautyRuntime } from "../beauty-lab-runtime-payload";

let directory: string;
const sourceManifestSha256 = "a".repeat(64);
const bytes = Buffer.from("validated");
const file = {
	path: "research/model.onnx",
	bytes: bytes.length,
	sha256: createHash("sha256").update(bytes).digest("hex"),
};
const requirements = {
	schemaVersion: 1,
	profile: "fixture",
	sourceManifestSha256,
	files: [file],
};
beforeEach(async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "beauty-runtime-test-"));
	await mkdir(path.join(directory, "research"));
	await writeFile(path.join(directory, file.path), bytes);
});
afterEach(async () => {
	await rm(directory, {
		recursive: true,
		force: true,
		maxRetries: 10,
		retryDelay: 100,
	});
});
function verify({ payload = requirements }: { payload?: unknown } = {}) {
	return verifyIndependentBeautyRuntime({
		runtimeRoot: directory,
		sourceManifestSha256,
		requirements: payload,
	});
}
describe("independent runtime payload", () => {
	it("verifies exact bytes and reports the installed profile", async () => {
		await expect(verify()).resolves.toEqual({
			profile: "fixture",
			verifiedFiles: 1,
			verifiedBytes: bytes.length,
		});
	});
	it("checks the shipped profile matches the source snapshot", async () => {
		const source = await import(
			"../../research/independent-beauty/source-manifest.json"
		);
		const { readFile } = await import("node:fs/promises");
		expect(profile.sourceManifestSha256).toBe(
			createHash("sha256")
				.update(
					await readFile(
						new URL(
							"../../research/independent-beauty/source-manifest.json",
							import.meta.url
						)
					)
				)
				.digest("hex")
		);
		expect(
			source.default.files.length + source.default.generatedFiles.length
		).toBe(262);
		expect(profile.files).toHaveLength(358);
		expect(
			profile.files.some(({ path: name }) => name.startsWith("Frameworks/"))
		).toBe(false);
		expect(new Set(profile.files.map(({ path: name }) => name)).size).toBe(
			profile.files.length
		);
		expect(
			profile.files.some(({ path: name }) =>
				name.endsWith("AmazingFeature_3/image/filter.png")
			)
		).toBe(true);
	});
	it("rejects incomplete installations with the failing path", async () => {
		await rm(path.join(directory, file.path));
		await expect(verify()).rejects.toThrow("research/model.onnx");
	});
	it("rejects corrupted same-size bytes", async () => {
		await writeFile(
			path.join(directory, file.path),
			Buffer.alloc(bytes.length)
		);
		await expect(verify()).rejects.toThrow("SHA-256");
	});
	it("rejects truncated bytes", async () => {
		await writeFile(path.join(directory, file.path), "short");
		await expect(verify()).rejects.toThrow("size");
	});
	it("rejects directories in place of files", async () => {
		await rm(path.join(directory, file.path));
		await mkdir(path.join(directory, file.path));
		await expect(verify()).rejects.toThrow("regular payload file");
	});
	it("rejects a mismatched source profile before disk inspection", async () => {
		await expect(
			verify({
				payload: { ...requirements, sourceManifestSha256: "b".repeat(64) },
			})
		).rejects.toThrow("match engine source");
	});
	it.each([
		"../escape",
		"/absolute",
		"research/../escape",
		"research//model",
		"research/./model",
		"research/a\\b",
		"research/C:drive",
		"output/model",
	])("rejects invalid profile path %s", async (name) => {
		await expect(
			verify({ payload: { ...requirements, files: [{ ...file, path: name }] } })
		).rejects.toThrow("profile path");
	});
	it("rejects duplicate entries", async () => {
		await expect(
			verify({ payload: { ...requirements, files: [file, file] } })
		).rejects.toThrow("profile path");
	});
	it.each([
		-1,
		256 * 1024 * 1024 + 1,
	])("rejects an invalid size %s", async (size) => {
		await expect(
			verify({
				payload: { ...requirements, files: [{ ...file, bytes: size }] },
			})
		).rejects.toThrow();
	});
	it("verifies legitimate empty metadata files", async () => {
		await writeFile(path.join(directory, file.path), "");
		await expect(
			verify({
				payload: {
					...requirements,
					files: [
						{ ...file, bytes: 0, sha256: createHash("sha256").digest("hex") },
					],
				},
			})
		).resolves.toMatchObject({ verifiedFiles: 1, verifiedBytes: 0 });
	});
	it("rejects empty profiles", async () => {
		await expect(
			verify({ payload: { ...requirements, files: [] } })
		).rejects.toThrow();
	});
	it.skipIf(process.platform === "win32")(
		"accepts external directory links",
		async () => {
			await symlink(
				path.join(directory, "research"),
				path.join(directory, "Models")
			);
			await expect(
				verify({
					payload: {
						...requirements,
						files: [{ ...file, path: "Models/model.onnx" }],
					},
				})
			).resolves.toMatchObject({ verifiedFiles: 1 });
		}
	);
	it.skipIf(process.platform === "win32")(
		"rejects file links even when bytes match",
		async () => {
			await symlink(
				path.join(directory, file.path),
				path.join(directory, "research/link.onnx")
			);
			await expect(
				verify({
					payload: {
						...requirements,
						files: [{ ...file, path: "research/link.onnx" }],
					},
				})
			).rejects.toThrow("regular payload file");
		}
	);
	it("aggregates failures deterministically and limits diagnostics", async () => {
		const files = Array.from({ length: 12 }, (_, index) => ({
			...file,
			path: `research/missing-${String(index).padStart(2, "0")}`,
		}));
		await expect(
			verify({ payload: { ...requirements, files } })
		).rejects.toThrow(/incomplete \(12 files\): research\/missing-00/);
		await expect(
			verify({ payload: { ...requirements, files } })
		).rejects.not.toThrow("missing-08");
	});
});
