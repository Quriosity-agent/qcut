import JSZip from "jszip";
import { MediaItem } from "@/stores/media-store";

// Debug flag - set to true to enable console logging
const DEBUG_ZIP_MANAGER = process.env.NODE_ENV === "development" && false;

export interface ZipExportOptions {
  filename?: string;
  compression?: "DEFLATE" | "STORE";
  compressionLevel?: number;
  includeMetadata?: boolean;
}

export class ZipManager {
  private zip: JSZip;
  private readonly defaultOptions: ZipExportOptions = {
    filename: "media-export.zip",
    compression: "DEFLATE",
    compressionLevel: 6,
    includeMetadata: true,
  };

  constructor() {
    this.zip = new JSZip();
  }

  async addMediaItems(
    items: MediaItem[],
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const total = items.length;
    let completed = 0;

    if (DEBUG_ZIP_MANAGER)
      console.log("?? ZIP-MANAGER: Starting to add media items", {
        totalItems: total,
        generatedImages: items.filter(
          (item) => item.metadata?.source === "text2image"
        ).length,
      });

    for (const item of items) {
      try {
        // Get the filename
        let filename = item.name;

        // Fix missing extensions for generated images
        if (
          item.metadata?.source === "text2image" &&
          item.file &&
          !filename.includes(".")
        ) {
          const mimeType = item.file.type || "image/png";
          const extension = mimeType.split("/")[1] || "png";
          filename = `${filename}.${extension}`;
          if (DEBUG_ZIP_MANAGER)
            console.log(
              "?? ZIP-MANAGER: Fixed missing extension for generated image:",
              "originalName:",
              item.name,
              "fixedName:",
              filename,
              "mimeType:",
              mimeType
            );
        }

        // Resolve filename conflicts
        filename = this.resolveFilename(filename);

        if (DEBUG_ZIP_MANAGER)
          console.log(
            "?? ZIP-MANAGER: Processing item:",
            "name:",
            item.name,
            "finalFilename:",
            filename,
            "hasFile:",
            !!item.file,
            "type:",
            item.type,
            "isGenerated:",
            item.metadata?.source === "text2image"
          );

        // Add file to ZIP directly, or fetch when only a URL is available (supports http(s) and blob:)
        if (item.file) {
          this.zip.file(filename, item.file);
          if (DEBUG_ZIP_MANAGER)
            console.log(
              "? ZIP-MANAGER: Added to ZIP:",
              "filename:",
              filename,
              "size:",
              item.file.size
            );
        } else if (item.localPath && window.electronAPI?.readFile) {
          // Handle local file path for Electron (AI videos saved to disk)
          try {
            const fileBuffer = await window.electronAPI.readFile(item.localPath);
            if (fileBuffer) {
              // Convert Buffer to Uint8Array for Blob constructor
              const uint8Array = new Uint8Array(fileBuffer);
              const blob = new Blob([uint8Array], { type: item.type === "video" ? "video/mp4" : "application/octet-stream" });
              const file = new File([blob], filename, { type: blob.type });
              this.zip.file(filename, file);
              if (DEBUG_ZIP_MANAGER)
                console.log(
                  "? ZIP-MANAGER: Added local file to ZIP:",
                  "filename:",
                  filename,
                  "localPath:",
                  item.localPath,
                  "size:",
                  file.size
                );
            } else {
              console.warn("step 8: export-all zip failed to read local file", {
                name: item.name,
                localPath: item.localPath
              });
            }
          } catch (error) {
            console.error("step 8: export-all zip error reading local file", {
              name: item.name,
              localPath: item.localPath,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        } else {
          const originalUrl = (item as any).originalUrl as string | undefined;
          const urlToFetch =
            (originalUrl && typeof originalUrl === "string" && originalUrl) ||
            item.url;

          if (urlToFetch && (urlToFetch.startsWith("http") || urlToFetch.startsWith("blob:"))) {
            try {
              const resp = await fetch(urlToFetch);
              if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}`);
              }
              const blob = await resp.blob();
              const inferredType =
                blob.type ||
                (item.type === "video"
                  ? "video/mp4"
                  : item.type === "audio"
                    ? "audio/mpeg"
                    : "application/octet-stream");

              const hasExtension = filename.includes(".");
              let finalFilename = filename;
              if (!hasExtension) {
                const extensionFromType =
                  inferredType.split("/")[1] || "bin";
                finalFilename = `${filename}.${extensionFromType}`;
              }

              const fetchedFile = new File([blob], finalFilename, {
                type: inferredType,
              });
              this.zip.file(finalFilename, fetchedFile);
              if (DEBUG_ZIP_MANAGER)
                console.log("? ZIP-MANAGER: Fetched URL-only item into ZIP", {
                  filename: finalFilename,
                  size: fetchedFile.size,
                  type: inferredType,
                  url: urlToFetch,
                });
            } catch (fetchError) {
              console.warn("step 8: export-all zip fetch failed", {
                name: item.name,
                url: urlToFetch,
                error:
                  fetchError instanceof Error
                    ? fetchError.message
                    : String(fetchError),
              });
            }
          } else {
            console.warn("step 8: export-all zip skipped item (no file or fetchable url)", {
              name: item.name,
              hasFile: !!item.file,
              url: item.url,
              originalUrl,
            });
          }
        }

        completed++;
        onProgress?.(completed / total);
      } catch (error) {
        console.error(
          `? ZIP-MANAGER: Failed to add ${item.name} to ZIP:`,
          error
        );
        // Continue with other files
      }
    }
  }

  async generateZip(options: Partial<ZipExportOptions> = {}): Promise<Blob> {
    const opts = { ...this.defaultOptions, ...options };

    return await this.zip.generateAsync({
      type: "blob",
      compression: opts.compression,
      compressionOptions: {
        level: opts.compressionLevel ?? 6,
      },
      // Ensure proper Unicode handling
      platform: "UNIX", // Better Unicode support than DOS
      comment: "Created by QCut",
    });
  }

  private resolveFilename(originalName: string): string {
    const files = Object.keys(this.zip.files);
    let filename = this.sanitizeFilenameForWindows(originalName);
    let counter = 1;

    while (files.includes(filename)) {
      const ext = originalName.split(".").pop();
      const base = originalName.replace(`.${ext}`, "");
      filename = `${this.sanitizeFilenameForWindows(base)} (${counter}).${ext}`;
      counter++;
    }

    return filename;
  }

  private sanitizeFilenameForWindows(filename: string): string {
    // Windows reserved characters (excluding control characters for simplicity)
    const reservedChars = /[<>:"|?*]/g;

    // Windows reserved names
    const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

    let sanitized = filename.replace(reservedChars, "_");

    // Handle reserved names
    if (reservedNames.test(sanitized)) {
      sanitized = `file_${sanitized}`;
    }

    // Ensure Unicode characters are properly encoded
    return sanitized.normalize("NFC");
  }

  reset(): void {
    this.zip = new JSZip();
  }
}

// Safe download utility to replace the problematic one
export async function downloadZipSafely(
  blob: Blob,
  filename: string
): Promise<void> {
  // Use modern File System Access API if available
  if ("showSaveFilePicker" in window) {
    try {
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "ZIP files",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });

      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      // Fall back to traditional download if user cancels or API unavailable
    }
  }

  // Traditional download with navigation bug prevention
  const url = URL.createObjectURL(blob);

  // Create download in a way that prevents navigation
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (iframeDoc) {
    const link = iframeDoc.createElement("a");
    link.href = url;
    link.download = filename;
    iframeDoc.body.appendChild(link);
    link.click();
    iframeDoc.body.removeChild(link);
  }

  // Cleanup
  setTimeout(() => {
    document.body.removeChild(iframe);
    URL.revokeObjectURL(url);
  }, 100);
}
