import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
	INDEPENDENT_SOURCE_EVIDENCE_MAX_BYTES,
	INDEPENDENT_SOURCE_EVIDENCE_MAX_SECONDS,
	INDEPENDENT_SOURCE_EVIDENCE_POLICY,
	type BeautyLabIndependentSourceEvidence,
} from "./beauty-lab-independent-contract.js";

export const independentSourceEvidenceSchema = z.discriminatedUnion("status", [
	z
		.object({
			policy: z.literal(INDEPENDENT_SOURCE_EVIDENCE_POLICY),
			status: z.literal("available"),
			targetTimestampSeconds: z.number().finite().nonnegative(),
			frames: z
				.array(
					z
						.object({
							timestampSeconds: z.number().finite().nonnegative(),
							rgba: z.instanceof(Uint8Array),
						})
						.strict()
				)
				.length(4),
		})
		.strict(),
	z
		.object({
			policy: z.literal(INDEPENDENT_SOURCE_EVIDENCE_POLICY),
			status: z.literal("unavailable"),
			reason: z.string().min(1).max(256),
		})
		.strict(),
]);

const digest = ({ bytes }: { bytes: Uint8Array | string }) =>
	createHash("sha256").update(bytes).digest("hex");

export function describeIndependentSourceEvidence({
	sourceEvidence,
	width,
	height,
	rgba,
}: {
	sourceEvidence: BeautyLabIndependentSourceEvidence;
	width: number;
	height: number;
	rgba: Uint8Array;
}) {
	const evidence = independentSourceEvidenceSchema.parse(sourceEvidence);
	const common = {
		schemaVersion: 1,
		policy: evidence.policy,
		status: evidence.status,
		targetRgbaSha256: digest({ bytes: rgba }),
		width,
		height,
	};
	if (evidence.status === "unavailable")
		return { ...common, reason: evidence.reason };
	const frameBytes = width * height * 4;
	if (frameBytes * 4 > INDEPENDENT_SOURCE_EVIDENCE_MAX_BYTES)
		throw new Error("Independent source evidence exceeds the byte budget");
	const timestamps = evidence.frames.map((frame) => frame.timestampSeconds);
	if (
		!(
			timestamps[1] < evidence.targetTimestampSeconds &&
			timestamps[2] > evidence.targetTimestampSeconds
		) ||
		timestamps.some(
			(timestamp, index) =>
				(index > 0 && timestamp <= timestamps[index - 1]) ||
				Math.abs(timestamp - evidence.targetTimestampSeconds) >
					INDEPENDENT_SOURCE_EVIDENCE_MAX_SECONDS
		)
	)
		throw new Error(
			"Independent source evidence requires distinct bracketing source timestamps"
		);
	const frames = evidence.frames.map((frame, index) => {
		if (
			frame.rgba.buffer instanceof SharedArrayBuffer ||
			frame.rgba.length !== frameBytes
		)
			throw new Error("Invalid independent source evidence RGBA");
		for (let offset = 3; offset < frame.rgba.length; offset += 4)
			if (frame.rgba[offset] !== 255)
				throw new Error("Independent source evidence must be opaque");
		return {
			timestampSeconds: frame.timestampSeconds,
			rgbaSha256: digest({ bytes: frame.rgba }),
			path: `source-evidence-${index}.rgba`,
		};
	});
	return {
		...common,
		targetTimestampSeconds: evidence.targetTimestampSeconds,
		frames,
	};
}

export function independentSourceEvidenceIdentity({
	sourceEvidence,
	width,
	height,
	rgba,
}: {
	sourceEvidence?: BeautyLabIndependentSourceEvidence;
	width: number;
	height: number;
	rgba: Uint8Array;
}) {
	if (!sourceEvidence) return;
	const manifest = describeIndependentSourceEvidence({
		sourceEvidence,
		width,
		height,
		rgba,
	});
	const bytes = `${JSON.stringify(manifest)}\n`;
	return { manifest, bytes, manifestSha256: digest({ bytes }) };
}

export async function writeIndependentSourceEvidence({
	directory,
	sourceEvidence,
	width,
	height,
	rgba,
	signal,
}: {
	directory: string;
	sourceEvidence?: BeautyLabIndependentSourceEvidence;
	width: number;
	height: number;
	rgba: Uint8Array;
	signal: AbortSignal;
}) {
	signal.throwIfAborted();
	const identity = independentSourceEvidenceIdentity({
		sourceEvidence,
		width,
		height,
		rgba,
	});
	if (!identity || !sourceEvidence) return;
	if (sourceEvidence.status === "available") {
		const writes = await Promise.allSettled(
			sourceEvidence.frames.map((frame, index) =>
				writeFile(
					path.join(directory, `source-evidence-${index}.rgba`),
					frame.rgba,
					{ signal, flag: "wx" }
				)
			)
		);
		for (const result of writes)
			if (result.status === "rejected") throw result.reason;
	}
	signal.throwIfAborted();
	const manifestPath = path.join(directory, "source-evidence.json");
	await writeFile(manifestPath, identity.bytes, { signal, flag: "wx" });
	return {
		path: manifestPath,
		manifestSha256: identity.manifestSha256,
		policy: sourceEvidence.policy,
		status: sourceEvidence.status,
	};
}

export function verifyIndependentSourceEvidenceReceipt({
	expected,
	receipt,
}: {
	expected: Awaited<ReturnType<typeof writeIndependentSourceEvidence>>;
	receipt: unknown;
}) {
	if (!expected) {
		if (receipt !== undefined && receipt !== null)
			throw new Error("Unexpected independent source evidence receipt");
		return;
	}
	const parsed = z
		.object({
			manifestSha256: z.literal(expected.manifestSha256),
			policy: z.literal(expected.policy),
			status: z.literal(expected.status),
		})
		.safeParse(receipt);
	if (!parsed.success)
		throw new Error("Independent source evidence receipt mismatch");
}
