// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	independentSourceEvidenceIdentity,
	verifyIndependentSourceEvidenceReceipt,
	writeIndependentSourceEvidence,
} from "../beauty-lab/beauty-lab-independent-source-evidence";
import { INDEPENDENT_SOURCE_EVIDENCE_POLICY } from "../beauty-lab/beauty-lab-independent-contract";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "source-evidence-test-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

function fixture() {
	return {
		width: 1,
		height: 1,
		rgba: new Uint8Array([10, 20, 30, 255]),
		sourceEvidence: {
			policy: INDEPENDENT_SOURCE_EVIDENCE_POLICY,
			status: "available" as const,
			targetTimestampSeconds: 1,
			frames: [0.92, 0.96, 1.04, 1.08].map((timestampSeconds, index) => ({
				timestampSeconds,
				rgba: new Uint8Array([index, 10, 20, 255]),
			})),
		},
	};
}

describe("independent source evidence", () => {
	it("binds ordered source timestamps, current pixels and every neighbor's pixels", () => {
		const original = fixture();
		const identity =
			independentSourceEvidenceIdentity(original)?.manifestSha256;
		expect(
			independentSourceEvidenceIdentity(structuredClone(original))
				?.manifestSha256
		).toBe(identity);
		const pixels = fixture();
		pixels.sourceEvidence.frames[0].rgba[0] = 55;
		const time = fixture();
		time.sourceEvidence.frames[0].timestampSeconds -= 0.01;
		const target = fixture();
		target.rgba[0] = 99;
		const targetTime = fixture();
		targetTime.sourceEvidence.targetTimestampSeconds += 0.01;
		for (const changed of [pixels, time, target, targetTime])
			expect(
				independentSourceEvidenceIdentity(changed)?.manifestSha256
			).not.toBe(identity);
	});
	it.each([
		{ timestamps: [0.92, 0.92, 1.04, 1.08] },
		{ timestamps: [0.96, 0.92, 1.04, 1.08] },
		{ timestamps: [0.92, 1, 1.04, 1.08] },
		{ timestamps: [0.1, 0.96, 1.04, 1.08] },
	])("rejects non-bracketing, repeated or distant timestamps $timestamps", ({
		timestamps,
	}) => {
		const value = fixture();
		value.sourceEvidence.frames = value.sourceEvidence.frames.map(
			(frame, index) => ({
				...frame,
				timestampSeconds: timestamps[index],
			})
		);
		expect(() => independentSourceEvidenceIdentity(value)).toThrow();
	});
	it("rejects shared, truncated or transparent neighbor pixels before reuse", () => {
		for (const rgba of [
			new Uint8Array(new SharedArrayBuffer(4)),
			new Uint8Array(3),
			new Uint8Array(4),
		]) {
			const value = fixture();
			value.sourceEvidence.frames[1].rgba = rgba;
			expect(() => independentSourceEvidenceIdentity(value)).toThrow();
		}
	});
	it("does not downsample over-budget 4K evidence", () => {
		expect(() =>
			independentSourceEvidenceIdentity({
				...fixture(),
				width: 2160,
				height: 3840,
			})
		).toThrow(/budget/);
	});
	it("writes raw pixels and a byte-hashed manifest into the private job directory", async () => {
		const value = fixture();
		const written = await writeIndependentSourceEvidence({
			...value,
			directory,
			signal: new AbortController().signal,
		});
		expect(written).toBeDefined();
		const bytes = await readFile(written!.path);
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(
			written!.manifestSha256
		);
		const manifest = JSON.parse(bytes.toString()) as {
			targetRgbaSha256: string;
			frames: Array<{ path: string }>;
		};
		expect(manifest.targetRgbaSha256).toBe(
			createHash("sha256").update(value.rgba).digest("hex")
		);
		expect(manifest.frames).toHaveLength(4);
		const images = await Promise.all(
			manifest.frames.map((frame: { path: string }) =>
				readFile(path.join(directory, frame.path))
			)
		);
		expect(images.map((rgba) => Array.from(rgba))).toEqual(
			value.sourceEvidence.frames.map((frame) => Array.from(frame.rgba))
		);
		expect(() =>
			verifyIndependentSourceEvidenceReceipt({
				expected: written,
				receipt: written,
			})
		).not.toThrow();
		expect(() =>
			verifyIndependentSourceEvidenceReceipt({
				expected: written,
				receipt: { ...written, manifestSha256: "wrong" },
			})
		).toThrow(/receipt mismatch/);
	});
	it("keeps unavailable distinct from absent and available, without writing fake frames", async () => {
		const value = fixture();
		const unavailable = {
			...value,
			sourceEvidence: {
				policy: INDEPENDENT_SOURCE_EVIDENCE_POLICY,
				status: "unavailable" as const,
				reason: "insufficient-neighbors",
			},
		};
		const written = await writeIndependentSourceEvidence({
			...unavailable,
			directory,
			signal: new AbortController().signal,
		});
		expect(written?.manifestSha256).not.toBe(
			independentSourceEvidenceIdentity(value)?.manifestSha256
		);
		expect(await readdir(directory)).toEqual(["source-evidence.json"]);
		expect(
			independentSourceEvidenceIdentity({ ...value, sourceEvidence: undefined })
		).toBeUndefined();
		expect(() =>
			verifyIndependentSourceEvidenceReceipt({
				expected: undefined,
				receipt: written,
			})
		).toThrow(/Unexpected/);
	});
	it("does not write after cancellation", async () => {
		const controller = new AbortController();
		controller.abort(new Error("cancelled"));
		await expect(
			writeIndependentSourceEvidence({
				...fixture(),
				directory,
				signal: controller.signal,
			})
		).rejects.toThrow("cancelled");
		expect(await readdir(directory)).toEqual([]);
	});
});
