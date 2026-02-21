import { spawn } from "node:child_process";
import {
	access,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import ffmpegStaticPath from "ffmpeg-static";

const PATHS = {
	runsRoot: join(process.cwd(), "docs", "completed", "e2e-videos"),
} as const;

const FILE_NAMES = {
	combinedVideo: "combined-e2e-run.mp4",
	latestRun: "latest-run.json",
	manifest: "manifest.json",
} as const;

const VIDEO_LAYOUT = {
	failedCardDurationSeconds: 3,
	frameRate: 30,
	height: 720,
	introCardDurationSeconds: 2,
	width: 1280,
} as const;

interface CombineCliOptions {
	failedCardDurationSeconds: number;
	introCardDurationSeconds: number;
	manifestPath?: string;
	outputPath?: string;
	runDirectoryPath?: string;
}

interface VideoManifestEntry {
	copiedFileName: string;
	copiedFilePath: string;
	sourceRelativePath: string;
	status: "passed" | "failed";
	testArtifactDirectoryName: string;
	testLabel: string;
}

interface VideoManifest {
	createdAt: string;
	rawArtifactsRoot: string;
	runDirectoryName: string;
	runDirectoryPath: string;
	videoCount: number;
	videos: Array<VideoManifestEntry>;
}

interface LatestRunMetadata {
	combinedVideoPath: string;
	createdAt: string;
	manifestPath: string;
	runDirectoryName: string;
	runDirectoryPath: string;
}

interface RunContext {
	manifestPath: string;
	outputPath: string;
	runDirectoryPath: string;
}

function isErrnoCode({
	error,
	code,
}: {
	error: unknown;
	code: string;
}): boolean {
	if (!error || typeof error !== "object" || !("code" in error)) {
		return false;
	}

	return (error as NodeJS.ErrnoException).code === code;
}

function toPositiveNumber({
	fallbackValue,
	rawValue,
}: {
	fallbackValue: number;
	rawValue: string;
}): number {
	try {
		const numericValue = Number(rawValue);
		if (!Number.isFinite(numericValue) || numericValue <= 0) {
			return fallbackValue;
		}

		return numericValue;
	} catch (error) {
		if (error) {
			return fallbackValue;
		}

		return fallbackValue;
	}
}

function parseCliOptions({ argv }: { argv: Array<string> }): CombineCliOptions {
	try {
		const parsedOptions: CombineCliOptions = {
			failedCardDurationSeconds: VIDEO_LAYOUT.failedCardDurationSeconds,
			introCardDurationSeconds: VIDEO_LAYOUT.introCardDurationSeconds,
		};
		let index = 0;

		while (index < argv.length) {
			const currentArg = argv[index];
			const nextArg = argv[index + 1];

			switch (currentArg) {
				case "--run-dir": {
					if (!nextArg) {
						throw new Error("--run-dir requires a value");
					}
					parsedOptions.runDirectoryPath = resolve(nextArg);
					index += 2;
					break;
				}
				case "--manifest": {
					if (!nextArg) {
						throw new Error("--manifest requires a value");
					}
					parsedOptions.manifestPath = resolve(nextArg);
					index += 2;
					break;
				}
				case "--output": {
					if (!nextArg) {
						throw new Error("--output requires a value");
					}
					parsedOptions.outputPath = resolve(nextArg);
					index += 2;
					break;
				}
				case "--intro-seconds": {
					if (!nextArg) {
						throw new Error("--intro-seconds requires a value");
					}
					parsedOptions.introCardDurationSeconds = toPositiveNumber({
						fallbackValue: VIDEO_LAYOUT.introCardDurationSeconds,
						rawValue: nextArg,
					});
					index += 2;
					break;
				}
				case "--failed-seconds": {
					if (!nextArg) {
						throw new Error("--failed-seconds requires a value");
					}
					parsedOptions.failedCardDurationSeconds = toPositiveNumber({
						fallbackValue: VIDEO_LAYOUT.failedCardDurationSeconds,
						rawValue: nextArg,
					});
					index += 2;
					break;
				}
				default: {
					throw new Error(`Unknown argument: ${currentArg}`);
				}
			}
		}

		return parsedOptions;
	} catch (error) {
		throw error;
	}
}

async function fileExists({ filePath }: { filePath: string }): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch (error) {
		if (isErrnoCode({ error, code: "ENOENT" })) {
			return false;
		}

		throw error;
	}
}

