import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { BeautyMatrixRow } from "./beauty-lab-matrix";
import type { BeautyMatrixCase } from "./beauty-lab-matrix-cases";
import { beautyPixelDifference } from "./beauty-lab-matrix-metrics";

const digest = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");

export function verifyBeautyMatrixCheckpoint({
	row,
	original,
	independent,
	native,
	id,
	test,
	inputId,
}: {
	row: BeautyMatrixRow;
	original: Uint8Array;
	independent: Uint8Array;
	native: Uint8Array;
	id: string;
	test: BeautyMatrixCase;
	inputId: string;
}) {
	const identityMatches =
		row.executed === true &&
		!row.error &&
		row.id === id &&
		row.inputId === inputId &&
		row.caseId === test.id &&
		row.kind === test.kind &&
		row.inputSha256 === digest({ bytes: original }) &&
		row.independentSha256 === digest({ bytes: independent }) &&
		row.nativeSha256 === digest({ bytes: native });
	const metricsMatch =
		isDeepStrictEqual(
			row.parity,
			beautyPixelDifference({ left: independent, right: native }).metrics
		) &&
		isDeepStrictEqual(
			row.ownedChange,
			beautyPixelDifference({ left: original, right: independent }).metrics
		) &&
		isDeepStrictEqual(
			row.nativeChange,
			beautyPixelDifference({ left: original, right: native }).metrics
		);
	if (!identityMatches || !metricsMatch)
		throw new Error("Checkpoint pixels, identity or metrics changed");
}

export async function readBeautyMatrixCheckpoint({
	directory,
	sourceManifestSha256,
	original,
	width,
	height,
	id,
	inputId,
	test,
}: {
	directory: string;
	sourceManifestSha256: string;
	original: Uint8Array;
	width: number;
	height: number;
	id: string;
	inputId: string;
	test: BeautyMatrixCase;
}) {
	const stored = JSON.parse(
		await readFile(path.join(directory, "case.json"), "utf8")
	) as {
		row: BeautyMatrixRow;
		sourceManifestSha256: string;
		adjustments: BeautyMatrixCase["adjustments"];
	};
	if (
		stored.sourceManifestSha256 !== sourceManifestSha256 ||
		!isDeepStrictEqual(stored.adjustments, test.adjustments)
	)
		throw new Error("Checkpoint source or adjustments changed");
	if (!stored.row.executed) return null;
	async function pixels({ name }: { name: string }) {
		const filePath = path.join(directory, `${name}.png`);
		const bytes = await readFile(filePath);
		const image = await loadImage(filePath);
		if (
			!(await readFile(filePath)).equals(bytes) ||
			image.width !== width ||
			image.height !== height
		)
			throw new Error("Checkpoint image changed or has invalid dimensions");
		const canvas = createCanvas(width, height);
		const context = canvas.getContext("2d");
		context.drawImage(image, 0, 0);
		return {
			bytes,
			rgba: new Uint8Array(context.getImageData(0, 0, width, height).data),
		};
	}
	const [independent, native, report] = await Promise.all([
		pixels({ name: "independent" }),
		pixels({ name: "native" }),
		readFile(path.join(directory, "independent.json"), "utf8").then(
			(text) =>
				JSON.parse(text) as {
					outputPngSha256: string;
					qcutSourceManifestSha256: string;
				}
		),
	]);
	if (
		report.outputPngSha256 !== digest({ bytes: independent.bytes }) ||
		report.qcutSourceManifestSha256 !== sourceManifestSha256
	)
		throw new Error("Checkpoint PNG receipt changed");
	verifyBeautyMatrixCheckpoint({
		row: stored.row,
		original,
		independent: independent.rgba,
		native: native.rgba,
		id,
		test,
		inputId,
	});
	return stored.row;
}
