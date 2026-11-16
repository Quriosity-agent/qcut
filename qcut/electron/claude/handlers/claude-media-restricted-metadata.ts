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

/** A file's identity as it is handed to another process, and back. */
interface SentFileIdentity {
	dev: string;
	ino: string;
}

interface MediaRef {
	mediaId: string;
	projectId: string;
}

type PersistRequest = MediaRef & {
	metadata: StickerLabRestrictedMediaMetadata;
};

type StageRequest = PersistRequest & {
	/** Where the media file of that id is, when there is one. */
	mediaFilePath: string;
};

type DiscardRequest = MediaRef & { written: SentFileIdentity };

/** What staging put there, or that the id's metadata is another file's. */
type StagedSidecar = { written: SentFileIdentity } | { taken: true };

/** The changes there are to a sidecar. */
export interface RestrictedMetadataChanges {
	persist(request: PersistRequest): Promise<void>;
	stage(request: StageRequest): Promise<StagedSidecar>;
	discard(request: DiscardRequest): Promise<void>;
	remove(request: MediaRef): Promise<void>;
}

/** The last change asked for each sidecar, in this process. */
const lastSidecarChange = new Map<string, Promise<unknown>>();

/**
 * Runs one change to a sidecar at a time, in the order they were asked for.
 * Writing, staging and removing each look at what is there and then act on
 * it; with another writer in between that look is stale, and a rename that
 * gives up would remove the sidecar an import had just put in the place of
 * its own.
 *
 * A change takes its turn the moment it is asked for: nothing is waited for
 * before this is called, or a later change could get ahead of it.
 *
 * This queue is all the coordination there is, because one process makes
 * every change (`makeRestrictedMetadataChangesThrough`): no change waits on
 * another process, and none is taken from one that has only paused.
 *
 * A change asked for by the other process has a time by which that process
 * stops waiting (`giveUpAt`) and goes on as if the change had failed. When
 * its turn comes later than that, it is not made: made then, it would be a
 * change nobody knows of (metadata staged for a rename that was given up).
 */
