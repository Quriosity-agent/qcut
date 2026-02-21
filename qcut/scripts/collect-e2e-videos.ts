import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const PATHS = {
	rawArtifactsRoot: join(
		process.cwd(),
		"docs",
		"completed",
		"test-results-raw"
	),
	videoArtifactsRoot: join(process.cwd(), "docs", "completed", "e2e-videos"),
} as const;

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

function createRunDirectoryName({ now }: { now: Date }): string {
	const isoValue = now.toISOString();
	const safeIsoValue = isoValue.replaceAll(":", "-").replaceAll(".", "-");
	return `run-${safeIsoValue}`;
}

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

function buildDestinationFileName({
	sourceRootPath,
	sourceFilePath,
}: {
	sourceRootPath: string;
	sourceFilePath: string;
}): string {
	const relativeSourcePath = relative(sourceRootPath, sourceFilePath);
	// Flatten nested test artifact paths while keeping file names deterministic.
	return relativeSourcePath.split(sep).join("__");
}

async function copyVideosToRunDirectory({
	sourceRootPath,
	sourceFilePaths,
	destinationRunDirectoryPath,
}: {
	sourceRootPath: string;
	sourceFilePaths: Array<string>;
	destinationRunDirectoryPath: string;
}): Promise<Array<string>> {
	const copyOperations = sourceFilePaths.map(async (sourceFilePath) => {
		const destinationFileName = buildDestinationFileName({
			sourceRootPath,
			sourceFilePath,
		});
		const destinationFilePath = join(
			destinationRunDirectoryPath,
			destinationFileName
		);

		await copyFile(sourceFilePath, destinationFilePath);
		return destinationFilePath;
	});

	return Promise.all(copyOperations);
}

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

		const runDirectoryName = createRunDirectoryName({ now: new Date() });
		const destinationRunDirectoryPath = join(
			PATHS.videoArtifactsRoot,
			runDirectoryName
		);

		await mkdir(destinationRunDirectoryPath, { recursive: true });

		const copiedVideoPaths = await copyVideosToRunDirectory({
			sourceRootPath: PATHS.rawArtifactsRoot,
			sourceFilePaths: videoFilePaths,
			destinationRunDirectoryPath,
		});

		process.stdout.write(
			`Copied ${copiedVideoPaths.length} E2E video file(s) to ${destinationRunDirectoryPath}\n`
		);
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
