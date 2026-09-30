// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	JIANYING_NOSE_3D_MODELS,
	missingJianyingNoseModels,
} from "../jianying-portrait-adjustment-runtime/nose-models.js";

describe("3D nose model readiness", () => {
	it("requires 1256 fitting for sculpted noses, not the size package's 1220", async () => {
		const directory = await mkdtemp(
			path.join(os.tmpdir(), "qcut-nose-models-")
		);
		try {
			await Promise.all(
				JIANYING_NOSE_3D_MODELS.map((name) =>
					writeFile(path.join(directory, `${name}_v1.model`), "model")
				)
			);
			expect(
				await missingJianyingNoseModels({ modelDirectory: directory })
			).toEqual([]);
			expect(
				await missingJianyingNoseModels({
					modelDirectory: directory,
					runtimePackage: "nose-sculpt",
				})
			).toEqual(["tt_facefitting1256"]);
			await writeFile(path.join(directory, "tt_facefitting1256_v1.model"), "");
			expect(
				await missingJianyingNoseModels({
					modelDirectory: directory,
					runtimePackage: "nose-upturned",
				})
			).toEqual(["tt_facefitting1256"]);
			await writeFile(
				path.join(directory, "tt_facefitting1256_v1.model"),
				"model"
			);
			expect(
				await missingJianyingNoseModels({
					modelDirectory: directory,
					runtimePackage: "nose-hump",
				})
			).toEqual([]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("does not gate non-nose packages on fitting models", async () => {
		expect(
			await missingJianyingNoseModels({
				modelDirectory: null,
				runtimePackage: "brow-shape",
			})
		).toEqual([]);
		expect(
			await missingJianyingNoseModels({
				modelDirectory: null,
				runtimePackage: "nose-sculpt",
			})
		).toContain("tt_facefitting1256");
	});
});
