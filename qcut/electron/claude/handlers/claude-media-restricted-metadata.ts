import { createHash, randomUUID } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { StickerLabRestrictedMediaMetadata } from "../../types/sticker-lab-media-metadata.js";
import { parseStickerLabRestrictedMediaMetadata } from "../../types/sticker-lab-media-metadata.js";
import {
	requireExactKeys,
	requireRecord,
	requireString,
} from "../../types/strict-json-validation.js";
import { getMediaPath } from "../utils/helpers.js";
import { claudeLog } from "../utils/logger.js";

const HANDLER_NAME = "Media";
const SIDECAR_DIRECTORY_NAME = ".qcut-restricted-media";
const SIDECAR_MAX_BYTES = 16 * 1024 * 1024;
const SIDECAR_VERSION = 1;

interface RestrictedMediaSidecar {
	mediaId: string;
	metadata: StickerLabRestrictedMediaMetadata;
	version: typeof SIDECAR_VERSION;
}

function isFileSystemError({
	code,
	error,
}: {
	code: string;
	error: unknown;
}): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === code
	);
}

function requireMediaId({ mediaId }: { mediaId: string }): string {
	return requireString({
		label: "Restricted media ID",
		maximumLength: 512,
		value: mediaId,
	});
}

function getSidecarDirectory({ projectId }: { projectId: string }): string {
	return path.join(getMediaPath(projectId), SIDECAR_DIRECTORY_NAME);
}

function getSidecarPath({
	mediaId,
	projectId,
}: {
	mediaId: string;
	projectId: string;
}): string {
	const normalizedMediaId = requireMediaId({ mediaId });
	const fileName = `${createHash("sha256")
		.update(normalizedMediaId, "utf8")
		.digest("hex")}.json`;
	return path.join(getSidecarDirectory({ projectId }), fileName);
}

async function ensureSidecarDirectory({
	projectId,
}: {
	projectId: string;
}): Promise<string> {
	const mediaPath = getMediaPath(projectId);
	const sidecarDirectory = getSidecarDirectory({ projectId });
	await fs.mkdir(mediaPath, { recursive: true });
	try {
		await fs.mkdir(sidecarDirectory, { mode: 0o700 });
	} catch (error) {
		if (!isFileSystemError({ code: "EEXIST", error })) throw error;
	}
	const stat = await fs.lstat(sidecarDirectory);
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error("Restricted media sidecar path must be a local directory.");
	}
	await fs.chmod(sidecarDirectory, 0o700);
	return sidecarDirectory;
}

async function getExistingSidecarDirectory({
	projectId,
}: {
	projectId: string;
}): Promise<string | undefined> {
	const sidecarDirectory = getSidecarDirectory({ projectId });
	let stat: Awaited<ReturnType<typeof fs.lstat>>;
	try {
		stat = await fs.lstat(sidecarDirectory);
	} catch (error) {
		if (isFileSystemError({ code: "ENOENT", error })) return;
		throw error;
	}
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error("Restricted media sidecar path must be a local directory.");
	}
	return sidecarDirectory;
}

function parseSidecar({
	candidate,
	expectedMediaId,
}: {
	candidate: unknown;
	expectedMediaId: string;
}): RestrictedMediaSidecar {
	const record = requireRecord({
		label: "Restricted media sidecar",
		value: candidate,
	});
	requireExactKeys({
		keys: ["version", "mediaId", "metadata"],
		label: "Restricted media sidecar",
		record,
	});
	if (record.version !== SIDECAR_VERSION) {
		throw new Error("Restricted media sidecar version is unsupported.");
	}
	const mediaId = requireMediaId({
		mediaId: requireString({
			label: "Restricted media sidecar mediaId",
			maximumLength: 512,
			value: record.mediaId,
		}),
	});
	if (mediaId !== expectedMediaId) {
		throw new Error(
			"Restricted media sidecar mediaId does not match its file."
		);
	}
	return {
		mediaId,
		metadata: parseStickerLabRestrictedMediaMetadata({
			candidate: record.metadata,
			label: "Restricted media sidecar metadata",
		}),
		version: SIDECAR_VERSION,
	};
}

/** One file, told from any other that later has its path. */
interface FileIdentity {
	dev: bigint;
	ino: bigint;
}

/** The last change asked for each sidecar, in this process. */
const lastSidecarChange = new Map<string, Promise<unknown>>();

/**
 * Runs one change to a sidecar at a time. Writing, staging and removing each
 * look at what is there and then act on it; with another writer in between
 * that look is stale, and a rename that gives up would remove the sidecar an
 * import had just put in the place of its own.
 */
