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

    console.log("step 9: zip-manager starting addMediaItems", {
      totalItems: total,
      itemsWithFile: items.filter(item => !!item.file).length,
      itemsWithLocalPath: items.filter(item => !!item.localPath).length,
      itemsWithUrl: items.filter(item => !!item.url).length,
      electronAPIAvailable: !!window.electronAPI,
      readFileAvailable: !!window.electronAPI?.readFile,
    });

    if (DEBUG_ZIP_MANAGER)
      console.log("?? ZIP-MANAGER: Starting to add media items", {
        totalItems: total,
        generatedImages: items.filter(
          (item) => item.metadata?.source === "text2image"
        ).length,
      });

    for (const item of items) {
      console.log("step 9a: processing item", {
        index: completed,
        name: item.name,
        hasFile: !!item.file,
        hasLocalPath: !!item.localPath,
        localPath: item.localPath,
        hasUrl: !!item.url,
        url: item.url?.substring(0, 50),
        type: item.type,
      });
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

        // PRIORITY 1: AI-generated videos with localPath - read from disk for reliability
        // This ensures AI videos use actual disk data instead of potentially invalid blob URLs
        const isAIGenerated = item.metadata?.source === 'text2video' ||
                             item.metadata?.source === 'ai-generated' ||
                             item.name?.toLowerCase().includes('ai:') ||
                             item.name?.toLowerCase().includes('ai-video');

        if (isAIGenerated && item.localPath && window.electronAPI?.readFile) {
          console.log("step 9b-ai: AI video detected, prioritizing localPath read", {
            filename,
            localPath: item.localPath,
            metadataSource: item.metadata?.source,
            name: item.name,
          });

          try {
            const fileBuffer = await window.electronAPI.readFile(item.localPath);
            console.log("step 9b-ai-read: readFile returned for AI video", {
              bufferExists: !!fileBuffer,
              bufferLength: fileBuffer ? fileBuffer.length : 0,
            });

            if (fileBuffer) {
              const uint8Array = new Uint8Array(fileBuffer);
              const blob = new Blob([uint8Array], { type: item.type === "video" ? "video/mp4" : "application/octet-stream" });
              const file = new File([blob], filename, { type: blob.type });

              this.zip.file(filename, file);
              console.log("step 9b-ai-success: AI video added from localPath", {
                fileName: filename,
                fileSize: file.size,
                localPath: item.localPath,
              });
            } else {
              console.error("step 9b-ai-fail: Failed to read AI video from localPath", {
                name: item.name,
                localPath: item.localPath
              });
              // Fall through to try File object as backup
            }
          } catch (error) {
            console.error("step 9b-ai-error: Error reading AI video from localPath", {
              name: item.name,
              localPath: item.localPath,
              error: error instanceof Error ? error.message : String(error),
            });
            // Fall through to try File object as backup
          }
        }
        // PRIORITY 2: Regular files with File object (user uploads, etc)
        else if (item.file) {
          console.log("step 9b: adding file directly to ZIP", {
            filename,
            fileSize: item.file.size,
            fileType: item.file.type,
            isAIGenerated: false,
          });
          this.zip.file(filename, item.file);
          console.log("step 9c: file added successfully via File object");
          if (DEBUG_ZIP_MANAGER)
            console.log(
              "? ZIP-MANAGER: Added to ZIP:",
              "filename:",
              filename,
              "size:",
              item.file.size
            );
        }
        // PRIORITY 3: Non-AI files with localPath
        else if (item.localPath && window.electronAPI?.readFile) {
          // Handle local file path for Electron (AI videos saved to disk)
          console.log("step 9d: attempting to read local file", {
            localPath: item.localPath,
            electronAPIAvailable: !!window.electronAPI,
            readFileAvailable: !!window.electronAPI?.readFile,
          });
          try {
            const fileBuffer = await window.electronAPI.readFile(item.localPath);
            console.log("step 9e: readFile returned", {
              bufferExists: !!fileBuffer,
              bufferType: fileBuffer ? Object.prototype.toString.call(fileBuffer) : "null",
              bufferLength: fileBuffer ? fileBuffer.length : 0,
              isBuffer: fileBuffer ? Buffer.isBuffer(fileBuffer) : false,
            });
            if (fileBuffer) {
              // Convert Buffer to Uint8Array for Blob constructor
              console.log("step 9f: converting Buffer to Uint8Array", {
                bufferLength: fileBuffer.length,
              });
              const uint8Array = new Uint8Array(fileBuffer);
              console.log("step 9g: creating Blob", {
                uint8ArrayLength: uint8Array.length,
                uint8ArrayByteLength: uint8Array.byteLength,
              });
              const blob = new Blob([uint8Array], { type: item.type === "video" ? "video/mp4" : "application/octet-stream" });
              console.log("step 9h: creating File from Blob", {
                blobSize: blob.size,
                blobType: blob.type,
              });
              const file = new File([blob], filename, { type: blob.type });
              console.log("step 9i: adding File to ZIP", {
                fileName: filename,
                fileSize: file.size,
                fileType: file.type,
              });
              this.zip.file(filename, file);
              console.log("step 9j: local file added successfully to ZIP");
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
              console.warn("step 9k: readFile returned null/undefined", {
                name: item.name,
                localPath: item.localPath
              });
            }
          } catch (error) {
            console.error("step 9l: error reading local file", {
              name: item.name,
              localPath: item.localPath,
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : undefined
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
        console.log("step 9m: item processing complete", {
          itemName: item.name,
          completed,
          total,
          progress: `${completed}/${total}`,
        });
      } catch (error) {
        console.error(
          `step 9n: Failed to add ${item.name} to ZIP:`,
          error
        );
        // Continue with other files
      }
    }

    console.log("step 9o: all items processed", {
      totalProcessed: completed,
      totalItems: total,
      zipFiles: Object.keys(this.zip.files).length,
      zipFileNames: Object.keys(this.zip.files),
    });
  }

  async generateZip(options: Partial<ZipExportOptions> = {}): Promise<Blob> {
    const opts = { ...this.defaultOptions, ...options };

    console.log("step 10: generating ZIP blob", {
      filesInZip: Object.keys(this.zip.files).length,
      compression: opts.compression,
      compressionLevel: opts.compressionLevel,
    });

    const blob = await this.zip.generateAsync({
      type: "blob",
      compression: opts.compression,
      compressionOptions: {
        level: opts.compressionLevel ?? 6,
      },
      // Ensure proper Unicode handling
      platform: "UNIX", // Better Unicode support than DOS
      comment: "Created by QCut",
    });

    console.log("step 10a: ZIP blob generated", {
      blobSize: blob.size,
      blobType: blob.type,
      sizeKB: (blob.size / 1024).toFixed(2),
      sizeMB: (blob.size / 1024 / 1024).toFixed(2),
    });

    return blob;
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
  console.log("step 11: downloadZipSafely called", {
    blobSize: blob.size,
    blobType: blob.type,
    filename,
    electronAPIAvailable: !!window.electronAPI,
    saveBlobAvailable: !!window.electronAPI?.saveBlob,
  });

  // Check if running in Electron
  if (window.electronAPI?.saveBlob) {
    try {
      console.log("step 11a: converting blob to array buffer");
      // Convert blob to array buffer for Electron
      const arrayBuffer = await blob.arrayBuffer();
      console.log("step 11b: arrayBuffer created", {
        byteLength: arrayBuffer.byteLength,
      });

      const uint8Array = new Uint8Array(arrayBuffer);
      console.log("step 11c: calling electronAPI.saveBlob", {
        uint8ArrayLength: uint8Array.length,
        uint8ArrayByteLength: uint8Array.byteLength,
        filename,
      });

      const result = await window.electronAPI.saveBlob(uint8Array, filename);
      console.log("step 11d: saveBlob returned", {
        success: result.success,
        filePath: result.filePath,
        canceled: result.canceled,
        error: result.error,
      });

      if (result.success) {
        console.log("✅ ZIP saved successfully via Electron:", result.filePath);
        return;
      } else if (result.canceled) {
        console.log("ZIP save canceled by user");
        return;
      } else {
        console.error("Failed to save ZIP via Electron:", result.error);
        // Fall through to browser methods
      }
    } catch (error) {
      console.error("step 11e: Electron save failed", {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      // Fall through to browser methods
    }
  } else {
    console.log("step 11f: Electron API not available, using browser methods");
  }

  // Use modern File System Access API if available (browser)
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

  // Traditional download with navigation bug prevention (browser fallback)
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
