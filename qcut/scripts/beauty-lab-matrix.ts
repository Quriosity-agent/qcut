import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { z } from "zod";
import {
	beautyMatrixOptions,
	beautyMatrixProviders,
} from "./beauty-lab-matrix-providers";
import { readBeautyMatrixCheckpoint } from "./beauty-lab-matrix-checkpoint";
import { matrixSelection } from "./beauty-lab-matrix-cases";
import { beautyPixelDifference } from "./beauty-lab-matrix-metrics";
import { beautyMatrixGallery } from "./beauty-lab-matrix-gallery";

const configurationSchema = z.object({
	maxEdge: z.number().int().min(160).max(640).default(320),
	inputs: z
		.array(
			z.object({
				id: z.string().regex(/^[a-zA-Z0-9-]+$/),
				path: z.string().min(1),
				suite: z.enum(["full", "stress", "shape"]),
				synthetic: z.boolean().default(false),
				description: z
					.string()
					.default("Unlabelled portrait; pose not verified"),
			})
		)
		.min(1),
});
type Metrics = ReturnType<typeof beautyPixelDifference>["metrics"];
export interface BeautyMatrixRow {
	id: string;
	inputId: string;
	caseId: string;
	kind: string;
	executed: boolean;
	error?: string;
	parity?: Metrics;
	ownedChange?: Metrics;
	nativeChange?: Metrics;
	inputSha256: string;
	independentSha256?: string;
	nativeSha256?: string;
	milliseconds: number;
}
const digest = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");
async function main() {
	const { configurationPath, outputPath, resume, packagedApp } =
		beautyMatrixOptions({ argv: process.argv.slice(2) });
	const configBytes = await readFile(configurationPath);
	const config = configurationSchema.parse(JSON.parse(configBytes.toString()));
	if (new Set(config.inputs.map(({ id }) => id)).size !== config.inputs.length)
		throw new Error("Duplicate input IDs");
	const directory = path.resolve(outputPath);
	const { engineRoot, executionIdentity, owned, native } =
		await beautyMatrixProviders({ packagedApp });
	const sourceManifestSha256 = digest({
		bytes: await readFile(path.join(engineRoot, "source-manifest.json")),
	});
	const configurationSha256 = digest({ bytes: configBytes });
	await mkdir(directory, { recursive: Boolean(resume) });
	const metadataPath = path.join(directory, "run.json");
	if (resume) {
		const previous = JSON.parse(await readFile(metadataPath, "utf8")) as {
			sourceManifestSha256: string;
			configurationSha256: string;
			executionIdentity?: unknown;
		};
		if (
			previous.sourceManifestSha256 !== sourceManifestSha256 ||
			previous.configurationSha256 !== configurationSha256 ||
			JSON.stringify(previous.executionIdentity) !==
				JSON.stringify(executionIdentity)
		)
			throw new Error(
				"Resume requires identical configuration, engine source and execution identity"
			);
	}
	await writeFile(
		metadataPath,
		JSON.stringify(
			{
				config,
				sourceManifestSha256,
				configurationSha256,
				executionIdentity,
				nativeProductParityVerified: false,
				videoVerified: false,
			},
			null,
			2
		)
	);
	const rows: BeautyMatrixRow[] = [];
	try {
		const [ownedStatus, nativeStatus] = await Promise.all([
			owned.inspect(),
			native.inspect(),
		]);
		await writeFile(
			path.join(directory, "status.json"),
			JSON.stringify({ ownedStatus, nativeStatus }, null, 2)
		);
		if (!ownedStatus.available || !nativeStatus.available)
			throw new Error("Both real providers must be ready");
		const inputs = await Promise.all(
			config.inputs.map(async (input) => {
				const imageBytes = await readFile(path.resolve(input.path));
				const image = await loadImage(path.resolve(input.path));
				if (!(await readFile(path.resolve(input.path))).equals(imageBytes))
					throw new Error("Input photo changed while decoding");
				const scale = Math.min(
					1,
					config.maxEdge / Math.max(image.width, image.height)
				);
				const width = Math.round(image.width * scale),
					height = Math.round(image.height * scale);
				const canvas = createCanvas(width, height),
					context = canvas.getContext("2d");
				context.fillStyle = "white";
				context.fillRect(0, 0, width, height);
				context.drawImage(image, 0, 0, width, height);
				const rgba = new Uint8Array(
					context.getImageData(0, 0, width, height).data
				);
				await writeFile(
					path.join(directory, `${input.id}-original.png`),
					canvas.toBuffer("image/png")
				);
				return {
					...input,
					width,
					height,
					rgba,
					inputSha256: digest({ bytes: rgba }),
					sourceFileSha256: digest({ bytes: imageBytes }),
				};
			})
		);
		const jobs = inputs.flatMap((input) =>
			matrixSelection({ suite: input.suite }).map((test) => ({ input, test }))
		);
		async function persist() {
			const summary = {
				planned: jobs.length,
				completed: rows.length,
				executed: rows.filter(({ executed }) => executed).length,
				renderErrors: rows.filter(({ executed }) => !executed).length,
				withinOneRGB: rows.filter(({ parity }) => parity?.withinOneRGB).length,
				outsideOneRGB: rows.filter(
					({ parity }) => parity && !parity.withinOneRGB
				).length,
				activeOwnedNoChange: rows.filter(
					({ kind, ownedChange }) => kind !== "zero" && ownedChange?.identity
				).length,
			};
			await writeFile(
				path.join(directory, "matrix.tmp.json"),
				JSON.stringify(
					{
						summary,
						sourceManifestSha256,
						executionIdentity,
						inputs: inputs.map(({ rgba: _rgba, ...input }) => input),
						rows,
						nativeProductParityVerified: false,
						videoVerified: false,
					},
					null,
					2
				)
			);
			await rename(
				path.join(directory, "matrix.tmp.json"),
				path.join(directory, "matrix.json")
			);
			await writeFile(
				path.join(directory, "index.html"),
				beautyMatrixGallery({ rows, summary })
			);
		}
		await jobs.reduce(
			(previous, { input, test }) =>
				previous.then(async () => {
					const id = `${input.id}--${test.id}`;
					const rowPath = path.join(directory, id, "case.json");
					if (resume) {
						try {
							const stored = await readBeautyMatrixCheckpoint({
								directory: path.dirname(rowPath),
								sourceManifestSha256,
								original: input.rgba,
								width: input.width,
								height: input.height,
								id,
								inputId: input.id,
								test,
							});
							if (stored) {
								rows.push(stored);
								return;
							}
						} catch (error) {
							if (
								!(
									error instanceof Error &&
									"code" in error &&
									error.code === "ENOENT"
								)
							)
								throw error;
						}
					}
					await mkdir(path.join(directory, id), { recursive: true });
					const started = performance.now();
					// Every case is an independent still photo. A key shared across cases lets the
					// native provider continue tracking from the previous case's render.
					const source = {
						width: input.width,
						height: input.height,
						rgba: input.rgba,
						sourceKey: `matrix-${input.id}-${test.id}`,
					};
					const pair = await Promise.allSettled([
						owned.render({
							request: {
								...source,
								requestId: `matrix-${rows.length}`,
								adjustments: test.adjustments,
							},
						}),
						native.render({
							...source,
							adjustments: test.adjustments,
							frameNumber: 0,
							timestampSeconds: 0,
						}),
					]);
					const row: BeautyMatrixRow = {
						id,
						inputId: input.id,
						caseId: test.id,
						kind: test.kind,
						executed: false,
						inputSha256: input.inputSha256,
						milliseconds: performance.now() - started,
					};
					const failures = pair.flatMap((result, index) =>
						result.status === "rejected"
							? [
									`${index === 0 ? "independent" : "native"}: ${String(result.reason)}`,
								]
							: []
					);
					async function save({
						name,
						rgba,
					}: {
						name: string;
						rgba: Uint8Array;
					}) {
						const canvas = createCanvas(input.width, input.height);
						canvas
							.getContext("2d")
							.putImageData(
								new ImageData(
									new Uint8ClampedArray(rgba),
									input.width,
									input.height
								),
								0,
								0
							);
						await writeFile(
							path.join(directory, id, `${name}.png`),
							canvas.toBuffer("image/png")
						);
					}
					if (pair[0].status === "fulfilled") {
						const result = pair[0].value;
						row.independentSha256 = result.outputSha256;
						row.ownedChange = beautyPixelDifference({
							left: input.rgba,
							right: result.rgba,
						}).metrics;
						await Promise.all([
							writeFile(
								path.join(directory, id, "independent.png"),
								result.png
							),
							writeFile(
								path.join(directory, id, "independent.json"),
								JSON.stringify(result.report, null, 2)
							),
						]);
					}
					if (pair[1].status === "fulfilled") {
						const result = pair[1].value;
						if (result.provider !== "jianying-local-swing-v1")
							throw new Error("Incorrect native provider");
						row.nativeSha256 = digest({ bytes: result.rgba });
						row.nativeChange = beautyPixelDifference({
							left: input.rgba,
							right: result.rgba,
						}).metrics;
						await save({ name: "native", rgba: result.rgba });
					}
					if (
						pair[0].status === "fulfilled" &&
						pair[1].status === "fulfilled"
					) {
						const comparison = beautyPixelDifference({
							left: pair[0].value.rgba,
							right: pair[1].value.rgba,
						});
						row.parity = comparison.metrics;
						row.executed =
							test.kind !== "zero" || Boolean(row.ownedChange?.identity);
						if (!row.executed)
							failures.push("Independent zero controls changed pixels");
						await save({ name: "difference-x8", rgba: comparison.difference });
					}
					if (failures.length) row.error = failures.join("\n").slice(0, 8000);
					rows.push(row);
					await writeFile(
						rowPath,
						JSON.stringify(
							{ row, adjustments: test.adjustments, sourceManifestSha256 },
							null,
							2
						)
					);
					await persist();
					console.log(
						`${rows.length}/${jobs.length} ${id} ${row.error ?? `maxRGB=${row.parity?.maximumRGB}`}`
					);
				}),
			Promise.resolve()
		);
		await persist();
		console.log(`Completed matrix: ${directory}`);
		if (rows.some(({ executed }) => !executed)) process.exitCode = 2;
	} finally {
		await Promise.all([owned.dispose(), native.clear()]);
	}
}
void main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
