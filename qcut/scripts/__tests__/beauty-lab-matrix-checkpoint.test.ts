import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyBeautyMatrixCheckpoint } from "../beauty-lab-matrix-checkpoint";
import { beautyPixelDifference } from "../beauty-lab-matrix-metrics";
import type { BeautyMatrixRow } from "../beauty-lab-matrix";
import type { BeautyMatrixCase } from "../beauty-lab-matrix-cases";

const hash = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");
function fixture() {
	const original = new Uint8Array([10, 20, 30, 255]);
	const independent = new Uint8Array([11, 22, 30, 255]);
	const native = new Uint8Array([11, 23, 30, 255]);
	const test: BeautyMatrixCase = {
		id: "effect",
		kind: "control",
		adjustments: { enabled: true, values: { face_adjust_Whiten: 45 } },
	};
	const row: BeautyMatrixRow = {
		id: "photo--effect",
		inputId: "photo",
		caseId: test.id,
		kind: test.kind,
		executed: true,
		milliseconds: 10,
		inputSha256: hash({ bytes: original }),
		independentSha256: hash({ bytes: independent }),
		nativeSha256: hash({ bytes: native }),
		parity: beautyPixelDifference({ left: independent, right: native }).metrics,
		ownedChange: beautyPixelDifference({ left: original, right: independent })
			.metrics,
		nativeChange: beautyPixelDifference({ left: original, right: native })
			.metrics,
	};
	return {
		original,
		independent,
		native,
		row,
		test,
		id: row.id,
		inputId: row.inputId,
	};
}
describe("matrix resume evidence", () => {
	it("accepts verified saved pixels and remeasured metrics", () =>
		expect(() => verifyBeautyMatrixCheckpoint(fixture())).not.toThrow());
	it.each([
		"original",
		"independent",
		"native",
	] as const)("rejects changed %s pixels", (name) => {
		const value = fixture();
		value[name][0]++;
		expect(() => verifyBeautyMatrixCheckpoint(value)).toThrow();
	});
	it.each([
		"id",
		"inputId",
		"caseId",
		"kind",
	] as const)("rejects swapped %s identity", (name) => {
		const value = fixture();
		value.row[name] = "other";
		expect(() => verifyBeautyMatrixCheckpoint(value)).toThrow();
	});
	it("rejects a fabricated success threshold with otherwise valid hashes", () => {
		const value = fixture();
		value.row.parity = { ...value.row.parity!, maximumRGB: 0 };
		expect(() => verifyBeautyMatrixCheckpoint(value)).toThrow();
	});
	it("rejects changed original comparison metrics", () => {
		const value = fixture();
		value.row.ownedChange = { ...value.row.ownedChange!, changedPixels: 0 };
		expect(() => verifyBeautyMatrixCheckpoint(value)).toThrow();
	});
	it("rejects failed or error-bearing checkpoints", () => {
		const value = fixture();
		value.row.executed = false;
		expect(() => verifyBeautyMatrixCheckpoint(value)).toThrow();
		value.row.executed = true;
		value.row.error = "partial";
		expect(() => verifyBeautyMatrixCheckpoint(value)).toThrow();
	});
});