function escapeDrawtextValue({ value }: { value: string }): string {
	try {
		return value
			.replaceAll("\\", "\\\\")
			.replaceAll(":", "\\:")
			.replaceAll("'", "\\'")
			.replaceAll("%", "\\%")
			.replaceAll("[", "\\[")
			.replaceAll("]", "\\]");
	} catch (error) {
		if (error) {
			return value;
		}

		return value;
	}
}

function escapeConcatPath({ filePath }: { filePath: string }): string {
	try {
		return filePath.replaceAll("'", "'\\''");
	} catch (error) {
		if (error) {
			return filePath;
		}

		return filePath;
	}
}

function truncateLabel({
	maxCharacters,
	value,
}: {
	maxCharacters: number;
	value: string;
}): string {
	try {
		if (value.length <= maxCharacters) {
			return value;
		}

		return `${value.slice(0, Math.max(0, maxCharacters - 3))}...`;
	} catch (error) {
		if (error) {
			return value;
		}

		return value;
	}
}

function buildDrawtextLine({
	fontColor,
	fontFilePath,
	fontSize,
	text,
	yExpression,
}: {
	fontColor: string;
	fontFilePath?: string;
	fontSize: number;
	text: string;
	yExpression: string;
}): string {
	try {
		const escapedText = escapeDrawtextValue({ value: text });
		const fontOption = fontFilePath
			? `fontfile=${escapeDrawtextValue({ value: fontFilePath })}:`
			: "";

		return `drawtext=${fontOption}text='${escapedText}':fontcolor=${fontColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=${yExpression}`;
	} catch (error) {
		throw error;
	}
}

function buildTitleCardVideoFilter({
	fontFilePath,
	isFailedOnlyCard,
	testIndex,
	testLabel,
	testStatus,
	totalTests,
}: {
	fontFilePath?: string;
	isFailedOnlyCard: boolean;
	testIndex: number;
	testLabel: string;
	testStatus: "passed" | "failed";
	totalTests: number;
}): string {
	try {
		const normalizedLabel = truncateLabel({
			maxCharacters: 90,
			value: testLabel,
		});
		const statusText = testStatus === "passed" ? "Status: PASSED" : "Status: FAILED";
		const statusColor = testStatus === "passed" ? "#6eeb83" : "#ff6b6b";
		const lineFilters: Array<string> = [
			buildDrawtextLine({
				fontColor: "white",
				fontFilePath,
				fontSize: 52,
				text: `Test ${testIndex + 1}/${totalTests}`,
				yExpression: "h*0.22",
			}),
			buildDrawtextLine({
				fontColor: "white",
				fontFilePath,
				fontSize: 34,
				text: `Task: ${normalizedLabel}`,
				yExpression: "h*0.40",
			}),
			buildDrawtextLine({
				fontColor: statusColor,
				fontFilePath,
				fontSize: 44,
				text: statusText,
				yExpression: "h*0.55",
			}),
		];

		if (isFailedOnlyCard) {
			lineFilters.push(
				buildDrawtextLine({
					fontColor: "#ffd166",
					fontFilePath,
					fontSize: 30,
					text: "No video content for this failed test",
					yExpression: "h*0.67",
				})
			);
		}

		return lineFilters.join(",");
	} catch (error) {
		throw error;
	}
}

function buildSegmentFileName({ testIndex }: { testIndex: number }): string {
	const zeroPaddedIndex = String(testIndex).padStart(4, "0");
	return `segment-${zeroPaddedIndex}.mp4`;
}

