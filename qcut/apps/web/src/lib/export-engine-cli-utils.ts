import { debugWarn } from "@/lib/debug-config";

export type ElectronInvoke = (
  channel: string,
  ...args: unknown[]
) => Promise<unknown>;

export interface FileInfoLike {
  size: number;
}

export interface AudioValidationLike {
  error?: string;
  hasAudio?: boolean;
  duration?: number;
  info?: {
    streams?: unknown[];
  };
  valid?: boolean;
}

export function getOptionalInvoke(): ElectronInvoke | null {
  try {
    const maybeInvoke = (
      window.electronAPI as typeof window.electronAPI & {
        invoke?: ElectronInvoke;
      }
    )?.invoke;
    if (typeof maybeInvoke === "function") {
      return maybeInvoke;
    }
    return null;
  } catch (error) {
    debugWarn("[CLIExportEngine] Failed to access optional invoke API:", error);
    return null;
  }
}

export async function invokeIfAvailable({
  args = [],
  channel,
}: {
  args?: unknown[];
  channel: string;
}): Promise<unknown | null> {
  try {
    const invoke = getOptionalInvoke();
    if (!invoke) {
      return null;
    }
    return await invoke(channel, ...args);
  } catch (error) {
    debugWarn(
      `[CLIExportEngine] Optional invoke call failed for channel ${channel}:`,
      error
    );
    return null;
  }
}

export async function getFileInfo({
  filePath,
}: {
  filePath: string;
}): Promise<FileInfoLike | null> {
  try {
    if (!window.electronAPI) {
      return null;
    }
    const fileInfo = await window.electronAPI.getFileInfo(filePath);
    if (!fileInfo || typeof fileInfo.size !== "number") {
      return null;
    }
    return fileInfo;
  } catch {
    return null;
  }
}

export async function fileExists({
  filePath,
}: {
  filePath: string;
}): Promise<boolean> {
  try {
    const fileInfo = await getFileInfo({ filePath });
    if (fileInfo && fileInfo.size >= 0) {
      return true;
    }

    const legacyExists = await invokeIfAvailable({
      channel: "file-exists",
      args: [filePath],
    });
    return legacyExists === true;
  } catch (error) {
    debugWarn(
      `[CLIExportEngine] Failed to determine file existence for ${filePath}:`,
      error
    );
    return false;
  }
}

export async function validateAudioWithFfprobe({
  filePath,
}: {
  filePath: string;
}): Promise<AudioValidationLike | null> {
  try {
    const validation = await invokeIfAvailable({
      channel: "validate-audio-file",
      args: [filePath],
    });
    if (!validation || typeof validation !== "object") {
      return null;
    }

    return validation as AudioValidationLike;
  } catch (error) {
    debugWarn(
      `[CLIExportEngine] Failed to run optional ffprobe validation for ${filePath}:`,
      error
    );
    return null;
  }
}
