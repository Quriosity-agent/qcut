import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupPtyOnEditorExit } from "@/lib/pty-session-cleanup";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";

describe("cleanupPtyOnEditorExit", () => {
  beforeEach(() => {
    usePtyTerminalStore.setState({
      sessionId: null,
      status: "disconnected",
      exitCode: null,
      error: null,
      cols: 80,
      rows: 24,
      cliProvider: "claude",
      selectedModel: "anthropic/claude-sonnet-4",
      selectedClaudeModel: "opus",
      isGeminiMode: false,
      workingDirectory: "",
      activeSkill: null,
      skillPromptSent: false,
    });
  });

  it("disconnects an active PTY session", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    usePtyTerminalStore.setState({
      sessionId: "test-session",
      status: "connected",
      disconnect,
    });

    cleanupPtyOnEditorExit({ onError });
    await Promise.resolve();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("skips disconnect when no session exists", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    usePtyTerminalStore.setState({
      sessionId: null,
      disconnect,
    });

    cleanupPtyOnEditorExit({ onError });
    await Promise.resolve();

    expect(disconnect).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports disconnect failures", async () => {
    const disconnectError = new Error("kill failed");
    const disconnect = vi.fn().mockRejectedValue(disconnectError);
    const onError = vi.fn();

    usePtyTerminalStore.setState({
      sessionId: "test-session",
      status: "connected",
      disconnect,
    });

    cleanupPtyOnEditorExit({ onError });
    await Promise.resolve();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      "[Editor] Failed to disconnect PTY on editor unmount",
      disconnectError
    );
  });
});