function oneSidecarChangeAtATime<Result>({
	sidecarPath,
	change,
	giveUpAt,
}: {
	sidecarPath: string;
	change: () => Promise<Result>;
	giveUpAt?: number;
}): Promise<Result> {
	const earlier = lastSidecarChange.get(sidecarPath) ?? Promise.resolve();
	const running = earlier.then(() => {
		if (giveUpAt !== undefined && Date.now() >= giveUpAt) {
			throw new Error(
				"The change to restricted media metadata waited for its turn longer than the request for it; it was not made"
			);
		}
		return change();
	});
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
 * A change that takes a sidecar away, in its turn. Where there is no
 * sidecar folder there is nothing to take away, and none is made for it.
 */
function removingSidecar({
	projectId,
	sidecarPath,
	change,
	giveUpAt,
}: {
	projectId: string;
	sidecarPath: string;
	change: () => Promise<void>;
	giveUpAt?: number;
}): Promise<void> {
	return oneSidecarChangeAtATime({
		sidecarPath,
		giveUpAt,
		change: async () => {
			if (!(await getExistingSidecarDirectory({ projectId }))) return;
			await change();
		},
	});
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

/** When a change asked for by another process is no longer to be made. */
interface Wait {
	giveUpAt?: number;
}

/** The changes, made in this process. */
const here = {
	async persist(
		{ mediaId, metadata, projectId }: PersistRequest,
		{ giveUpAt }: Wait = {}
	): Promise<void> {
		await oneSidecarChangeAtATime({
			sidecarPath: getSidecarPath({ mediaId, projectId }),
			giveUpAt,
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
	},

	async stage(
		{ mediaId, metadata, projectId, mediaFilePath }: StageRequest,
		{ giveUpAt }: Wait = {}
	): Promise<StagedSidecar> {
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
			giveUpAt,
			change: async () => {
				try {
					return await stage();
				} catch (error) {
					if (!isFileSystemError({ code: "EEXIST", error })) throw error;
				}
				const leftOver = await fs
					.lstat(sidecarPath, { bigint: true })
					.catch(() => undefined);
				const fileIsThere = () =>
					fs.access(mediaFilePath).then(
						() => true,
						() => false
					);
				if (
					!leftOver ||
					(await fileIsThere()) ||
					Date.now() - Number(leftOver.mtimeMs) < STAGED_FRESH_MS
				) {
					return;
				}
				await unlinkIfStill({ filePath: sidecarPath, identity: leftOver });
				try {
					return await stage();
				} catch (again) {
					if (!isFileSystemError({ code: "EEXIST", error: again })) throw again;
				}
			},
		});
		if (!staged) return { taken: true };
		const { dev, ino } = staged.written;
		return { written: { dev: String(dev), ino: String(ino) } };
	},

	// In turn with every other change to this sidecar: the look at which
	// file is there and its removal are then one step to them.
	discard(
		{ mediaId, projectId, written }: DiscardRequest,
		{ giveUpAt }: Wait = {}
	): Promise<void> {
		const sidecarPath = getSidecarPath({ mediaId, projectId });
		return removingSidecar({
			projectId,
			sidecarPath,
			giveUpAt,
			change: () =>
				unlinkIfStill({
					filePath: sidecarPath,
					identity: { dev: BigInt(written.dev), ino: BigInt(written.ino) },
				}),
		});
	},

	async remove(
		{ mediaId, projectId }: MediaRef,
		{ giveUpAt }: Wait = {}
	): Promise<void> {
		const sidecarPath = getSidecarPath({ mediaId, projectId });
		await removingSidecar({
			projectId,
			sidecarPath,
			giveUpAt,
			change: () => fs.unlink(sidecarPath),
		}).catch((error: unknown) => {
			// Not there, or gone with its folder while this waited its turn.
			if (!isFileSystemError({ code: "ENOENT", error })) throw error;
		});
	},
} satisfies RestrictedMetadataChanges;

/** Where the changes are made, when that is not this process. */
let elsewhere: RestrictedMetadataChanges | undefined;

/**
 * Has this process ask another one for every change to a sidecar.
 *
 * The HTTP API runs in a process of its own beside the app's main process,
 * which has media handlers too. Were both to change sidecars, each would
 * look at what is there and then act, with the other's change in between.
 * A lock between them would have to be taken over from a process that
 * ended, and so could be taken from one that had only paused. So one
 * process makes every change, in the order they are asked for, and the
 * other asks it (utility-http-server.ts sets this, utility-bridge.ts
 * answers). Reading stays in the process that asks.
 */
export function makeRestrictedMetadataChangesThrough(
	changes: RestrictedMetadataChanges | undefined
): void {
	elsewhere = changes;
}

/**
 * A change is given up this long before the asker stops waiting for it:
 * started later, its answer might not be back in time.
 */
const ANSWER_MARGIN_MS = 1000;

/**
 * One change, as another process asks it of the one that makes them.
 * `deadline` is when that process stops waiting for the answer (epoch
 * milliseconds): it then goes on as if the change had failed, so a change
 * whose turn has not come by then is not made.
 */
export function changeRestrictedMetadataHere({
	change,
	request,
	deadline,
}: {
	change: keyof RestrictedMetadataChanges;
	request: unknown;
	deadline?: number;
}): Promise<unknown> {
	const wait: Wait =
		deadline === undefined ? {} : { giveUpAt: deadline - ANSWER_MARGIN_MS };
	switch (change) {
		case "persist":
			return here.persist(request as PersistRequest, wait);
		case "stage":
			return here.stage(request as StageRequest, wait);
		case "discard":
			return here.discard(request as DiscardRequest, wait);
		case "remove":
			return here.remove(request as MediaRef, wait);
		default:
			throw new Error(`Unknown restricted metadata change: ${String(change)}`);
	}
}

export async function persistMediaRestrictedMetadata(
	request: PersistRequest
): Promise<void> {
	await (elsewhere ?? here).persist(request);
}

/**
 * Puts restricted metadata in place for a file that is about to take
 * `mediaId` (a file being renamed), ahead of the file, so that the file is
 * at no moment in the folder without it.
 *
 * The id may be another file's at that very moment: one that is taking the
 * same name. Metadata that is there is therefore never written over while
 * the file it belongs to exists (at `mediaFilePath`) or while it is fresh
 * (another move is bringing its file): `RestrictedMetadataTakenError`. Only
 * what a file that is gone left behind is replaced. And `discard` removes
 * what was staged here, not whatever has the path by then.
 */
export async function stageMediaRestrictedMetadata(
	request: StageRequest
): Promise<StagedRestrictedMetadata> {
	const changes = elsewhere ?? here;
	const staged = await changes.stage(request);
	if ("taken" in staged) {
		throw new RestrictedMetadataTakenError(request.mediaId);
	}
	const { mediaId, projectId } = request;
	return {
		discard: () =>
			changes.discard({ mediaId, projectId, written: staged.written }),
	};
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

export async function deleteMediaRestrictedMetadata(
	request: MediaRef
): Promise<void> {
	await (elsewhere ?? here).remove(request);
}