async function runFfmpeg({
	args,
	label,
}: {
	args: Array<string>;
	label: string;
}): Promise<void> {
	try {
		if (!ffmpegStaticPath) {
			throw new Error("ffmpeg-static binary is unavailable");
		}

		await new Promise<void>((resolvePromise, rejectPromise) => {
			const stderrChunks: Array<string> = [];
			const ffmpegProcess = spawn(ffmpegStaticPath, args, {
				stdio: ["ignore", "ignore", "pipe"],
			});

			ffmpegProcess.stderr.on("data", (chunk: Buffer) => {
				stderrChunks.push(chunk.toString());
			});

			ffmpegProcess.on("error", (error) => {
				rejectPromise(error);
			});

			ffmpegProcess.on("close", (exitCode) => {
				if (exitCode === 0) {
					resolvePromise();
					return;
				}

				rejectPromise(
					new Error(
						`${label} exited with code ${exitCode ?? -1}: ${stderrChunks.join("").trim()}`
					)
				);
			});
		});
	} catch (error) {
		throw error;
	}
}

async function resolveFontFilePath(): Promise<string | undefined> {
	try {
		const candidatePaths = [
			"/System/Library/Fonts/SFNS.ttf",
			"/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
			"/Library/Fonts/Arial.ttf",
		];
		const availabilityChecks = await Promise.all(
			candidatePaths.map(async (candidatePath) => {
				try {
					await access(candidatePath);
					return candidatePath;
				} catch (error) {
					if (error) {
						return undefined;
					}

					return undefined;
				}
			})
		);

		return availabilityChecks.find((value) => Boolean(value));
	} catch (error) {
		if (error) {
			return undefined;
		}

		return undefined;
	}
}

async function createSegmentForEntry({
	entry,
	failedCardDurationSeconds,
	fontFilePath,
	introCardDurationSeconds,
	outputSegmentPath,
	testIndex,
	totalTests,
}: {
	entry: VideoManifestEntry;
	failedCardDurationSeconds: number;
	fontFilePath?: string;
	introCardDurationSeconds: number;
	outputSegmentPath: string;
	testIndex: number;
	totalTests: number;
}): Promise<void> {
	try {
		const recordedVideoExists = await fileExists({ filePath: entry.copiedFilePath });
		const effectiveStatus =
			entry.status === "failed" || !recordedVideoExists ? "failed" : "passed";
		const effectiveLabel = !recordedVideoExists
			? `${entry.testLabel} (artifact missing)`
			: entry.testLabel;

		if (effectiveStatus === "failed") {
			const failedCardFilter = buildTitleCardVideoFilter({
				fontFilePath,
				isFailedOnlyCard: true,
				testIndex,
				testLabel: effectiveLabel,
				testStatus: "failed",
				totalTests,
			});
			const failedCardArgs = [
				"-y",
				"-f",
				"lavfi",
				"-i",
				`color=c=black:s=${VIDEO_LAYOUT.width}x${VIDEO_LAYOUT.height}:r=${VIDEO_LAYOUT.frameRate}:d=${failedCardDurationSeconds}`,
				"-vf",
				`${failedCardFilter},format=yuv420p`,
				"-an",
				"-c:v",
				"libx264",
				"-preset",
				"veryfast",
				"-crf",
				"20",
				"-pix_fmt",
				"yuv420p",
				"-movflags",
				"+faststart",
				outputSegmentPath,
			];

			await runFfmpeg({
				args: failedCardArgs,
				label: `Create failed card for ${entry.copiedFileName}`,
			});
			return;
		}

		const introCardFilter = buildTitleCardVideoFilter({
			fontFilePath,
			isFailedOnlyCard: false,
			testIndex,
			testLabel: effectiveLabel,
			testStatus: "passed",
			totalTests,
		});
		const filterComplex = [
			`[0:v]${introCardFilter},format=yuv420p[intro]`,
			`[1:v]fps=${VIDEO_LAYOUT.frameRate},scale=${VIDEO_LAYOUT.width}:${VIDEO_LAYOUT.height}:force_original_aspect_ratio=decrease,pad=${VIDEO_LAYOUT.width}:${VIDEO_LAYOUT.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[content]`,
			"[intro][content]concat=n=2:v=1:a=0[outv]",
		].join(";");
		const passedSegmentArgs = [
			"-y",
			"-f",
			"lavfi",
			"-i",
			`color=c=black:s=${VIDEO_LAYOUT.width}x${VIDEO_LAYOUT.height}:r=${VIDEO_LAYOUT.frameRate}:d=${introCardDurationSeconds}`,
			"-i",
			entry.copiedFilePath,
			"-filter_complex",
			filterComplex,
			"-map",
			"[outv]",
			"-an",
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-crf",
			"20",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			outputSegmentPath,
		];

		await runFfmpeg({
			args: passedSegmentArgs,
			label: `Create segment for ${entry.copiedFileName}`,
		});
	} catch (error) {
		throw error;
	}
}

