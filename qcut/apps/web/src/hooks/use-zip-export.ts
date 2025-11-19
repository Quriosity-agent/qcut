import { useState, useCallback } from "react";
import {
  ZipManager,
  downloadZipSafely,
  ZipExportOptions,
} from "@/lib/zip-manager";
import { MediaItem } from "@/stores/media-store";

export interface ExportProgress {
  phase:
    | "idle"
    | "adding"
    | "compressing"
    | "downloading"
    | "complete"
    | "error";
  progress: number;
  currentFile?: string;
  totalFiles: number;
  completedFiles: number;
  error?: string;
}

export function useZipExport() {
  const [exportState, setExportState] = useState<ExportProgress>({
    phase: "idle",
    progress: 0,
    totalFiles: 0,
    completedFiles: 0,
  });

  const exportToZip = useCallback(
    async (items: MediaItem[], options?: Partial<ZipExportOptions>) => {
      console.log("step 8a: use-zip-export exportToZip called", {
        itemsCount: items.length,
        itemsWithFile: items.filter(item => !!item.file).length,
        itemsWithLocalPath: items.filter(item => !!item.localPath).length,
        options,
      });

      if (items.length === 0) {
        console.log("step 8b: no items to export");
        return;
      }

      setExportState({
        phase: "adding",
        progress: 0,
        totalFiles: items.length,
        completedFiles: 0,
      });

      try {
        console.log("step 8c: creating ZipManager instance");
        const zipManager = new ZipManager();

        // Phase 1: Add files to ZIP
        console.log("step 8d: starting addMediaItems");
        await zipManager.addMediaItems(items, (progress) => {
          console.log("step 8e: addMediaItems progress", { progress });
          setExportState((prev) => ({
            ...prev,
            phase: "adding",
            progress: Math.round(progress * 40), // 40% for adding files
            completedFiles: Math.round(progress * items.length),
          }));
        });
        console.log("step 8f: addMediaItems complete");

        // Phase 2: Compress ZIP
        console.log("step 8g: starting compression");
        setExportState((prev) => ({
          ...prev,
          phase: "compressing",
          progress: 60,
        }));

        const zipBlob = await zipManager.generateZip(options);
        console.log("step 8h: compression complete", {
          blobSize: zipBlob.size,
          blobType: zipBlob.type,
        });

        // Phase 3: Download
        console.log("step 8i: starting download");
        setExportState((prev) => ({
          ...prev,
          phase: "downloading",
          progress: 90,
        }));

        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, -5);
        const filename = options?.filename || `media-export-${timestamp}.zip`;
        console.log("step 8j: calling downloadZipSafely", {
          filename,
          blobSize: zipBlob.size,
        });
        await downloadZipSafely(zipBlob, filename);
        console.log("step 8k: downloadZipSafely complete");

        // Complete
        console.log("step 8l: export complete, updating state");
        setExportState((prev) => ({
          ...prev,
          phase: "complete",
          progress: 100,
        }));

        // Reset after delay
        setTimeout(() => {
          setExportState({
            phase: "idle",
            progress: 0,
            totalFiles: 0,
            completedFiles: 0,
          });
        }, 2000);
      } catch (error) {
        setExportState((prev) => ({
          ...prev,
          phase: "error",
          error: error instanceof Error ? error.message : "Export failed",
        }));
      }
    },
    []
  );

  const resetExport = useCallback(() => {
    setExportState({
      phase: "idle",
      progress: 0,
      totalFiles: 0,
      completedFiles: 0,
    });
  }, []);

  return {
    exportState,
    exportToZip,
    resetExport,
    isExporting:
      exportState.phase !== "idle" &&
      exportState.phase !== "complete" &&
      exportState.phase !== "error",
  };
}
