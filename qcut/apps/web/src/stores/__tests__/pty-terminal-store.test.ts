import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";
import { mockElectronAPI, setupElectronMock } from "@/test/mocks/electron";

describe("usePtyTerminalStore", () => {
  let cleanupElectron: () => void;

  beforeEach(() => {
    // Setup Electron mock
    cleanupElectron = setupElectronMock();

    // Reset store state
    usePtyTerminalStore.setState({
      sessionId: null,
      status: "disconnected",
      exitCode: null,
      error: null,
      cols: 80,
      rows: 24,
      isGeminiMode: true,
      workingDirectory: "",
    });

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupElectron();
  });

  describe("initial state", () => {
    it("should have correct default values", () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      expect(result.current.sessionId).toBeNull();
      expect(result.current.status).toBe("disconnected");
      expect(result.current.exitCode).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.cols).toBe(80);
      expect(result.current.rows).toBe(24);
      expect(result.current.isGeminiMode).toBe(true);
      expect(result.current.workingDirectory).toBe("");
    });
  });

  describe("connect", () => {
    it("should connect successfully and update status", async () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      // Initially disconnected
      expect(result.current.status).toBe("disconnected");

      // Connect
      await act(async () => {
        await result.current.connect();
      });

      // Should be connected after completion
      expect(result.current.status).toBe("connected");
      expect(result.current.sessionId).toBe("test-pty-session");
    });

    it("should spawn with Gemini CLI command when isGeminiMode is true", async () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      await act(async () => {
        await result.current.connect();
      });

      expect(mockElectronAPI.pty!.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "npx @google/gemini-cli@latest",
        })
      );
    });

    it("should spawn without command when isGeminiMode is false", async () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      act(() => {
        result.current.setGeminiMode(false);
      });

      await act(async () => {
        await result.current.connect();
      });

      expect(mockElectronAPI.pty!.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          command: undefined,
        })
      );
    });

    it("should handle spawn failure", async () => {
      vi.mocked(mockElectronAPI.pty!.spawn).mockResolvedValueOnce({
        success: false,
        error: "Spawn failed: permission denied",
      });

      const { result } = renderHook(() => usePtyTerminalStore());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe("Spawn failed: permission denied");
      expect(result.current.sessionId).toBeNull();
    });

    it("should handle exception during spawn", async () => {
      vi.mocked(mockElectronAPI.pty!.spawn).mockRejectedValueOnce(
        new Error("Network error")
      );

      const { result } = renderHook(() => usePtyTerminalStore());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe("Network error");
    });

    it("should use custom command when provided", async () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      await act(async () => {
        await result.current.connect({ command: "python --version" });
      });

      expect(mockElectronAPI.pty!.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "python --version",
        })
      );
    });

    it("should use custom working directory when provided", async () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      await act(async () => {
        await result.current.connect({ cwd: "/home/user/projects" });
      });

      expect(mockElectronAPI.pty!.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/home/user/projects",
        })
      );
    });

    it("should show error when PTY API is not available", async () => {
      // Remove the PTY API temporarily
      cleanupElectron();
      window.electronAPI = undefined as any;

      const { result } = renderHook(() => usePtyTerminalStore());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe(
        "PTY is only available in the desktop app."
      );
    });
  });

  describe("disconnect", () => {
    it("should kill session and reset state", async () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      // Connect first
      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.sessionId).toBe("test-pty-session");

      // Disconnect
      await act(async () => {
        await result.current.disconnect();
      });

      expect(mockElectronAPI.pty!.kill).toHaveBeenCalledWith("test-pty-session");
      expect(result.current.sessionId).toBeNull();
      expect(result.current.status).toBe("disconnected");
    });

    it("should handle disconnect when no session exists", async () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      await act(async () => {
        await result.current.disconnect();
      });

      expect(mockElectronAPI.pty!.kill).not.toHaveBeenCalled();
      expect(result.current.status).toBe("disconnected");
    });
  });

  describe("setDimensions", () => {
    it("should update cols and rows", () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      act(() => {
        result.current.setDimensions(120, 40);
      });

      expect(result.current.cols).toBe(120);
      expect(result.current.rows).toBe(40);
    });
  });

  describe("resize", () => {
    it("should call resize API with current dimensions", async () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      // Connect first
      await act(async () => {
        await result.current.connect();
      });

      // Update dimensions
      act(() => {
        result.current.setDimensions(100, 30);
      });

      // Resize
      await act(async () => {
        await result.current.resize();
      });

      expect(mockElectronAPI.pty!.resize).toHaveBeenCalledWith(
        "test-pty-session",
        100,
        30
      );
    });

    it("should not call resize when no session exists", async () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      await act(async () => {
        await result.current.resize();
      });

      expect(mockElectronAPI.pty!.resize).not.toHaveBeenCalled();
    });
  });

  describe("mode management", () => {
    it("should toggle Gemini mode", () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      expect(result.current.isGeminiMode).toBe(true);

      act(() => {
        result.current.setGeminiMode(false);
      });

      expect(result.current.isGeminiMode).toBe(false);
    });

    it("should set working directory", () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      act(() => {
        result.current.setWorkingDirectory("/home/user/projects");
      });

      expect(result.current.workingDirectory).toBe("/home/user/projects");
    });
  });

  describe("internal state handlers", () => {
    it("should handle connected event", () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      act(() => {
        result.current.handleConnected("session-from-ipc");
      });

      expect(result.current.sessionId).toBe("session-from-ipc");
      expect(result.current.status).toBe("connected");
    });

    it("should handle disconnected event", () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      // Set up connected state first
      act(() => {
        result.current.handleConnected("test-session");
      });

      // Handle disconnection
      act(() => {
        result.current.handleDisconnected(0);
      });

      expect(result.current.sessionId).toBeNull();
      expect(result.current.status).toBe("disconnected");
      expect(result.current.exitCode).toBe(0);
    });

    it("should handle error event", () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      act(() => {
        result.current.handleError("Connection lost");
      });

      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe("Connection lost");
    });
  });

  describe("reset", () => {
    it("should reset all state to initial values", async () => {
      const { result } = renderHook(() => usePtyTerminalStore());

      // Modify state
      await act(async () => {
        await result.current.connect();
      });
      act(() => {
        result.current.setDimensions(100, 50);
        result.current.setGeminiMode(false);
        result.current.setWorkingDirectory("/test");
      });

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.sessionId).toBeNull();
      expect(result.current.status).toBe("disconnected");
      expect(result.current.cols).toBe(80);
      expect(result.current.rows).toBe(24);
      expect(result.current.isGeminiMode).toBe(true);
      expect(result.current.workingDirectory).toBe("");
    });
  });
});