async function createSegmentFiles({
	entries,
	failedCardDurationSeconds,
	fontFilePath,
	introCardDurationSeconds,
	temporaryDirectoryPath,
}: {
	entries: Array<VideoManifestEntry>;
	failedCardDurationSeconds: number;
	fontFilePath?: string;
	introCardDurationSeconds: number;
	temporaryDirectoryPath: string;
}): Promise<Array<string>> {
	try {
		const segmentPaths: Array<string> = [];

		await entries.reduce<Promise<void>>((chain, entry, index) => {
			return chain.then(async () => {
				const segmentPath = join(
					temporaryDirectoryPath,
					buildSegmentFileName({ testIndex: index })
				);

				await createSegmentForEntry({
					entry,
					failedCardDurationSeconds,
					fontFilePath,
					introCardDurationSeconds,
					outputSegmentPath: segmentPath,
					testIndex: index,
					totalTests: entries.length,
				});

				segmentPaths.push(segmentPath);
			});
		}, Promise.resolve());

		return segmentPaths;
	} catch (error) {
		throw error;
	}
}

async function concatenateSegments({
	outputPath,
	segmentPaths,
	temporaryDirectoryPath,
}: {
	outputPath: string;
	segmentPaths: Array<string>;
	temporaryDirectoryPath: string;
}): Promise<void> {
	try {
		const concatListPath = join(temporaryDirectoryPath, "concat-list.txt");
		const concatFileContents = `${segmentPaths
			.map((segmentPath) => `file '${escapeConcatPath({ filePath: segmentPath })}'`)
			.join("\n")}\n`;

		await writeFile(concatListPath, concatFileContents, "utf8");

		const concatArgs = [
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			concatListPath,
			"-an",
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-crf",
			"20",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			outputPath,
		];

		await runFfmpeg({
			args: concatArgs,
			label: "Concatenate all segment videos",
		});
	} catch (error) {
		throw error;
	}
}

async function readLatestRunMetadata(): Promise<LatestRunMetadata | undefined> {
	try {
		const latestRunMetadataPath = join(PATHS.runsRoot, FILE_NAMES.latestRun);
		const latestRunRawValue = await readFile(latestRunMetadataPath, "utf8");
		const parsedValue = JSON.parse(latestRunRawValue) as LatestRunMetadata;

		if (!parsedValue.runDirectoryPath || !parsedValue.manifestPath) {
			return undefined;
		}

		return parsedValue;
	} catch (error) {
		if (isErrnoCode({ error, code: "ENOENT" })) {
			return undefined;
		}

		if (error instanceof SyntaxError) {
			return undefined;
		}

		throw error;
	}
}

async function findLatestRunDirectoryPath(): Promise<string> {
	try {
		const entries = await readdir(PATHS.runsRoot, { withFileTypes: true });
		const runDirectories = entries
			.filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
			.map((entry) => join(PATHS.runsRoot, entry.name));

		if (runDirectories.length === 0) {
			throw new Error(`No run-* directories found in ${PATHS.runsRoot}`);
		}

		const runDirectoryStats = await Promise.all(
			runDirectories.map(async (runDirectoryPath) => {
				const runDirectoryStats = await stat(runDirectoryPath);
				return {
					modifiedAt: runDirectoryStats.mtimeMs,
					runDirectoryPath,
				};
			})
		);
		runDirectoryStats.sort(
			(left, right) => right.modifiedAt - left.modifiedAt
		);

		const latestRunDirectoryPath = runDirectoryStats[0]?.runDirectoryPath;
		if (!latestRunDirectoryPath) {
			throw new Error(`Failed to resolve latest run directory in ${PATHS.runsRoot}`);
		}

		return latestRunDirectoryPath;
	} catch (error) {
		throw error;
	}
}

