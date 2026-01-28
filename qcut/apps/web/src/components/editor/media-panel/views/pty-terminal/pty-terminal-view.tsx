"use client";

import { useEffect } from "react";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";
import { TerminalEmulator } from "./terminal-emulator";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Play,
  Square,
  RotateCcw,
  Terminal as TerminalIcon,
  Sparkles,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function PtyTerminalView() {
  const {
    sessionId,
    status,
    exitCode,
    error,
    isGeminiMode,
    connect,
    disconnect,
    setGeminiMode,
  } = usePtyTerminalStore();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const currentSessionId = usePtyTerminalStore.getState().sessionId;
      if (currentSessionId) {
        window.electronAPI?.pty?.kill(currentSessionId);
      }
      window.electronAPI?.pty?.removeListeners();
    };
  }, []);

  const handleStart = async () => {
    await connect();
  };

  const handleStop = async () => {
    await disconnect();
  };

  const handleRestart = async () => {
    await disconnect();
    // Small delay to ensure cleanup
    setTimeout(() => {
      connect();
    }, 100);
  };

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <div className="flex flex-col h-full">
      {/* Header Controls */}
      <div className="flex items-center justify-between p-2 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          {/* Mode Toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="gemini-mode"
              checked={isGeminiMode}
              onCheckedChange={setGeminiMode}
              disabled={isConnected || isConnecting}
              aria-label="Toggle Gemini CLI mode"
            />
            <Label
              htmlFor="gemini-mode"
              className="text-sm flex items-center gap-1 cursor-pointer"
            >
              {isGeminiMode ? (
                <>
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  Gemini CLI
                </>
              ) : (
                <>
                  <TerminalIcon className="h-3 w-3" aria-hidden="true" />
                  Shell
                </>
              )}
            </Label>
          </div>

          {/* Status Indicator */}
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                status === "connected" && "bg-green-500",
                status === "connecting" && "bg-yellow-500 animate-pulse",
                status === "disconnected" && "bg-gray-400",
                status === "error" && "bg-red-500"
              )}
              aria-hidden="true"
            />
            <span className="text-xs text-muted-foreground capitalize">
              {status}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          {!isConnected && !isConnecting && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleStart}
              aria-label="Start terminal session"
            >
              <Play className="h-4 w-4 mr-1" aria-hidden="true" />
              Start
            </Button>
          )}

          {isConnecting && (
            <Button type="button" variant="outline" size="sm" disabled>
              <Loader2
                className="h-4 w-4 mr-1 animate-spin"
                aria-hidden="true"
              />
              Connecting...
            </Button>
          )}

          {isConnected && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRestart}
                aria-label="Restart terminal session"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleStop}
                aria-label="Stop terminal session"
              >
                <Square className="h-4 w-4 mr-1" aria-hidden="true" />
                Stop
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-2 bg-destructive/10 border-b border-destructive/20">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Exit Code Display */}
      {exitCode !== null && status === "disconnected" && (
        <div className="p-2 bg-muted/50 border-b">
          <p className="text-sm text-muted-foreground">
            Process exited with code {exitCode}
          </p>
        </div>
      )}

      {/* Terminal Area */}
      <div className="flex-1 bg-[#1a1a1a] overflow-hidden">
        {isConnected || isConnecting ? (
          <TerminalEmulator sessionId={sessionId} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <TerminalIcon className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-sm">
              {isGeminiMode
                ? "Click Start to launch Gemini CLI"
                : "Click Start to open a terminal"}
            </p>
            {isGeminiMode && (
              <p className="text-xs mt-1 opacity-70">
                Requires Google account authentication on first use
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
