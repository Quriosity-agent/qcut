import { create } from "zustand";
import type { CliProvider } from "@/types/cli-provider";
import { CLI_PROVIDERS, getDefaultCodexModel } from "@/types/cli-provider";

// ============================================================================
// Types
// ============================================================================

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

/**
 * Active skill context for CLI agents
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

  // CLI provider state
  cliProvider: CliProvider;
  selectedModel: string | null; // For Codex/OpenRouter model selection

  // Legacy compatibility
  isGeminiMode: boolean; // Derived from cliProvider for backward compatibility

  workingDirectory: string;

  // Skill context (for running skills with CLI agents)
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

  // CLI provider management
  setCliProvider: (provider: CliProvider) => void;
  setSelectedModel: (modelId: string | null) => void;

  // Legacy mode management (backward compatibility)
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
  cliProvider: "gemini", // Default to Gemini for backward compatibility
  selectedModel: getDefaultCodexModel(), // Default Codex model
  isGeminiMode: true, // Derived from cliProvider
  workingDirectory: "",
  activeSkill: null,
  skillPromptSent: false,
};

/**
 * Build the skill prompt to send to Gemini CLI
 * Note: Codex uses --full-context flag instead of prompt injection
 */
function buildSkillPrompt(skill: ActiveSkillContext): string {
  return `I'm using the "${skill.name}" skill. Here are the instructions I need you to follow:

${skill.content}

Please acknowledge that you understand these instructions and are ready to help me with tasks using this skill.`;
}

/**
 * Escape content for use in shell command (--full-context flag)
 * Handles special characters that would break shell parsing
 */
function escapeForShellArg(content: string): string {
  // For Windows cmd.exe, we need different escaping
  // Using double quotes and escaping internal quotes
  return content
    .replace(/\\/g, "\\\\") // Escape backslashes first
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/\$/g, "\\$") // Escape dollar signs
    .replace(/`/g, "\\`"); // Escape backticks
}

// ============================================================================
// Store
// ============================================================================

export const usePtyTerminalStore = create<PtyTerminalStore>((set, get) => ({
  ...initialState,

  connect: async (options = {}) => {
    const { cliProvider, selectedModel, workingDirectory, cols, rows, activeSkill } = get();

    console.log("[PTY Store] ===== CONNECT =====");
    console.log("[PTY Store] cliProvider:", cliProvider);
    console.log("[PTY Store] selectedModel:", selectedModel);
    console.log("[PTY Store] workingDirectory:", workingDirectory);
    console.log("[PTY Store] cols:", cols, "rows:", rows);
    console.log("[PTY Store] activeSkill:", activeSkill?.name || "none");

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

      const providerConfig = CLI_PROVIDERS[cliProvider];
      let command: string | undefined;
      let env: Record<string, string> = {};

      // Build command based on provider
      if (cliProvider === "codex") {
        // Get OpenRouter API key for Codex
        const apiKeys = await window.electronAPI?.apiKeys?.get();
        if (!apiKeys?.openRouterApiKey) {
          set({
            status: "error",
            error: "OpenRouter API key not configured. Go to Settings > API Keys.",
          });
          return;
        }

        env.OPENROUTER_API_KEY = apiKeys.openRouterApiKey;

        // Build Codex command with provider and model
        command = `npx open-codex --provider openrouter`;
        if (selectedModel) {
          command += ` --model ${selectedModel}`;
        }

        // Inject skill via --full-context flag if active
        // Codex supports passing context via command flag (no delay needed)
        if (activeSkill && providerConfig.supportsSkillFlag && providerConfig.skillFlagFormat) {
          const escapedContent = escapeForShellArg(activeSkill.content);
          command += ` ${providerConfig.skillFlagFormat} "${escapedContent}"`;
        }

        console.log("[PTY Store] Codex command:", command);
      } else if (cliProvider === "gemini") {
        command = providerConfig.command;
        console.log("[PTY Store] Gemini command:", command);
      }
      // shell provider uses undefined command (default shell)

      const spawnOptions = {
        cols,
        rows,
        cwd: options.cwd || workingDirectory || undefined,
        command: options.command || command,
        env: Object.keys(env).length > 0 ? env : undefined,
      };
      console.log("[PTY Store] Spawn options:", JSON.stringify({ ...spawnOptions, env: env.OPENROUTER_API_KEY ? "[REDACTED]" : undefined }, null, 2));

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

  // CLI provider management
  setCliProvider: (provider) => {
    set({
      cliProvider: provider,
      isGeminiMode: provider === "gemini",
    });
  },

  setSelectedModel: (modelId) => {
    set({ selectedModel: modelId });
  },

  // Legacy compatibility - maps to setCliProvider
  setGeminiMode: (enabled) => {
    set({
      cliProvider: enabled ? "gemini" : "shell",
      isGeminiMode: enabled,
    });
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
    const { sessionId, activeSkill, skillPromptSent, cliProvider } = get();

    // Only send prompt injection for Gemini (Codex uses --full-context flag at spawn time)
    if (!activeSkill || skillPromptSent || cliProvider !== "gemini" || !sessionId) {
      return;
    }

    const prompt = buildSkillPrompt(activeSkill);
    console.log("[PTY Store] Sending skill prompt for:", activeSkill.name);

    // Send the prompt to the terminal
    window.electronAPI?.pty?.write(sessionId, prompt + "\n");
    set({ skillPromptSent: true });
  },

  handleConnected: (sessionId) => {
    const { activeSkill, skillPromptSent, cliProvider } = get();
    set({ sessionId, status: "connected" });

    // If skill is active and prompt not sent, send it after a delay
    // (only for Gemini CLI - Codex uses flag injection at spawn time)
    if (activeSkill && !skillPromptSent && cliProvider === "gemini") {
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
