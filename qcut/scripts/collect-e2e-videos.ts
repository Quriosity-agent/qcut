import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

const PATHS = {
	rawArtifactsRoot: join(
		process.cwd(),
		"docs",
		"completed",
		"test-results-raw"
	),
	videoArtifactsRoot: join(process.cwd(), "docs", "completed", "e2e-videos"),
} as const;

const FILE_NAMES = {
	combinedVideo: "combined-e2e-run.mp4",
	latestRun: "latest-run.json",
	manifest: "manifest.json",
} as const;

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

/** Check whether an unknown error has a matching Node.js errno code. */
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

/** Build a filesystem-safe run directory name from a timestamp (e.g. `run-2026-02-21T10-30-00-000Z`). */
function createRunDirectoryName({ now }: { now: Date }): string {
	const isoValue = now.toISOString();
	const safeIsoValue = isoValue.replaceAll(":", "-").replaceAll(".", "-");
	return `run-${safeIsoValue}`;
}

/** Extract a human-readable test label from a Playwright artifact directory name. */
function buildTestLabel({
	testArtifactDirectoryName,
}: {
	testArtifactDirectoryName: string;
}): string {
	try {
		const withoutRuntimeSuffix = testArtifactDirectoryName.replace(
			/-electron$/,
			""
		);
		const parsedLabelMatch = withoutRuntimeSuffix.match(
			/^(.*)-([a-f0-9]{5})-(.+)$/i
		);
		const rawLabel = parsedLabelMatch?.[3] ?? withoutRuntimeSuffix;
		const normalizedLabel = rawLabel.replaceAll("-", " ").trim();

		if (normalizedLabel.length > 0) {
			return normalizedLabel;
		}

		return withoutRuntimeSuffix;
	} catch (error) {
		if (error) {
			return testArtifactDirectoryName;
		}

		return testArtifactDirectoryName;
	}
}

/** Recursively find all `.webm` and `.mp4` files under a directory. */
async function findVideoFiles({
	directoryPath,
}: {
	directoryPath: string;
}): Promise<Array<string>> {
	try {
		const entries = await readdir(directoryPath, { withFileTypes: true });
		const nestedResults = await Promise.all(
			entries.map(async (entry) => {
				const entryPath = join(directoryPath, entry.name);

				if (entry.isDirectory()) {
					return findVideoFiles({ directoryPath: entryPath });
				}

				if (
					entry.isFile() &&
					(entry.name.endsWith(".webm") || entry.name.endsWith(".mp4"))
				) {
					return [entryPath];
				}

				return [];
			})
		);

		return nestedResults.flat();
	} catch (error) {
		if (isErrnoCode({ error, code: "ENOENT" })) {
			return [];
		}

		throw error;
	}
}

/** Convert a nested source path to a flat destination filename by joining segments with `__`. */
function buildDestinationFileName({
	sourceRootPath,
	sourceFilePath,
}: {
	sourceRootPath: string;
	sourceFilePath: string;
}): string {
	const relativeSourcePath = relative(sourceRootPath, sourceFilePath);
	return relativeSourcePath.split(sep).join("__");
}

/** Determine pass/fail status by checking for `test-failed-*` marker files in the same directory. */
async function determineTestStatus({
	sourceFilePath,
}: {
	sourceFilePath: string;
}): Promise<"passed" | "failed"> {
	try {
		const sourceDirectoryPath = dirname(sourceFilePath);
		const siblingEntries = await readdir(sourceDirectoryPath, {
			withFileTypes: true,
		});
		const hasFailedMarker = siblingEntries.some((entry) => {
			if (!entry.isFile()) {
				return false;
			}

			return /^test-failed-\d+\./.test(entry.name);
		});

		return hasFailedMarker ? "failed" : "passed";
	} catch (error) {
		if (isErrnoCode({ error, code: "ENOENT" })) {
			return "passed";
		}

		throw error;
	}
}

