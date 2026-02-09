import { useEffect } from "react";
import { toast } from "sonner";

/**
 * FFmpeg health check notification.
 * Mount once at the root level (e.g., in __root.tsx).
 * Queries the cached health check result from the main process and
 * shows a warning toast if FFmpeg or FFprobe binaries are not working.
 */
export function FFmpegHealthNotification() {
  useEffect(() => {
    const checkHealth = window.electronAPI?.ffmpeg?.checkHealth;
    if (!checkHealth) return;

    checkHealth()
      .then((result) => {
        if (result.ffmpegOk && result.ffprobeOk) return;

        const failed: string[] = [];
        if (!result.ffmpegOk) failed.push("FFmpeg");
        if (!result.ffprobeOk) failed.push("FFprobe");

        toast.warning("Video export may not work", {
          description: `${failed.join(" and ")} binary not found or not executable. Try reinstalling QCut.`,
          duration: 15_000,
        });
      })
      .catch(() => {
        // Silently ignore — health check IPC not available
      });
  }, []);

  return null;
}
