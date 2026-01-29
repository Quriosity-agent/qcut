import { create } from "zustand";

// ============================================================================
// Types
// ============================================================================

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

/**
 * Active skill context for Gemini CLI
 */
export interface ActiveSkillContext {
  id: string;
  name: string;
  content: string;
}

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

  // Skill context (for running skills with Gemini CLI)
  activeSkill: ActiveSkillContext | null;
  skillPromptSent: boolean; // Track if initial skill prompt was sent
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

  // Skill context management
  setActiveSkill: (skill: ActiveSkillContext | null) => void;
  clearSkillContext: () => void;
  sendSkillPrompt: () => void;

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
  activeSkill: null,
  skillPromptSent: false,
};

/**
 * Build the skill prompt to send to Gemini CLI
 */
function buildSkillPrompt(skill: ActiveSkillContext): string {
  return `I'm using the "${skill.name}" skill. Here are the instructions I need you to follow:

${skill.content}

Please acknowledge that you understand these instructions and are ready to help me with tasks using this skill.`;
}

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
      // Check for API availability (PTY is only available in desktop app)
      if (!window.electronAPI?.pty) {
        set({
          status: "error",
          error: "PTY is only available in the desktop app.",
        });
        return;
      }

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

      const result = await window.electronAPI.pty.spawn(spawnOptions);
      console.log("[PTY Store] Spawn result:", JSON.stringify(result, null, 2));

      if (result?.success && result.sessionId) {
        console.log("[PTY Store] Connected with sessionId:", result.sessionId);
        set({ sessionId: result.sessionId, status: "connected" });
      } else {
        console.error("[PTY Store] Spawn failed:", result?.error);
        set({
          status: "error",
          error: result?.error ?? "Failed to spawn PTY session",
        });
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to spawn PTY session";
      console.error("[PTY Store] Exception:", message);
      set({ status: "error", error: message });
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

  // Skill context management
  setActiveSkill: (skill) => {
    set({ activeSkill: skill, skillPromptSent: false });
  },

  clearSkillContext: () => {
    set({ activeSkill: null, skillPromptSent: false });
  },

  sendSkillPrompt: () => {
    const { sessionId, activeSkill, skillPromptSent, isGeminiMode } = get();

    // Only send if we have a skill, haven't sent yet, and are in Gemini mode
    if (!activeSkill || skillPromptSent || !isGeminiMode || !sessionId) {
      return;
    }

    const prompt = buildSkillPrompt(activeSkill);
    console.log("[PTY Store] Sending skill prompt for:", activeSkill.name);

    // Send the prompt to the terminal
    window.electronAPI?.pty?.write(sessionId, prompt + "\n");
    set({ skillPromptSent: true });
  },

  handleConnected: (sessionId) => {
    const { activeSkill, skillPromptSent, isGeminiMode } = get();
    set({ sessionId, status: "connected" });

    // If skill is active and prompt not sent, send it after a delay
    // (allow Gemini CLI to initialize)
    if (activeSkill && !skillPromptSent && isGeminiMode) {
      console.log("[PTY Store] Will send skill prompt after Gemini CLI initializes");
      setTimeout(() => {
        get().sendSkillPrompt();
      }, 2000); // 2 second delay for Gemini CLI to be ready
    }
  },

  handleDisconnected: (exitCode) => {
    set({
      sessionId: null,
      status: "disconnected",
      exitCode,
      skillPromptSent: false, // Reset so prompt can be sent again on reconnect
    });
  },

  handleError: (error) => {
    set({ status: "error", error });
  },

  reset: () => {
    set(initialState);
  },
}));
