import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  type IpcMainInvokeEvent,
} from "electron";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

const SCREEN_SOURCE_TYPE = {
  WINDOW: "window",
  SCREEN: "screen",
} as const;

const SCREEN_RECORDING_STATE = {
  IDLE: "idle",
  RECORDING: "recording",
} as const;

const DEFAULT_RECORDINGS_DIR_NAME = "QCut Recordings";
const DEFAULT_FILE_PREFIX = "qcut-screen-recording";

type ScreenSourceType =
  (typeof SCREEN_SOURCE_TYPE)[keyof typeof SCREEN_SOURCE_TYPE];
type ScreenRecordingState =
  (typeof SCREEN_RECORDING_STATE)[keyof typeof SCREEN_RECORDING_STATE];

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
  startedAt: number;
  bytesWritten: number;
  ownerWebContentsId: number;
  fileStream: fs.WriteStream;
  mimeType: string | null;
}

let activeSession: ActiveScreenRecordingSession | null = null;
let isDisplayMediaHandlerConfigured = false;

function sanitizeFilename({ filename }: { filename: string }): string {
  try {
    const trimmedFilename = filename.trim();
    if (!trimmedFilename) {
      return "recording.webm";
    }
    return trimmedFilename.replace(/[/\\?%*:|"<>]/g, "_");
  } catch {
    return "recording.webm";
  }
}

function ensureWebmExtension({ filePath }: { filePath: string }): string {
  try {
    if (path.extname(filePath)) {
      return filePath;
    }
    return `${filePath}.webm`;
  } catch {
    return `${filePath}.webm`;
  }
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
  const filename = `${DEFAULT_FILE_PREFIX}-${timestamp}.webm`;
  return path.join(getRecordingsDir(), filename);
}

function resolveOutputPath({
  filePath,
  fileName,
}: {
  filePath?: string;
  fileName?: string;
}): string {
  try {
    if (filePath) {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(getRecordingsDir(), filePath);
      return ensureWebmExtension({ filePath: absolutePath });
    }

    if (fileName) {
      const safeFilename = sanitizeFilename({ filename: fileName });
      const filenameWithExtension = ensureWebmExtension({ filePath: safeFilename });
      return path.join(getRecordingsDir(), filenameWithExtension);
    }

    return buildDefaultRecordingPath();
  } catch {
    return buildDefaultRecordingPath();
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
    console.error("[ScreenRecordingIPC] Failed to resolve display source:", error);
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
        void (async () => {
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
            console.error(
              "[ScreenRecordingIPC] Display media request handler failed:",
              error
            );
            callback({});
          }
        })();
      },
      { useSystemPicker: false }
    );

    isDisplayMediaHandlerConfigured = true;
  } catch (error) {
    console.error(
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

        const outputPath = resolveOutputPath({
          filePath: options.filePath,
          fileName: options.fileName,
        });
        await ensureParentDirectory({ filePath: outputPath });

        const fileStream = fs.createWriteStream(outputPath, { flags: "w" });
        pendingStream = fileStream;
        await waitForStreamOpen({ fileStream });

        const sessionId = randomUUID();
        const startedAt = Date.now();
        activeSession = {
          sessionId,
          sourceId: selectedSource.id,
          sourceName: selectedSource.name,
          filePath: outputPath,
          startedAt,
          bytesWritten: 0,
          ownerWebContentsId: event.sender.id,
          fileStream,
          mimeType: options.mimeType ?? null,
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

        if (pendingStream && !pendingStream.closed && !pendingStream.destroyed) {
          try {
            pendingStream.destroy();
          } catch {
            // best-effort stream cleanup
          }
        }

        if (activeSession?.filePath) {
          const filePathToCleanup = activeSession.filePath;
          activeSession = null;
          await removeFileIfExists({ filePath: filePathToCleanup });
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

        await writeChunk({ sessionData: activeSession, chunk: options.chunk });
        activeSession.bytesWritten += options.chunk.byteLength;

        return { bytesWritten: activeSession.bytesWritten };
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

        if (options.sessionId && options.sessionId !== activeSession.sessionId) {
          throw new Error("Invalid screen recording session id");
        }

        const sessionToStop = activeSession;
        const shouldDiscard = options.discard ?? false;
        const durationMs = Math.max(0, Date.now() - sessionToStop.startedAt);

        await closeStream({ fileStream: sessionToStop.fileStream });

        let finalPath: string | null = sessionToStop.filePath;
        if (shouldDiscard) {
          await removeFileIfExists({ filePath: sessionToStop.filePath });
          finalPath = null;
        }

        activeSession = null;
        return {
          success: true,
          filePath: finalPath,
          bytesWritten: sessionToStop.bytesWritten,
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
          try {
            await removeFileIfExists({ filePath: sessionToCleanup.filePath });
          } catch {
            // best-effort cleanup
          }
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
