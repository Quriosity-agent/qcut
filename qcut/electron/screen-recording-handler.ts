import {
	app,
	BrowserWindow,
	desktopCapturer,
	ipcMain,
	session,
	type IpcMainInvokeEvent,
} from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getFFmpegPath } from "./ffmpeg/utils";

interface Logger {
	error(message?: unknown, ...optionalParams: unknown[]): void;
	warn(message?: unknown, ...optionalParams: unknown[]): void;
}

const noop = (): void => {};
let log: Logger = { error: noop, warn: noop };
import("electron-log/main")
	.then((module) => {
		log = module.default as Logger;
	})
	.catch(() => {
		// keep noop logger when electron-log isn't available
	});

const SCREEN_SOURCE_TYPE = {
	WINDOW: "window",
	SCREEN: "screen",
} as const;

const SCREEN_RECORDING_STATE = {
	IDLE: "idle",
	RECORDING: "recording",
} as const;

const SCREEN_RECORDING_OUTPUT_FORMAT = {
	WEBM: "webm",
	MP4: "mp4",
} as const;

const FILE_EXTENSION = {
	WEBM: ".webm",
	MP4: ".mp4",
} as const;

const DEFAULT_RECORDINGS_DIR_NAME = "QCut Recordings";
const DEFAULT_FILE_PREFIX = "qcut-screen-recording";

type ScreenSourceType =
	(typeof SCREEN_SOURCE_TYPE)[keyof typeof SCREEN_SOURCE_TYPE];
type ScreenRecordingState =
	(typeof SCREEN_RECORDING_STATE)[keyof typeof SCREEN_RECORDING_STATE];
type ScreenRecordingOutputFormat =
	(typeof SCREEN_RECORDING_OUTPUT_FORMAT)[keyof typeof SCREEN_RECORDING_OUTPUT_FORMAT];

interface ScreenCaptureSource {
	id: string;
	name: string;
	type: ScreenSourceType;
	displayId: string;
	isCurrentWindow: boolean;
}

interface StartScreenRecordingOptions {
	sourceId?: string;
	filePath?: string;
	fileName?: string;
	mimeType?: string;
}

interface StartScreenRecordingResult {
	sessionId: string;
	sourceId: string;
	sourceName: string;
	filePath: string;
	startedAt: number;
	mimeType: string | null;
}

interface AppendScreenRecordingChunkOptions {
	sessionId: string;
	chunk: Uint8Array;
}

interface AppendScreenRecordingChunkResult {
	bytesWritten: number;
}

interface StopScreenRecordingOptions {
	sessionId?: string;
	discard?: boolean;
}

interface StopScreenRecordingResult {
	success: boolean;
	filePath: string | null;
	bytesWritten: number;
	durationMs: number;
	discarded: boolean;
}

interface ScreenRecordingStatus {
	state: ScreenRecordingState;
	recording: boolean;
	sessionId: string | null;
	sourceId: string | null;
	sourceName: string | null;
	filePath: string | null;
	bytesWritten: number;
	startedAt: number | null;
	durationMs: number;
	mimeType: string | null;
}

interface ActiveScreenRecordingSession {
	sessionId: string;
	sourceId: string;
	sourceName: string;
	filePath: string;
	captureFilePath: string;
	outputFormat: ScreenRecordingOutputFormat;
	startedAt: number;
	bytesWritten: number;
	ownerWebContentsId: number;
	fileStream: fs.WriteStream;
	mimeType: string | null;
	writeQueue: Promise<void>;
}

let activeSession: ActiveScreenRecordingSession | null = null;
let isDisplayMediaHandlerConfigured = false;

