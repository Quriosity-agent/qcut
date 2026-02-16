import { create } from "zustand";

interface McpAppState {
  /** HTML from external MCP apps (IPC / HTTP) */
  activeHtml: string | null;
  /** Tool name from external MCP apps */
  toolName: string | null;
  /** Whether the built-in local MCP app is active */
  localMcpActive: boolean;
}

interface McpAppActions {
  setMcpApp: (options: { html: string; toolName: string | null }) => void;
  clearMcpApp: () => void;
  setLocalMcpActive: (active: boolean) => void;
}

type McpAppStore = McpAppState & McpAppActions;

export const useMcpAppStore = create<McpAppStore>((set) => ({
  activeHtml: null,
  toolName: null,
  localMcpActive: false,
  setMcpApp: ({ html, toolName }) => {
    set({ activeHtml: html, toolName, localMcpActive: false });
  },
  clearMcpApp: () => {
    set({ activeHtml: null, toolName: null, localMcpActive: false });
  },
  setLocalMcpActive: (active) => {
    set({
      localMcpActive: active,
      activeHtml: active ? null : null,
      toolName: active ? null : null,
    });
  },
}));
