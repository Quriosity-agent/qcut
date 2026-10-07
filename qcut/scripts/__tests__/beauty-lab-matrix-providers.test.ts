// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	beautyMatrixOptions,
	validatePackagedMatrixEnvironment,
	beautyMatrixProviders,
} from "../beauty-lab-matrix-providers";

describe("matrix execution selection", () => {
	it("retains development defaults", () => {
		expect(beautyMatrixOptions({ argv: ["input.json", "out"] })).toEqual({
			configurationPath: "input.json",
			outputPath: "out",
			resume: false,
			packagedApp: undefined,
		});
	});
	it.each([
		["--resume", "--packaged-app", "App.app"],
		["--packaged-app", "App.app", "--resume"],
	])("allows either flag order: %s", (...flags) => {
		expect(
			beautyMatrixOptions({ argv: ["input.json", "out", ...flags] })
		).toMatchObject({ resume: true, packagedApp: path.resolve("App.app") });
	});
	it.each([
		[],
		["input"],
		["--resume", "out"],
		["input", "--resume"],
		["input", "out", "--resume", "--resume"],
		["input", "out", "--packaged-app"],
		["input", "out", "--packaged-app", "--resume"],
		["input", "out", "--packaged-app", "A", "--packaged-app", "B"],
		["input", "out", "--unknown"],
	])("rejects malformed arguments: %s", (...argv) => {
		expect(() => beautyMatrixOptions({ argv })).toThrow();
	});
	const environment = {
		ELECTRON_RUN_AS_NODE: "1",
		QCUT_INDEPENDENT_BEAUTY_RUNTIME: path.resolve("external-runtime"),
		QCUT_INDEPENDENT_BEAUTY_PYTHON: path.resolve("external-python"),
	};
	it("requires an explicit external setup", () => {
		expect(validatePackagedMatrixEnvironment({ environment })).toEqual({
			runtimeRoot: environment.QCUT_INDEPENDENT_BEAUTY_RUNTIME,
			python: environment.QCUT_INDEPENDENT_BEAUTY_PYTHON,
		});
	});
	it.each([
		{ ELECTRON_RUN_AS_NODE: "" },
		{ QCUT_INDEPENDENT_BEAUTY_RUNTIME: "relative" },
		{ QCUT_INDEPENDENT_BEAUTY_PYTHON: "" },
		{ QCUT_JIANYING_PORTRAIT_ADJUSTMENT_HOST: "/override" },
	])("rejects unsupported execution: %s", (override) => {
		expect(() =>
			validatePackagedMatrixEnvironment({
				environment: { ...environment, ...override },
			})
		).toThrow();
	});
	it("does not fall back to development when a package is missing", async () => {
		await expect(
			beautyMatrixProviders({ packagedApp: path.resolve("missing-beauty.app") })
		).rejects.toThrow();
	});
});