/** Copy video files from raw Playwright output into a flat run directory with manifest entries. */
async function copyVideosToRunDirectory({
	sourceRootPath,
	sourceFilePaths,
	destinationRunDirectoryPath,
}: {
	sourceRootPath: string;
	sourceFilePaths: Array<string>;
	destinationRunDirectoryPath: string;
}): Promise<Array<VideoManifestEntry>> {
	const copyOperations = sourceFilePaths.map(async (sourceFilePath): Promise<VideoManifestEntry | null> => {
		const sourceRelativePath = relative(sourceRootPath, sourceFilePath);
		const destinationFileName = buildDestinationFileName({
			sourceRootPath,
			sourceFilePath,
		});
		const destinationFilePath = join(
			destinationRunDirectoryPath,
			destinationFileName
		);
		const relativePathSegments = sourceRelativePath.split(sep);
		const testArtifactDirectoryName = basename(relativePathSegments[0] ?? "");
		const status = await determineTestStatus({ sourceFilePath });
		const testLabel = buildTestLabel({ testArtifactDirectoryName });

		try {
			await copyFile(sourceFilePath, destinationFilePath);
		} catch (error) {
			if (!isErrnoCode({ error, code: "ENOENT" })) {
				throw error;
			}
			return null;
		}

		return {
			copiedFileName: destinationFileName,
			copiedFilePath: destinationFilePath,
			sourceRelativePath,
			status,
			testArtifactDirectoryName,
			testLabel,
		} satisfies VideoManifestEntry;
	});

	const results = await Promise.all(copyOperations);
	return results.filter((entry): entry is VideoManifestEntry => entry !== null);
}

/** Write the run manifest and latest-run pointer to disk. */
async function writeRunMetadata({
	latestRunMetadata,
	manifest,
}: {
	latestRunMetadata: LatestRunMetadata;
	manifest: VideoManifest;
}): Promise<void> {
	try {
		const manifestPath = join(manifest.runDirectoryPath, FILE_NAMES.manifest);
		const latestRunMetadataPath = join(
			PATHS.videoArtifactsRoot,
			FILE_NAMES.latestRun
		);

		await Promise.all([
			writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8"),
			writeFile(
				latestRunMetadataPath,
				JSON.stringify(latestRunMetadata, null, 2),
				"utf8"
			),
		]);
	} catch (error) {
		throw error;
	}
}

/** Main entry: scan raw artifacts, copy videos to a timestamped run folder, and write metadata. */
async function collectE2EVideos() {
	try {
		const videoFilePaths = await findVideoFiles({
			directoryPath: PATHS.rawArtifactsRoot,
		});

		if (videoFilePaths.length === 0) {
			process.stdout.write(
				`No E2E video artifacts found in ${PATHS.rawArtifactsRoot}\n`
			);
			return;
		}

		const sortedVideoFilePaths = [...videoFilePaths].sort((left, right) =>
			left.localeCompare(right)
		);
		const now = new Date();
		const runDirectoryName = createRunDirectoryName({ now });
		const destinationRunDirectoryPath = join(
			PATHS.videoArtifactsRoot,
			runDirectoryName
		);

		await mkdir(destinationRunDirectoryPath, { recursive: true });

		const copiedVideoEntries = await copyVideosToRunDirectory({
			sourceRootPath: PATHS.rawArtifactsRoot,
			sourceFilePaths: sortedVideoFilePaths,
			destinationRunDirectoryPath,
		});
		const createdAt = new Date().toISOString();
		const manifestPath = join(destinationRunDirectoryPath, FILE_NAMES.manifest);
		const manifest: VideoManifest = {
			createdAt,
			rawArtifactsRoot: PATHS.rawArtifactsRoot,
			runDirectoryName,
			runDirectoryPath: destinationRunDirectoryPath,
			videoCount: copiedVideoEntries.length,
			videos: copiedVideoEntries,
		};
		const latestRunMetadata: LatestRunMetadata = {
			combinedVideoPath: join(
				destinationRunDirectoryPath,
				FILE_NAMES.combinedVideo
			),
			createdAt,
			manifestPath,
			runDirectoryName,
			runDirectoryPath: destinationRunDirectoryPath,
		};

		await writeRunMetadata({
			latestRunMetadata,
			manifest,
		});

		process.stdout.write(
			`Copied ${copiedVideoEntries.length} E2E video file(s) to ${destinationRunDirectoryPath}\n`
		);
		process.stdout.write(`Wrote run manifest to ${manifestPath}\n`);
	} catch (error) {
		process.stderr.write(
			`collect-e2e-videos failed: ${
				error instanceof Error ? error.message : String(error)
			}\n`
		);
		process.exitCode = 1;
	}
}

collectE2EVideos();
