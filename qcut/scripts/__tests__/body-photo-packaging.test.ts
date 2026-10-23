import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stages = vi.hoisted(() => ({ independent: vi.fn(), photo: vi.fn() }));
vi.mock("../stage-independent-beauty", () => ({
	stageIndependentBeauty: stages.independent,
}));
vi.mock("../stage-body-photo", () => ({
	stageBodyPhotoBuild: stages.photo,
}));
import beforePack from "../beforePack";

beforeEach(() => vi.resetAllMocks());

describe("photo body packaging", () => {
	it("stages photo sources separately from the live video engine and only once per project", () => {
		const projectDir = path.resolve("source-only-body-photo-success");
		beforePack({ packager: { projectDir } });
		beforePack({ packager: { projectDir } });
		expect(stages.photo).toHaveBeenCalledTimes(1);
		expect(stages.photo).toHaveBeenCalledWith({
			sourceRoot: path.join(projectDir, "research/body-photo"),
			sharedEngineRoot: path.join(
				projectDir,
				"research/independent-beauty/research"
			),
			destinationRoot: path.join(projectDir, "build/body-photo"),
		});
		expect(stages.independent).toHaveBeenCalledWith({
			sourceRoot: path.join(projectDir, "research/independent-beauty"),
			outputRoot: path.join(projectDir, "build/independent-beauty"),
		});
	});

	it("fails packaging on a photo source error and permits a corrected retry", () => {
		const projectDir = path.resolve("source-only-body-photo-retry");
		stages.photo.mockImplementationOnce(() => {
			throw new Error("Source hash mismatch");
		});
		expect(() => beforePack({ packager: { projectDir } })).toThrow(
			"Source hash mismatch"
		);
		beforePack({ packager: { projectDir } });
		expect(stages.photo).toHaveBeenCalledTimes(2);
	});

	it("ships the validated source staging directory with private payload exclusions", () => {
		const pkg = JSON.parse(
			readFileSync(path.resolve("package.json"), "utf8")
		) as {
			build: {
				extraResources: { from: string; to: string; filter?: string[] }[];
			};
		};
		const resources = pkg.build.extraResources.filter(
			(entry) => entry.to === "body-photo"
		);
		expect(resources).toHaveLength(1);
		expect(resources[0].from).toBe("build/body-photo");
		expect(resources[0].filter).toEqual(
			expect.arrayContaining([
				"!**/runtime{,/**/*}",
				"!**/.venv{,/**/*}",
				"!**/output{,/**/*}",
				"!**/*.{pyc,pyo,onnx,npz,bin,dylib,dll,so,zip}",
			])
		);
	});
});
