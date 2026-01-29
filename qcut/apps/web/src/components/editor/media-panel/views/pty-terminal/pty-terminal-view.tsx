"use client";

import { useEffect } from "react";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";
import { TerminalEmulator } from "./terminal-emulator";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Square,
  RotateCcw,
  Terminal as TerminalIcon,
  Sparkles,
  Loader2,
  Brain,
  X,
  Bot,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CliProvider } from "@/types/cli-provider";
import { CLI_PROVIDERS, DEFAULT_OPENROUTER_MODELS, CLAUDE_MODELS } from "@/types/cli-provider";

export function PtyTerminalView() {
  const {
    sessionId,
    status,
    exitCode,
    error,
    cliProvider,
    selectedModel,
    selectedClaudeModel,
    activeSkill,
    connect,
    disconnect,
    setCliProvider,
    setSelectedModel,
    setSelectedClaudeModel,
    clearSkillContext,
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
          {/* Provider Selector */}
          <div className="flex items-center gap-2">
            <Select
              value={cliProvider}
              onValueChange={(value: CliProvider) => setCliProvider(value)}
              disabled={isConnected || isConnecting}
            >
              <SelectTrigger className="w-[140px] h-8" aria-label="Select CLI provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(CLI_PROVIDERS).map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    <div className="flex items-center gap-2">
                      {provider.id === "gemini" && <Sparkles className="h-3 w-3" />}
                      {provider.id === "codex" && <Bot className="h-3 w-3" />}
                      {provider.id === "claude" && <MessageSquare className="h-3 w-3" />}
                      {provider.id === "shell" && <TerminalIcon className="h-3 w-3" />}
                      <span>{provider.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Model Selector (only for Codex) */}
            {cliProvider === "codex" && (
              <Select
                value={selectedModel || ""}
                onValueChange={setSelectedModel}
                disabled={isConnected || isConnecting}
              >
                <SelectTrigger className="w-[180px] h-8" aria-label="Select AI model">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {DEFAULT_OPENROUTER_MODELS.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div className="flex flex-col">
                        <span className="text-sm">{model.name}</span>
                        <span className="text-xs text-muted-foreground">{model.provider}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Model Selector (only for Claude) */}
            {cliProvider === "claude" && (
              <Select
                value={selectedClaudeModel || ""}
                onValueChange={setSelectedClaudeModel}
                disabled={isConnected || isConnecting}
              >
                <SelectTrigger className="w-[160px] h-8" aria-label="Select Claude model">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {CLAUDE_MODELS.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div className="flex flex-col">
                        <span className="text-sm">{model.name}</span>
                        <span className="text-xs text-muted-foreground">{model.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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

          {/* Active Skill Badge */}
          {activeSkill && (
            <div className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 rounded-full">
              <Brain className="h-3 w-3 text-purple-500" aria-hidden="true" />
              <span className="text-xs text-purple-600 font-medium truncate max-w-[120px]">
                {activeSkill.name}
              </span>
              <button
                type="button"
                onClick={clearSkillContext}
                className="ml-0.5 text-purple-400 hover:text-destructive transition-colors"
                aria-label="Clear skill context"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
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
            {activeSkill ? (
              <>
                <Brain className="h-12 w-12 mb-4 text-purple-500" />
                <p className="text-sm font-medium text-foreground">
                  {activeSkill.name}
                </p>
                <p className="text-xs mt-1 opacity-70">
                  Click Start to run with {CLI_PROVIDERS[cliProvider].name}
                </p>
                {cliProvider === "codex" && (
                  <p className="text-xs mt-2 text-blue-400">
                    Using model: {selectedModel || "default"}
                  </p>
                )}
                {cliProvider === "claude" && (
                  <p className="text-xs mt-2 text-orange-400">
                    Using model: {selectedClaudeModel || "sonnet"}
                  </p>
                )}
                {cliProvider === "gemini" && (
                  <p className="text-xs mt-2 text-purple-400">
                    Skill instructions will be sent automatically
                  </p>
                )}
              </>
            ) : (
              <>
                {cliProvider === "gemini" && <Sparkles className="h-12 w-12 mb-4 opacity-50" />}
                {cliProvider === "codex" && <Bot className="h-12 w-12 mb-4 opacity-50" />}
                {cliProvider === "claude" && <MessageSquare className="h-12 w-12 mb-4 opacity-50" />}
                {cliProvider === "shell" && <TerminalIcon className="h-12 w-12 mb-4 opacity-50" />}
                <p className="text-sm">
                  Click Start to launch {CLI_PROVIDERS[cliProvider].name}
                </p>
                {cliProvider === "gemini" && (
                  <p className="text-xs mt-1 opacity-70">
                    Requires Google account authentication on first use
                  </p>
                )}
                {cliProvider === "codex" && (
                  <p className="text-xs mt-1 opacity-70">
                    Requires OpenRouter API key in Settings
                  </p>
                )}
                {cliProvider === "claude" && (
                  <p className="text-xs mt-1 opacity-70">
                    Requires Anthropic API key and claude CLI installed
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