async function resolveRunContext({
	options,
}: {
	options: CombineCliOptions;
}): Promise<RunContext> {
	try {
		if (options.runDirectoryPath) {
			const manifestPath =
				options.manifestPath ??
				join(options.runDirectoryPath, FILE_NAMES.manifest);
			const outputPath =
				options.outputPath ??
				join(options.runDirectoryPath, FILE_NAMES.combinedVideo);

			return {
				manifestPath,
				outputPath,
				runDirectoryPath: options.runDirectoryPath,
			};
		}

		const latestRunMetadata = await readLatestRunMetadata();
		if (latestRunMetadata) {
			return {
				manifestPath:
					options.manifestPath ?? latestRunMetadata.manifestPath,
				outputPath: options.outputPath ?? latestRunMetadata.combinedVideoPath,
				runDirectoryPath: latestRunMetadata.runDirectoryPath,
			};
		}

		const latestRunDirectoryPath = await findLatestRunDirectoryPath();
		return {
			manifestPath:
				options.manifestPath ??
				join(latestRunDirectoryPath, FILE_NAMES.manifest),
			outputPath:
				options.outputPath ??
				join(latestRunDirectoryPath, FILE_NAMES.combinedVideo),
			runDirectoryPath: latestRunDirectoryPath,
		};
	} catch (error) {
		throw error;
	}
}

async function readManifest({
	manifestPath,
}: {
	manifestPath: string;
}): Promise<VideoManifest> {
	try {
		const manifestRawValue = await readFile(manifestPath, "utf8");
		const parsedManifest = JSON.parse(manifestRawValue) as VideoManifest;

		if (!Array.isArray(parsedManifest.videos)) {
			throw new Error("manifest.videos must be an array");
		}

		return parsedManifest;
	} catch (error) {
		throw error;
	}
}

async function combineE2EVideos() {
	let temporaryDirectoryPath: string | undefined;

	try {
		const options = parseCliOptions({ argv: process.argv.slice(2) });
		const runContext = await resolveRunContext({ options });
		const manifest = await readManifest({ manifestPath: runContext.manifestPath });

		if (manifest.videos.length === 0) {
			process.stdout.write(
				`Manifest has no videos. Skipping combine for ${runContext.runDirectoryPath}\n`
			);
			return;
		}

		temporaryDirectoryPath = await mkdtemp(
			join(runContext.runDirectoryPath, "combine-temp-")
		);
		const fontFilePath = await resolveFontFilePath();
		const segmentPaths = await createSegmentFiles({
			entries: manifest.videos,
			failedCardDurationSeconds: options.failedCardDurationSeconds,
			fontFilePath,
			introCardDurationSeconds: options.introCardDurationSeconds,
			temporaryDirectoryPath,
		});

		await concatenateSegments({
			outputPath: runContext.outputPath,
			segmentPaths,
			temporaryDirectoryPath,
		});

		process.stdout.write(
			`Combined ${segmentPaths.length} E2E video segment(s) into ${runContext.outputPath}\n`
		);
	} catch (error) {
		process.stderr.write(
			`combine-e2e-videos failed: ${
				error instanceof Error ? error.message : String(error)
			}\n`
		);
		process.exitCode = 1;
	} finally {
		if (temporaryDirectoryPath) {
			try {
				await rm(temporaryDirectoryPath, { force: true, recursive: true });
			} catch (error) {
				if (error) {
					process.stderr.write(
						`combine-e2e-videos cleanup warning: ${
							error instanceof Error ? error.message : String(error)
						}\n`
					);
				}
			}
		}
	}
}

combineE2EVideos();
