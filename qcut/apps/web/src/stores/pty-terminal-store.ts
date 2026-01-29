import { create } from "zustand";
import type { CliProvider } from "@/types/cli-provider";
import { CLI_PROVIDERS, getDefaultCodexModel, getDefaultClaudeModel } from "@/types/cli-provider";

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
  folderName?: string; // Skill folder name for --project-doc flag
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
  selectedClaudeModel: string | null; // For Claude Code model selection

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
  setSelectedClaudeModel: (modelId: string | null) => void;

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
  selectedClaudeModel: getDefaultClaudeModel(), // Default Claude model
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
 * Build skill file path for --project-doc flag
 * open-codex supports passing a markdown file as context via --project-doc
 */
function buildSkillFilePath(workingDirectory: string, skillFolderName: string): string {
  // Handle both Windows and Unix paths
  const separator = workingDirectory.includes("\\") ? "\\" : "/";
  // Get the parent directory (skills folder) and then the skill folder
  const skillPath = `${workingDirectory}${separator}${skillFolderName}${separator}Skill.md`;
  return skillPath;
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
    console.log("[PTY Store] Status set to connecting");

    try {
      // Check for API availability (PTY is only available in desktop app)
      console.log("[PTY Store] Checking PTY API availability...");
      if (!window.electronAPI?.pty) {
        console.error("[PTY Store] PTY API not available");
        set({
          status: "error",
          error: "PTY is only available in the desktop app.",
        });
        return;
      }
      console.log("[PTY Store] PTY API is available");

      const providerConfig = CLI_PROVIDERS[cliProvider];
      let command: string | undefined;
      let env: Record<string, string> = {};

      // Build command based on provider
      if (cliProvider === "codex") {
        console.log("[PTY Store] Building Codex command...");
        // Get OpenRouter API key for Codex
        console.log("[PTY Store] Getting API keys...");
        let apiKeys;
        try {
          apiKeys = await window.electronAPI?.apiKeys?.get();
          console.log("[PTY Store] API keys retrieved, openRouterApiKey length:", apiKeys?.openRouterApiKey?.length || 0);
        } catch (apiKeyError) {
          console.error("[PTY Store] Error getting API keys:", apiKeyError);
          set({
            status: "error",
            error: "Failed to retrieve API keys. Please try again.",
          });
          return;
        }

        if (!apiKeys?.openRouterApiKey) {
          console.error("[PTY Store] OpenRouter API key not configured");
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

        // Inject skill via --project-doc flag if active and folder name is known
        // open-codex supports passing a markdown file as context
        console.log("[PTY Store] activeSkill?.folderName:", activeSkill?.folderName);
        console.log("[PTY Store] workingDirectory:", workingDirectory);
        if (activeSkill?.folderName && workingDirectory) {
          const skillFilePath = buildSkillFilePath(workingDirectory, activeSkill.folderName);
          command += ` --project-doc "${skillFilePath}"`;
          console.log("[PTY Store] Skill file path:", skillFilePath);
        }

        console.log("[PTY Store] Codex command:", command);
      } else if (cliProvider === "claude") {
        console.log("[PTY Store] Building Claude command...");
        // Get Anthropic API key for Claude
        console.log("[PTY Store] Getting API keys for Claude...");
        let apiKeys;
        try {
          apiKeys = await window.electronAPI?.apiKeys?.get();
          console.log("[PTY Store] API keys retrieved, anthropicApiKey length:", apiKeys?.anthropicApiKey?.length || 0);
        } catch (apiKeyError) {
          console.error("[PTY Store] Error getting API keys:", apiKeyError);
          set({
            status: "error",
            error: "Failed to retrieve API keys. Please try again.",
          });
          return;
        }

        if (!apiKeys?.anthropicApiKey) {
          console.error("[PTY Store] Anthropic API key not configured");
          set({
            status: "error",
            error: "Anthropic API key not configured. Go to Settings > API Keys.",
          });
          return;
        }

        env.ANTHROPIC_API_KEY = apiKeys.anthropicApiKey;

        // Get Claude model from state
        const { selectedClaudeModel } = get();

        // Build Claude command
        command = `claude`;
        if (selectedClaudeModel) {
          command += ` --model ${selectedClaudeModel}`;
        }

        // Inject skill via --append-system-prompt if active
        if (activeSkill?.content) {
          // Escape the content for shell
          const escapedContent = activeSkill.content
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\$/g, '\\$')
            .replace(/`/g, '\\`');
          command += ` --append-system-prompt "${escapedContent}"`;
          console.log("[PTY Store] Claude skill injected via --append-system-prompt");
        }

        console.log("[PTY Store] Claude command:", command);
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

  setSelectedClaudeModel: (modelId) => {
    set({ selectedClaudeModel: modelId });
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
