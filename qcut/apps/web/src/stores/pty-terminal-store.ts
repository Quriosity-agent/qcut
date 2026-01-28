import { create } from "zustand";

// ============================================================================
// Types
// ============================================================================

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface PtyTerminalState {
  // Session state
  sessionId: string | null;
  status: ConnectionStatus;
  exitCode: number | null;
  error: string | null;

  // Terminal dimensions
  cols: number;
  rows: number;

  // UI state
  isGeminiMode: boolean; // true = launch Gemini CLI, false = launch shell
  workingDirectory: string;
}

interface PtyTerminalActions {
  // Session management
  connect: (options?: { command?: string; cwd?: string }) => Promise<void>;
  disconnect: () => Promise<void>;

  // Dimension management
  setDimensions: (cols: number, rows: number) => void;
  resize: () => Promise<void>;

  // Mode management
  setGeminiMode: (enabled: boolean) => void;
  setWorkingDirectory: (dir: string) => void;

  // Internal state updates (called by IPC listeners)
  handleConnected: (sessionId: string) => void;
  handleDisconnected: (exitCode: number) => void;
  handleError: (error: string) => void;

  // Reset
  reset: () => void;
}

type PtyTerminalStore = PtyTerminalState & PtyTerminalActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: PtyTerminalState = {
  sessionId: null,
  status: "disconnected",
  exitCode: null,
  error: null,
  cols: 80,
  rows: 24,
  isGeminiMode: true,
  workingDirectory: "",
};

// ============================================================================
// Store
// ============================================================================

export const usePtyTerminalStore = create<PtyTerminalStore>((set, get) => ({
  ...initialState,

  connect: async (options = {}) => {
    const { isGeminiMode, workingDirectory, cols, rows } = get();

    console.log("[PTY Store] ===== CONNECT =====");
    console.log("[PTY Store] isGeminiMode:", isGeminiMode);
    console.log("[PTY Store] workingDirectory:", workingDirectory);
    console.log("[PTY Store] cols:", cols, "rows:", rows);

    set({ status: "connecting", error: null, exitCode: null });

    try {
      // Determine command based on mode
      const command = isGeminiMode ? "npx @google/gemini-cli@latest" : undefined;
      console.log("[PTY Store] Command to spawn:", command || "(default shell)");

      const spawnOptions = {
        cols,
        rows,
        cwd: options.cwd || workingDirectory || undefined,
        command: options.command || command,
      };
      console.log("[PTY Store] Spawn options:", JSON.stringify(spawnOptions, null, 2));

      const result = await window.electronAPI?.pty?.spawn(spawnOptions);
      console.log("[PTY Store] Spawn result:", JSON.stringify(result, null, 2));

      if (result?.success && result.sessionId) {
        console.log("[PTY Store] Connected with sessionId:", result.sessionId);
        set({ sessionId: result.sessionId, status: "connected" });
      } else {
        console.error("[PTY Store] Spawn failed:", result?.error);
        set({
          status: "error",
          error: result?.error || "Failed to spawn PTY session",
        });
      }
    } catch (error: any) {
      console.error("[PTY Store] Exception:", error.message);
      set({ status: "error", error: error.message });
    }
  },

  disconnect: async () => {
    const { sessionId } = get();
    if (sessionId) {
      await window.electronAPI?.pty?.kill(sessionId);
    }
    set({ sessionId: null, status: "disconnected" });
  },

  setDimensions: (cols, rows) => {
    set({ cols, rows });
  },

  resize: async () => {
    const { sessionId, cols, rows } = get();
    if (sessionId) {
      await window.electronAPI?.pty?.resize(sessionId, cols, rows);
    }
  },

  setGeminiMode: (enabled) => {
    set({ isGeminiMode: enabled });
  },

  setWorkingDirectory: (dir) => {
    set({ workingDirectory: dir });
  },

  handleConnected: (sessionId) => {
    set({ sessionId, status: "connected" });
  },

  handleDisconnected: (exitCode) => {
    set({ sessionId: null, status: "disconnected", exitCode });
  },

  handleError: (error) => {
    set({ status: "error", error });
  },

  reset: () => {
    set(initialState);
  },
}));