function oneSidecarChangeAtATime<Result>({
	sidecarPath,
	change,
}: {
	sidecarPath: string;
	change: () => Promise<Result>;
}): Promise<Result> {
	const earlier = lastSidecarChange.get(sidecarPath) ?? Promise.resolve();
	const running = earlier.then(change);
	const settled = running.then(
		() => undefined,
		() => undefined
	);
	lastSidecarChange.set(sidecarPath, settled);
	settled.then(() => {
		if (lastSidecarChange.get(sidecarPath) === settled) {
			lastSidecarChange.delete(sidecarPath);
		}
	});
	return running;
}

/**
 * Writes a media id's sidecar to a file of its own beside where it goes,
 * and hands that file to `publish` to put in place. The file is removed if
 * it was not.
 */
async function writeSidecar({
	mediaId,
	metadata,
	projectId,
	publish,
}: {
	mediaId: string;
	metadata: StickerLabRestrictedMediaMetadata;
	projectId: string;
	/** Puts the file in place; answers which file is there, if not that one. */
	publish: (paths: {
		temporaryPath: string;
		destinationPath: string;
	}) => Promise<FileIdentity | undefined>;
}): Promise<{ destinationPath: string; written: FileIdentity }> {
	const normalizedMediaId = requireMediaId({ mediaId });
	const normalizedMetadata = parseStickerLabRestrictedMediaMetadata({
		candidate: metadata,
		label: "Restricted media metadata",
	});
	const sidecar: RestrictedMediaSidecar = {
		mediaId: normalizedMediaId,
		metadata: normalizedMetadata,
		version: SIDECAR_VERSION,
	};
	const serializedSidecar = `${JSON.stringify(sidecar)}\n`;
	if (Buffer.byteLength(serializedSidecar, "utf8") > SIDECAR_MAX_BYTES) {
		throw new Error("Restricted media sidecar exceeds its storage limit.");
	}
	const directory = await ensureSidecarDirectory({ projectId });
	const destinationPath = getSidecarPath({
		mediaId: normalizedMediaId,
		projectId,
	});
	const temporaryPath = path.join(
		directory,
		`.${path.basename(destinationPath)}.${randomUUID()}.tmp`
	);
	let handle: fs.FileHandle | undefined;
	try {
		handle = await fs.open(temporaryPath, "wx", 0o600);
		await handle.writeFile(serializedSidecar, "utf8");
		await handle.chmod(0o600);
		await handle.sync();
		const { dev, ino } = await handle.stat({ bigint: true });
		await handle.close();
		handle = undefined;
		const published = await publish({ temporaryPath, destinationPath });
		return { destinationPath, written: published ?? { dev, ino } };
	} catch (error) {
		await handle?.close().catch(() => undefined);
		await fs.unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
}

export async function persistMediaRestrictedMetadata({
	mediaId,
	metadata,
	projectId,
}: {
	mediaId: string;
	metadata: StickerLabRestrictedMediaMetadata;
	projectId: string;
}): Promise<void> {
	await oneSidecarChangeAtATime({
		sidecarPath: getSidecarPath({ mediaId, projectId }),
		change: () =>
			writeSidecar({
				mediaId,
				metadata,
				projectId,
				publish: async ({
					temporaryPath,
					destinationPath,
				}): Promise<undefined> => {
					await fs.rename(temporaryPath, destinationPath);
				},
			}),
	});
}

/** The media id already has restricted metadata, which is another file's. */
export class RestrictedMetadataTakenError extends Error {
	constructor(mediaId: string) {
		super(`Media ${mediaId} already has restricted metadata`);
		this.name = "RestrictedMetadataTakenError";
	}
}

/** Metadata put in place for a file that is about to take a media id. */
export interface StagedRestrictedMetadata {
	/** Takes it away again, unless other metadata has replaced it since. */
	discard: () => Promise<void>;
}

/**
 * A sidecar with no media file is left over from a file that is gone, unless
 * it was only just written: then a move of another file is taking that id.
 */
const STAGED_FRESH_MS = 60_000;

/**
 * Puts the file in place only where nothing is, and never over a sidecar:
 * by a hard link, which takes the name only when it is free, or, on a
 * volume without hard links, by a copy that refuses an existing name.
 */
async function publishWhereNothingIs({
	temporaryPath,
	destinationPath,
}: {
	temporaryPath: string;
	destinationPath: string;
}): Promise<FileIdentity | undefined> {
	let copied: FileIdentity | undefined;
	try {
		await fs.link(temporaryPath, destinationPath);
	} catch (error) {
		if (isFileSystemError({ code: "EEXIST", error })) throw error;
		await fs.copyFile(
			temporaryPath,
			destinationPath,
			fileSystemConstants.COPYFILE_EXCL
		);
		// The copy is another file than the one that was written.
		const { dev, ino } = await fs.lstat(destinationPath, { bigint: true });
		copied = { dev, ino };
	}
	await fs.unlink(temporaryPath);
	return copied;
}

/**
 * Puts restricted metadata in place for a file that is about to take
 * `mediaId` (a file being renamed), ahead of the file, so that the file is
 * at no moment in the folder without it.
 *
 * The id may be another file's at that very moment: one that is taking the
 * same name. Metadata that is there is therefore never written over while
 * the file it belongs to exists (`mediaFileExists`) or while it is fresh
 * (another move is bringing its file): `RestrictedMetadataTakenError`. Only
 * what a file that is gone left behind is replaced. And `discard` removes
 * what was staged here, not whatever has the path by then.
 */
export async function stageMediaRestrictedMetadata({
	mediaId,
	metadata,
	projectId,
	mediaFileExists,
}: {
	mediaId: string;
	metadata: StickerLabRestrictedMediaMetadata;
	projectId: string;
	mediaFileExists: () => Promise<boolean>;
}): Promise<StagedRestrictedMetadata> {
	const sidecarPath = getSidecarPath({ mediaId, projectId });
	const stage = () =>
		writeSidecar({
			mediaId,
			metadata,
			projectId,
			publish: publishWhereNothingIs,
		});
	const staged = await oneSidecarChangeAtATime({
		sidecarPath,
		change: async () => {
			try {
				return await stage();
			} catch (error) {
				if (!isFileSystemError({ code: "EEXIST", error })) throw error;
			}
			const leftOver = await fs
				.lstat(sidecarPath, { bigint: true })
				.catch(() => undefined);
			if (
				!leftOver ||
				(await mediaFileExists()) ||
				Date.now() - Number(leftOver.mtimeMs) < STAGED_FRESH_MS
			) {
				throw new RestrictedMetadataTakenError(mediaId);
			}
			await unlinkIfStill({ filePath: sidecarPath, identity: leftOver });
			try {
				return await stage();
			} catch (again) {
				if (!isFileSystemError({ code: "EEXIST", error: again })) throw again;
				throw new RestrictedMetadataTakenError(mediaId);
			}
		},
	});
	return {
		// In turn with every other change to this sidecar: the look at which
		// file is there and its removal are then one step to them.
		discard: () =>
			oneSidecarChangeAtATime({
				sidecarPath,
				change: () =>
					unlinkIfStill({
						filePath: staged.destinationPath,
						identity: staged.written,
					}),
			}),
	};
}

/** Removes the file at `filePath` if it is the one `identity` names. */
async function unlinkIfStill({
	filePath,
	identity,
}: {
	filePath: string;
	identity: FileIdentity;
}): Promise<void> {
	const now = await fs.lstat(filePath, { bigint: true }).catch(() => undefined);
	if (!now || now.dev !== identity.dev || now.ino !== identity.ino) return;
	await fs.unlink(filePath).catch((error: unknown) => {
		if (!isFileSystemError({ code: "ENOENT", error })) throw error;
	});
}

export async function readMediaRestrictedMetadata({
	mediaId,
	projectId,
}: {
	mediaId: string;
	projectId: string;
}): Promise<StickerLabRestrictedMediaMetadata | undefined> {
	let normalizedMediaId: string;
	let sidecarPath: string;
	let handle: fs.FileHandle | undefined;
	try {
		normalizedMediaId = requireMediaId({ mediaId });
		if (!(await getExistingSidecarDirectory({ projectId }))) return;
		sidecarPath = getSidecarPath({ mediaId: normalizedMediaId, projectId });
		handle = await fs.open(
			sidecarPath,
			fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW
		);
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size < 2 || stat.size > SIDECAR_MAX_BYTES) {
			throw new Error(
				"Restricted media sidecar is not a bounded regular file."
			);
		}
		const buffer = Buffer.alloc(stat.size);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const verifiedStat = await handle.stat();
		if (
			bytesRead !== stat.size ||
			verifiedStat.size !== stat.size ||
			verifiedStat.dev !== stat.dev ||
			verifiedStat.ino !== stat.ino
		) {
			throw new Error("Restricted media sidecar changed while it was read.");
		}
		const raw = buffer.subarray(0, bytesRead).toString("utf8");
		return parseSidecar({
			candidate: JSON.parse(raw),
			expectedMediaId: normalizedMediaId,
		}).metadata;
	} catch (error) {
		if (isFileSystemError({ code: "ENOENT", error })) return;
		claudeLog.warn(
			HANDLER_NAME,
			`Refusing invalid restricted metadata for media ${mediaId}`
		);
		throw error;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

export async function deleteMediaRestrictedMetadata({
	mediaId,
	projectId,
}: {
	mediaId: string;
	projectId: string;
}): Promise<void> {
	if (!(await getExistingSidecarDirectory({ projectId }))) return;
	const sidecarPath = getSidecarPath({ mediaId, projectId });
	await oneSidecarChangeAtATime({
		sidecarPath,
		change: async () => {
			try {
				await fs.unlink(sidecarPath);
			} catch (error) {
				if (!isFileSystemError({ code: "ENOENT", error })) throw error;
			}
		},
	});
}
