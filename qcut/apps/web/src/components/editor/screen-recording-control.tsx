"use client";

import { Button } from "@/components/ui/button";
import {
  getCachedScreenRecordingStatus,
  getScreenRecordingStatus,
  registerScreenRecordingE2EBridge,
  startScreenRecording,
  stopScreenRecording,
  subscribeToScreenRecordingStatus,
} from "@/lib/screen-recording-controller";
import { Circle, Loader2, Square } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";
import type { ScreenRecordingStatus } from "@/types/electron";

const RECORDING_SHORTCUT_KEY = "r";

function formatDurationLabel({ durationMs }: { durationMs: number }): string {
  try {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  } catch {
    return "00:00";
  }
}

function isEditableTarget({ target }: { target: EventTarget | null }): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function ScreenRecordingControl() {
  const [status, setStatus] = useState<ScreenRecordingStatus>(
    getCachedScreenRecordingStatus()
  );
  const [isBusy, setIsBusy] = useState(false);
  const [tickMs, setTickMs] = useState(Date.now());

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const nextStatus = await getScreenRecordingStatus();
      setStatus(nextStatus);
    } catch (error) {
      console.error(
        "[ScreenRecordingControl] Failed to refresh status:",
        error
      );
    }
  }, []);

  useEffect(() => {
    try {
      registerScreenRecordingE2EBridge();
      const unsubscribe = subscribeToScreenRecordingStatus({
        listener: (nextStatus) => {
          setStatus(nextStatus);
        },
      });
      refreshStatus().catch((error) => {
        console.error(
          "[ScreenRecordingControl] Failed to refresh initial status:",
          error
        );
      });
      return () => {
        try {
          unsubscribe();
        } catch (error) {
          console.error(
            "[ScreenRecordingControl] Failed to unsubscribe from status events:",
            error
          );
        }
      };
    } catch (error) {
      console.error(
        "[ScreenRecordingControl] Failed to initialize recording bridge:",
        error
      );
      return () => {};
    }
  }, [refreshStatus]);

  useEffect(() => {
    if (!status.recording) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setTickMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [status.recording]);

  const elapsedLabel = useMemo(() => {
    if (!status.recording || !status.startedAt) {
      return "00:00";
    }
    const durationMs = Math.max(0, tickMs - status.startedAt);
    return formatDurationLabel({ durationMs });
  }, [status.recording, status.startedAt, tickMs]);

  const handleToggleRecording = useCallback(async (): Promise<void> => {
    if (isBusy) {
      return;
    }

    setIsBusy(true);
    try {
      if (status.recording) {
        const stopResult = await stopScreenRecording();
        if (stopResult.filePath) {
          toast("Screen recording saved", {
            description: stopResult.filePath,
          });
        } else {
          toast("Screen recording stopped");
        }
      } else {
        const startResult = await startScreenRecording();
        toast("Screen recording started", {
          description: `Saving to ${startResult.filePath}`,
        });
      }
      await refreshStatus();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown recording error";
      toast("Screen recording failed", {
        description: message,
      });
      console.error("[ScreenRecordingControl] Toggle failed:", error);
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, refreshStatus, status.recording]);

  const handleButtonKeyDown = useCallback(
    ({ key }: KeyboardEvent<HTMLButtonElement>): void => {
      try {
        if (key === "Enter" || key === " ") {
          return;
        }
      } catch (error) {
        console.error(
          "[ScreenRecordingControl] Button key handler failed:",
          error
        );
      }
    },
    []
  );

  const handleGlobalShortcut = useCallback(
    ({
      key,
      ctrlKey,
      metaKey,
      shiftKey,
      target,
      preventDefault,
    }: globalThis.KeyboardEvent): void => {
      try {
        const hasModifier = ctrlKey || metaKey;
        const shortcutMatches =
          hasModifier &&
          shiftKey &&
          key.toLowerCase() === RECORDING_SHORTCUT_KEY &&
          !isEditableTarget({ target });

        if (!shortcutMatches) {
          return;
        }

        preventDefault();
        handleToggleRecording().catch((error) => {
          console.error(
            "[ScreenRecordingControl] Failed to toggle recording via shortcut:",
            error
          );
        });
      } catch (error) {
        console.error(
          "[ScreenRecordingControl] Global shortcut handler failed:",
          error
        );
      }
    },
    [handleToggleRecording]
  );

  useEffect(() => {
    try {
      window.addEventListener("keydown", handleGlobalShortcut);
      return () => {
        try {
          window.removeEventListener("keydown", handleGlobalShortcut);
        } catch (error) {
          console.error(
            "[ScreenRecordingControl] Failed to unregister keyboard shortcut:",
            error
          );
        }
      };
    } catch (error) {
      console.error(
        "[ScreenRecordingControl] Failed to register keyboard shortcut:",
        error
      );
      return () => {};
    }
  }, [handleGlobalShortcut]);

  const recordingActive = status.recording;
  const buttonLabel = recordingActive ? `REC ${elapsedLabel}` : "Record";

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={
        recordingActive
          ? "h-7 text-xs border-red-500/60 text-red-600 hover:bg-red-50"
          : "h-7 text-xs"
      }
      onClick={() => {
        handleToggleRecording().catch((error) => {
          console.error(
            "[ScreenRecordingControl] Failed to toggle recording via button:",
            error
          );
        });
      }}
      onKeyDown={handleButtonKeyDown}
      disabled={isBusy}
      data-testid="screen-recording-toggle-button"
      title="Toggle screen recording (Ctrl/Cmd + Shift + R)"
    >
      {isBusy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : recordingActive ? (
        <Square className="h-4 w-4 fill-current" />
      ) : (
        <Circle className="h-4 w-4" />
      )}
      <span className="text-sm">{buttonLabel}</span>
    </Button>
  );
}