function sanitizeFilename({ filename }: { filename: string }): string {
	try {
		const trimmedFilename = filename.trim();
		if (!trimmedFilename) {
			return "recording.mp4";
		}
		return trimmedFilename.replace(/[/\\?%*:|"<>]/g, "_");
	} catch {
		return "recording.mp4";
	}
}

function ensureExtension({
	filePath,
	extension,
}: {
	filePath: string;
	extension: string;
}): string {
	try {
		if (path.extname(filePath)) {
			return filePath;
		}
		return `${filePath}${extension}`;
	} catch {
		return `${filePath}${extension}`;
	}
}

function getPathExtension({ filePath }: { filePath: string }): string {
	try {
		return path.extname(filePath).toLowerCase();
	} catch {
		return "";
	}
}

function resolveOutputFormat({
	filePath,
}: {
	filePath: string;
}): ScreenRecordingOutputFormat {
	try {
		const extension = getPathExtension({ filePath });
		if (extension === FILE_EXTENSION.WEBM) {
			return SCREEN_RECORDING_OUTPUT_FORMAT.WEBM;
		}
		return SCREEN_RECORDING_OUTPUT_FORMAT.MP4;
	} catch {
		return SCREEN_RECORDING_OUTPUT_FORMAT.MP4;
	}
}

function replaceExtension({
	filePath,
	extension,
}: {
	filePath: string;
	extension: string;
}): string {
	try {
		const parsed = path.parse(filePath);
		return path.join(parsed.dir, `${parsed.name}${extension}`);
	} catch {
		return `${filePath}${extension}`;
	}
}

function normalizeOutputPathExtension({
	filePath,
}: {
	filePath: string;
}): string {
	const extension = getPathExtension({ filePath });
	const isSupportedOutputExtension =
		extension === FILE_EXTENSION.WEBM || extension === FILE_EXTENSION.MP4;

	if (isSupportedOutputExtension) {
		return filePath;
	}

	return replaceExtension({
		filePath,
		extension: FILE_EXTENSION.MP4,
	});
}

function getRecordingsDir(): string {
	try {
		return path.join(app.getPath("videos"), DEFAULT_RECORDINGS_DIR_NAME);
	} catch {
		return path.join(app.getPath("temp"), DEFAULT_RECORDINGS_DIR_NAME);
	}
}

function formatDateSegment({ date }: { date: Date }): string {
	const year = date.getFullYear().toString().padStart(4, "0");
	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");
	const seconds = date.getSeconds().toString().padStart(2, "0");
	return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function buildDefaultRecordingPath(): string {
	const timestamp = formatDateSegment({ date: new Date() });
	const filename = `${DEFAULT_FILE_PREFIX}-${timestamp}.mp4`;
	return path.join(getRecordingsDir(), filename);
}

function assertPathWithinAllowedDir({
	resolvedPath,
	allowedDir,
}: {
	resolvedPath: string;
	allowedDir: string;
}): void {
	const normalizedAllowed = path.resolve(allowedDir) + path.sep;
	const normalizedPath = path.resolve(resolvedPath);
	if (
		!normalizedPath.startsWith(normalizedAllowed) &&
		normalizedPath !== path.resolve(allowedDir)
	) {
		throw new Error("Output path must be within the recordings directory");
	}
}

function resolveOutputPath({
	filePath,
	fileName,
}: {
	filePath?: string;
	fileName?: string;
}): string {
	try {
		const recordingsDir = getRecordingsDir();

		if (filePath) {
			const absolutePath = path.isAbsolute(filePath)
				? filePath
				: path.join(recordingsDir, filePath);
			const resolved = path.resolve(absolutePath);
			assertPathWithinAllowedDir({
				resolvedPath: resolved,
				allowedDir: recordingsDir,
			});
			const outputPath = ensureExtension({
				filePath: resolved,
				extension: FILE_EXTENSION.MP4,
			});
			return normalizeOutputPathExtension({ filePath: outputPath });
		}

		if (fileName) {
			const safeFilename = sanitizeFilename({ filename: fileName });
			const filenameWithExtension = ensureExtension({
				filePath: safeFilename,
				extension: FILE_EXTENSION.MP4,
			});
			const normalizedFilename = normalizeOutputPathExtension({
				filePath: filenameWithExtension,
			});
			return path.join(recordingsDir, normalizedFilename);
		}

		return buildDefaultRecordingPath();
	} catch {
		return buildDefaultRecordingPath();
	}
}

function buildCaptureFilePath({
	outputPath,
	sessionId,
	outputFormat,
}: {
	outputPath: string;
	sessionId: string;
	outputFormat: ScreenRecordingOutputFormat;
}): string {
	try {
		if (outputFormat === SCREEN_RECORDING_OUTPUT_FORMAT.WEBM) {
			return outputPath;
		}

		const parsedPath = path.parse(outputPath);
		const captureFilename = `${parsedPath.name}-${sessionId}.capture.webm`;
		return path.join(parsedPath.dir, captureFilename);
	} catch {
		return `${outputPath}.${sessionId}.capture.webm`;
	}
}

async function ensureParentDirectory({
	filePath,
}: {
	filePath: string;
}): Promise<void> {
	try {
		const parentDirectory = path.dirname(filePath);
		await fs.promises.mkdir(parentDirectory, { recursive: true });
	} catch (error: unknown) {
		throw new Error(
			`Failed to create output directory: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

function mapSourceType({ sourceId }: { sourceId: string }): ScreenSourceType {
	if (sourceId.startsWith("screen:")) {
		return SCREEN_SOURCE_TYPE.SCREEN;
	}
	return SCREEN_SOURCE_TYPE.WINDOW;
}

async function listCaptureSources({
	currentWindowSourceId,
}: {
	currentWindowSourceId: string | null;
}): Promise<ScreenCaptureSource[]> {
	try {
		const sources = await desktopCapturer.getSources({
			types: ["window", "screen"],
			thumbnailSize: { width: 1, height: 1 },
			fetchWindowIcons: false,
		});

		return sources.map((source) => ({
			id: source.id,
			name: source.name,
			type: mapSourceType({ sourceId: source.id }),
			displayId: source.display_id,
			isCurrentWindow:
				Boolean(currentWindowSourceId) && source.id === currentWindowSourceId,
		}));
	} catch (error: unknown) {
		throw new Error(
			`Failed to list capture sources: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

function getCurrentWindowSourceId({
	event,
}: {
	event: IpcMainInvokeEvent;
}): string | null {
	try {
		const browserWindow = BrowserWindow.fromWebContents(event.sender);
		if (!browserWindow) {
			return null;
		}
		return browserWindow.getMediaSourceId();
	} catch {
		return null;
	}
}

function pickSource({
	sources,
	requestedSourceId,
	currentWindowSourceId,
}: {
	sources: ScreenCaptureSource[];
	requestedSourceId?: string;
	currentWindowSourceId: string | null;
}): ScreenCaptureSource {
	if (requestedSourceId) {
		const explicitSource = sources.find(
			(source) => source.id === requestedSourceId
		);
		if (explicitSource) {
			return explicitSource;
		}
		throw new Error(`Capture source not found: ${requestedSourceId}`);
	}

	if (currentWindowSourceId) {
		const currentWindowSource = sources.find(
			(source) => source.id === currentWindowSourceId
		);
		if (currentWindowSource) {
			return currentWindowSource;
		}
	}

	const preferredWindowSource = sources.find(
		(source) => source.type === SCREEN_SOURCE_TYPE.WINDOW
	);
	if (preferredWindowSource) {
		return preferredWindowSource;
	}

	const fallbackSource = sources[0];
	if (fallbackSource) {
		return fallbackSource;
	}

	throw new Error("No screen capture sources are available");
}

async function waitForStreamOpen({
	fileStream,
}: {
	fileStream: fs.WriteStream;
}): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const handleOpen = (): void => {
			cleanup();
			resolve();
		};
		const handleError = (error: Error): void => {
			cleanup();
			reject(error);
		};
		const cleanup = (): void => {
			fileStream.off("open", handleOpen);
			fileStream.off("error", handleError);
		};
		fileStream.once("open", handleOpen);
		fileStream.once("error", handleError);
	});
}

async function writeChunk({
	sessionData,
	chunk,
}: {
	sessionData: ActiveScreenRecordingSession;
	chunk: Uint8Array;
}): Promise<void> {
	const chunkBuffer = Buffer.from(chunk);
	await new Promise<void>((resolve, reject) => {
		sessionData.fileStream.write(chunkBuffer, (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

async function appendChunkToSession({
	sessionData,
	chunk,
}: {
	sessionData: ActiveScreenRecordingSession;
	chunk: Uint8Array;
}): Promise<number> {
	try {
		const queueHead = sessionData.writeQueue.catch(() => {
			// Keep queue usable even after prior append failure.
		});

		const writeTask = queueHead.then(async () => {
			await writeChunk({ sessionData, chunk });
			sessionData.bytesWritten += chunk.byteLength;
		});

		sessionData.writeQueue = writeTask;
		await writeTask;
		return sessionData.bytesWritten;
	} catch (error: unknown) {
		throw new Error(
			`Failed to append session chunk: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

async function closeStream({
	fileStream,
}: {
	fileStream: fs.WriteStream;
}): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const handleError = (error: Error): void => {
			cleanup();
			reject(error);
		};
		const handleClose = (): void => {
			cleanup();
			resolve();
		};
		const cleanup = (): void => {
			fileStream.off("error", handleError);
			fileStream.off("close", handleClose);
		};

		fileStream.once("error", handleError);
		fileStream.once("close", handleClose);
		fileStream.end();
	});
}

async function removeFileIfExists({
	filePath,
}: {
	filePath: string;
}): Promise<void> {
	try {
		await fs.promises.access(filePath, fs.constants.F_OK);
		await fs.promises.unlink(filePath);
	} catch {
		// nothing to do if file does not exist
	}
}

async function moveFile({
	sourcePath,
	targetPath,
}: {
	sourcePath: string;
	targetPath: string;
}): Promise<void> {
	try {
		await fs.promises.rename(sourcePath, targetPath);
	} catch (error: unknown) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError?.code !== "EXDEV") {
			throw new Error(
				`Failed to move file: ${error instanceof Error ? error.message : String(error)}`
			);
		}

		await fs.promises.copyFile(sourcePath, targetPath);
		await fs.promises.unlink(sourcePath);
	}
}

async function getFileSize({
	filePath,
}: {
	filePath: string;
}): Promise<number> {
	try {
		const fileStats = await fs.promises.stat(filePath);
		return fileStats.size;
	} catch {
		return 0;
	}
}

async function transcodeWebmToMp4({
	inputPath,
	outputPath,
}: {
	inputPath: string;
	outputPath: string;
}): Promise<void> {
	try {
		const ffmpegPath = getFFmpegPath();
		const args = [
			"-y",
			"-i",
			inputPath,
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-crf",
			"23",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			outputPath,
		];

		await new Promise<void>((resolve, reject) => {
			try {
				const ffmpegProcess = spawn(ffmpegPath, args, {
					stdio: ["ignore", "ignore", "pipe"],
					windowsHide: true,
				});

				const TRANSCODE_TIMEOUT_MS = 300_000;
				const timeout = setTimeout(() => {
					ffmpegProcess.kill();
					reject(
						new Error(
							`FFmpeg conversion timed out after ${TRANSCODE_TIMEOUT_MS}ms`
						)
					);
				}, TRANSCODE_TIMEOUT_MS);

				let stderrOutput = "";

				ffmpegProcess.stderr?.on("data", (chunk: Buffer) => {
					stderrOutput += chunk.toString();
				});

				ffmpegProcess.on("error", (error) => {
					clearTimeout(timeout);
					reject(
						new Error(
							`Failed to start FFmpeg process: ${error instanceof Error ? error.message : String(error)}`
						)
					);
				});

				ffmpegProcess.on("close", (code) => {
					clearTimeout(timeout);
					if (code === 0) {
						resolve();
						return;
					}
					reject(
						new Error(
							`FFmpeg conversion failed with code ${String(code)}: ${stderrOutput.trim() || "unknown error"}`
						)
					);
				});
			} catch (error: unknown) {
				reject(
					new Error(
						`Failed to configure FFmpeg process: ${error instanceof Error ? error.message : String(error)}`
					)
				);
			}
		});
	} catch (error: unknown) {
		throw new Error(
			`Failed to transcode recording to MP4: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

async function finalizeRecordingOutput({
	sessionData,
}: {
	sessionData: ActiveScreenRecordingSession;
}): Promise<string> {
	try {
		if (sessionData.outputFormat === SCREEN_RECORDING_OUTPUT_FORMAT.WEBM) {
			return sessionData.captureFilePath;
		}

		await transcodeWebmToMp4({
			inputPath: sessionData.captureFilePath,
			outputPath: sessionData.filePath,
		});
		await removeFileIfExists({ filePath: sessionData.captureFilePath });
		return sessionData.filePath;
	} catch (error: unknown) {
		const fallbackWebmPath = replaceExtension({
			filePath: sessionData.filePath,
			extension: FILE_EXTENSION.WEBM,
		});

		try {
			await moveFile({
				sourcePath: sessionData.captureFilePath,
				targetPath: fallbackWebmPath,
			});
			log.warn(
				"[ScreenRecordingIPC] MP4 conversion failed, falling back to WebM:",
				error
			);
			return fallbackWebmPath;
		} catch (fallbackError: unknown) {
			throw new Error(
				`Failed to finalize recording output: ${error instanceof Error ? error.message : String(error)}; fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
			);
		}
	}
}

async function cleanupSessionFiles({
	sessionData,
}: {
	sessionData: ActiveScreenRecordingSession;
}): Promise<void> {
	try {
		await removeFileIfExists({ filePath: sessionData.captureFilePath });
		if (sessionData.filePath !== sessionData.captureFilePath) {
			await removeFileIfExists({ filePath: sessionData.filePath });
		}
	} catch {
		// best-effort cleanup
	}
}

function buildStatus(): ScreenRecordingStatus {
	if (!activeSession) {
		return {
			state: SCREEN_RECORDING_STATE.IDLE,
			recording: false,
			sessionId: null,
			sourceId: null,
			sourceName: null,
			filePath: null,
			bytesWritten: 0,
			startedAt: null,
			durationMs: 0,
			mimeType: null,
		};
	}

	const durationMs = Math.max(0, Date.now() - activeSession.startedAt);
	return {
		state: SCREEN_RECORDING_STATE.RECORDING,
		recording: true,
		sessionId: activeSession.sessionId,
		sourceId: activeSession.sourceId,
		sourceName: activeSession.sourceName,
		filePath: activeSession.filePath,
		bytesWritten: activeSession.bytesWritten,
		startedAt: activeSession.startedAt,
		durationMs,
		mimeType: activeSession.mimeType,
	};
}

async function resolveSourceForDisplayRequest({
	sourceId,
}: {
	sourceId: string;
}): Promise<{ id: string; name: string } | null> {
	try {
		const sources = await desktopCapturer.getSources({
			types: ["window", "screen"],
			thumbnailSize: { width: 1, height: 1 },
			fetchWindowIcons: false,
		});
		const selectedSource = sources.find((source) => source.id === sourceId);
		if (!selectedSource) {
			return null;
		}
		return { id: selectedSource.id, name: selectedSource.name };
	} catch (error) {
		log.error("[ScreenRecordingIPC] Failed to resolve display source:", error);
		return null;
	}
}

function ensureDisplayMediaHandlerConfigured(): void {
	if (isDisplayMediaHandlerConfigured) {
		return;
	}

	try {
		session.defaultSession.setDisplayMediaRequestHandler(
			(_request, callback) => {
				const handleDisplayMediaRequest = async (): Promise<void> => {
					try {
						if (!activeSession) {
							callback({});
							return;
						}

						const source = await resolveSourceForDisplayRequest({
							sourceId: activeSession.sourceId,
						});
						if (!source) {
							callback({});
							return;
						}

						callback({ video: source });
					} catch (error) {
						log.error(
							"[ScreenRecordingIPC] Display media request handler failed:",
							error
						);
						callback({});
					}
				};

				handleDisplayMediaRequest().catch((error) => {
					log.error(
						"[ScreenRecordingIPC] Unexpected display media request error:",
						error
					);
					callback({});
				});
			},
			{ useSystemPicker: false }
		);

		isDisplayMediaHandlerConfigured = true;
	} catch (error) {
		log.error(
			"[ScreenRecordingIPC] Failed to configure display media handler:",
			error
		);
	}
}

export function setupScreenRecordingIPC(): void {
	ensureDisplayMediaHandlerConfigured();

	ipcMain.handle(
		"screen:getSources",
		async (event: IpcMainInvokeEvent): Promise<ScreenCaptureSource[]> => {
			try {
				const currentWindowSourceId = getCurrentWindowSourceId({ event });
				return await listCaptureSources({ currentWindowSourceId });
			} catch (error: unknown) {
				throw new Error(
					`Failed to fetch screen sources: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	);

	ipcMain.handle(
		"screen:startRecording",
		async (
			event: IpcMainInvokeEvent,
			options: StartScreenRecordingOptions = {}
		): Promise<StartScreenRecordingResult> => {
			let pendingStream: fs.WriteStream | null = null;
			let pendingOutputPath: string | null = null;
			let pendingCapturePath: string | null = null;

			try {
				if (activeSession) {
					throw new Error("Screen recording is already active");
				}

				const currentWindowSourceId = getCurrentWindowSourceId({ event });
				const sources = await listCaptureSources({ currentWindowSourceId });
				const selectedSource = pickSource({
					sources,
					requestedSourceId: options.sourceId,
					currentWindowSourceId,
				});

				const sessionId = randomUUID();
				const outputPath = resolveOutputPath({
					filePath: options.filePath,
					fileName: options.fileName,
				});
				const outputFormat = resolveOutputFormat({ filePath: outputPath });
				const captureFilePath = buildCaptureFilePath({
					outputPath,
					sessionId,
					outputFormat,
				});

				pendingOutputPath = outputPath;
				pendingCapturePath = captureFilePath;

				await ensureParentDirectory({ filePath: captureFilePath });

				const fileStream = fs.createWriteStream(captureFilePath, {
					flags: "w",
				});
				pendingStream = fileStream;
				await waitForStreamOpen({ fileStream });

				const startedAt = Date.now();
				activeSession = {
					sessionId,
					sourceId: selectedSource.id,
					sourceName: selectedSource.name,
					filePath: outputPath,
					captureFilePath,
					outputFormat,
					startedAt,
					bytesWritten: 0,
					ownerWebContentsId: event.sender.id,
					fileStream,
					mimeType: options.mimeType ?? null,
					writeQueue: Promise.resolve(),
				};

				return {
					sessionId,
					sourceId: selectedSource.id,
					sourceName: selectedSource.name,
					filePath: outputPath,
					startedAt,
					mimeType: options.mimeType ?? null,
				};
			} catch (error: unknown) {
				if (activeSession?.fileStream) {
					try {
						await closeStream({ fileStream: activeSession.fileStream });
					} catch {
						// best-effort stream cleanup
					}
				}

				if (
					pendingStream &&
					!pendingStream.closed &&
					!pendingStream.destroyed
				) {
					try {
						pendingStream.destroy();
					} catch {
						// best-effort stream cleanup
					}
				}

				if (activeSession) {
					const sessionToCleanup = activeSession;
					activeSession = null;
					await cleanupSessionFiles({ sessionData: sessionToCleanup });
				}

				if (pendingCapturePath) {
					await removeFileIfExists({ filePath: pendingCapturePath });
				}
				if (pendingOutputPath && pendingOutputPath !== pendingCapturePath) {
					await removeFileIfExists({ filePath: pendingOutputPath });
				}
				throw new Error(
					`Failed to start screen recording: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	);

	ipcMain.handle(
		"screen:appendChunk",
		async (
			event: IpcMainInvokeEvent,
			options: AppendScreenRecordingChunkOptions
		): Promise<AppendScreenRecordingChunkResult> => {
			try {
				if (!activeSession) {
					throw new Error("No active screen recording session");
				}

				if (event.sender.id !== activeSession.ownerWebContentsId) {
					throw new Error("Screen recording session owner mismatch");
				}

				if (options.sessionId !== activeSession.sessionId) {
					throw new Error("Invalid screen recording session id");
				}

				const bytesWritten = await appendChunkToSession({
					sessionData: activeSession,
					chunk: options.chunk,
				});

				return { bytesWritten };
			} catch (error: unknown) {
				throw new Error(
					`Failed to append recording chunk: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	);

	ipcMain.handle(
		"screen:stopRecording",
		async (
			event: IpcMainInvokeEvent,
			options: StopScreenRecordingOptions = {}
		): Promise<StopScreenRecordingResult> => {
			if (!activeSession) {
				return {
					success: true,
					filePath: null,
					bytesWritten: 0,
					durationMs: 0,
					discarded: true,
				};
			}

			try {
				if (event.sender.id !== activeSession.ownerWebContentsId) {
					throw new Error("Screen recording session owner mismatch");
				}

				if (
					options.sessionId &&
					options.sessionId !== activeSession.sessionId
				) {
					throw new Error("Invalid screen recording session id");
				}

				const sessionToStop = activeSession;
				const shouldDiscard = options.discard ?? false;
				const durationMs = Math.max(0, Date.now() - sessionToStop.startedAt);

				await sessionToStop.writeQueue;
				await closeStream({ fileStream: sessionToStop.fileStream });

				let finalPath: string | null = sessionToStop.filePath;
				let finalizedBytes = sessionToStop.bytesWritten;
				if (shouldDiscard) {
					await cleanupSessionFiles({ sessionData: sessionToStop });
					finalPath = null;
				} else {
					finalPath = await finalizeRecordingOutput({
						sessionData: sessionToStop,
					});
					finalizedBytes = await getFileSize({ filePath: finalPath });
				}

				activeSession = null;
				return {
					success: true,
					filePath: finalPath,
					bytesWritten: finalizedBytes || sessionToStop.bytesWritten,
					durationMs,
					discarded: shouldDiscard,
				};
			} catch (error: unknown) {
				const sessionToCleanup = activeSession;
				activeSession = null;

				if (sessionToCleanup) {
					try {
						await closeStream({ fileStream: sessionToCleanup.fileStream });
					} catch {
						// best-effort stream cleanup
					}
					await cleanupSessionFiles({ sessionData: sessionToCleanup });
				}

				throw new Error(
					`Failed to stop screen recording: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	);

	ipcMain.handle("screen:getStatus", (): ScreenRecordingStatus => {
		try {
			return buildStatus();
		} catch (error: unknown) {
			throw new Error(
				`Failed to fetch screen recording status: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	});
}

module.exports = { setupScreenRecordingIPC };

export default { setupScreenRecordingIPC };
