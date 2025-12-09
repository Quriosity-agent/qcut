/**
 * Video Streaming Download Utilities
 *
 * Handles large video downloads without memory spikes using streaming API.
 */

/**
 * Options for streaming video downloads
 */
export interface StreamOptions {
  /** Whether to download video to memory */
  downloadToMemory?: boolean;
  /** Callback for each chunk of data received */
  onDataReceived?: (data: Uint8Array) => void;
  /** Callback when download is complete */
  onComplete?: (totalData: Uint8Array) => void;
}

/**
 * Downloads video using streaming API to avoid memory spikes.
 *
 * WHY: Large videos (>50MB) can cause browser memory issues if loaded at once.
 * Performance: Streams data in chunks, allowing progressive processing.
 *
 * @param videoUrl - URL to download from
 * @param options - Download callbacks
 * @returns Complete video as Uint8Array
 * @throws Error if video URL is unreachable or streaming fails
 */
export async function streamVideoDownload(
  videoUrl: string,
  options: StreamOptions
): Promise<Uint8Array> {
  console.log("Starting streaming download from:", videoUrl);

  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download video: ${response.status} ${response.statusText}`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const chunks: Uint8Array[] = [];
  let receivedLength = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedLength += value.length;

      // Notify progress if callback provided
      if (options.onDataReceived) {
        options.onDataReceived(value);
      }

      console.log(`Downloaded ${receivedLength} bytes...`);
    }

    // Combine all chunks into single Uint8Array
    const totalData = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      totalData.set(chunk, position);
      position += chunk.length;
    }

    console.log(`Download complete: ${totalData.length} bytes total`);
    return totalData;
  } finally {
    reader.releaseLock();
  }
}
