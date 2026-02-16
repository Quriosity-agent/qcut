import { create } from "zustand";

interface McpAppState {
  activeHtml: string | null;
  toolName: string | null;
}

interface McpAppActions {
  setMcpApp: (options: { html: string; toolName: string | null }) => void;
  clearMcpApp: () => void;
}

type McpAppStore = McpAppState & McpAppActions;

export const useMcpAppStore = create<McpAppStore>((set) => ({
  activeHtml: null,
  toolName: null,
  setMcpApp: ({ html, toolName }) => {
    set({ activeHtml: html, toolName });
  },
  clearMcpApp: () => {
    set({ activeHtml: null, toolName: null });
  },
}));
