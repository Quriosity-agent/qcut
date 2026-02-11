import type { ExportSettings } from "@/types/export";
import { FORMAT_INFO } from "@/types/export";
import { FFmpegVideoRecorder } from "@/lib/ffmpeg-video-recorder";
import { debugLog } from "@/lib/debug-config";

/** Mutable context for recorder operations */
export interface RecorderContext {
  canvas: HTMLCanvasElement;
  settings: ExportSettings;
  mediaRecorder: MediaRecorder | null;
  recordedChunks: Blob[];
  useFFmpegExport: boolean;
  ffmpegRecorder: FFmpegVideoRecorder | null;
  fps: number;
}

/** Get video bitrate based on quality settings */
export function getVideoBitrate(quality: string): number {
  const bitrates: Record<string, number> = {
    "1080p": 8_000_000, // 8 Mbps
    "720p": 5_000_000, // 5 Mbps
    "480p": 2_500_000, // 2.5 Mbps
  };

  return bitrates[quality] || bitrates["720p"];
}

/** Setup MediaRecorder for canvas capture with proper timing */
export function setupMediaRecorder(
  context: RecorderContext,
  existingStream?: MediaStream
): void {
  if (context.mediaRecorder) {
    return; // Already set up
  }

  if (context.useFFmpegExport) {
    debugLog("[ExportEngine] Skipping MediaRecorder setup - using FFmpeg WASM");
    return;
  }

  const stream = existingStream || context.canvas.captureStream(0);

  const formatInfo = FORMAT_INFO[context.settings.format];
  let selectedMimeType = formatInfo.mimeTypes[0];

  for (const mimeType of formatInfo.mimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      selectedMimeType = mimeType;
      break;
    }
  }

  const videoBitrate = getVideoBitrate(context.settings.quality);
  const options: MediaRecorderOptions = {
    mimeType: selectedMimeType as string,
    videoBitsPerSecond: videoBitrate,
  };

  if (!MediaRecorder.isTypeSupported(selectedMimeType)) {
    options.mimeType = "video/webm;codecs=vp8";
  }

  const mediaRecorder = new MediaRecorder(stream, options);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      context.recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    // Recording stopped
  };

  context.mediaRecorder = mediaRecorder;
}

/** Start recording */
export async function startRecording(context: RecorderContext): Promise<void> {
  if (context.useFFmpegExport) {
    if (!context.ffmpegRecorder) {
      context.ffmpegRecorder = new FFmpegVideoRecorder({
        fps: context.fps,
        settings: context.settings,
      });
    }
    await context.ffmpegRecorder.startRecording();
    return;
  }

  if (!context.mediaRecorder) {
    setupMediaRecorder(context);
  }

  if (context.mediaRecorder && context.mediaRecorder.state === "inactive") {
    context.recordedChunks.length = 0;
    context.mediaRecorder.start(100);
  }
}

/** Stop recording and return the video blob */
export async function stopRecording(context: RecorderContext): Promise<Blob> {
  if (context.useFFmpegExport && context.ffmpegRecorder) {
    return await context.ffmpegRecorder.stopRecording();
  }

  if (!context.mediaRecorder) {
    throw new Error("MediaRecorder not initialized");
  }

  const totalSize = context.recordedChunks.reduce(
    (total, chunk) => total + chunk.size,
    0
  );
  debugLog(
    `[ExportEngine] Export complete: ${totalSize} bytes, ${context.recordedChunks.length} chunks`
  );

  const recorder = context.mediaRecorder;
  const mimeType = recorder.mimeType || "video/webm";

  return new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(context.recordedChunks, { type: mimeType });
      resolve(blob);
    };

    if (recorder.state === "recording") {
      recorder.stop();
    } else {
      const blob = new Blob(context.recordedChunks, { type: mimeType });
      resolve(blob);
    }
  });
}
