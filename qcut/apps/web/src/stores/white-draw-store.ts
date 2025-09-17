import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { WhiteDrawStore, DrawingToolConfig } from "@/types/white-draw";
import { DEFAULT_TOOL } from "@/components/editor/draw/constants/drawing-tools";

export const useWhiteDrawStore = create<WhiteDrawStore>()(
  devtools(
    (set, get) => ({
      // State - matches nano-edit store structure
      activeTab: "canvas",
      isDrawing: false,
      currentTool: DEFAULT_TOOL,
      brushSize: 10,
      color: "#000000",
      opacity: 1,
      layers: [],
      history: [],
      historyIndex: -1,
      drawings: [], // Saved drawings
      isProcessing: false,

      // Actions - follows nano-edit naming conventions
      setActiveTab: (tab) =>
        set({ activeTab: tab }, false, "white-draw/setActiveTab"),

      setDrawing: (drawing) =>
        set({ isDrawing: drawing }, false, "white-draw/setDrawing"),

      setTool: (tool) =>
        set({ currentTool: tool }, false, "white-draw/setTool"),

      setBrushSize: (size) =>
        set({ brushSize: size }, false, "white-draw/setBrushSize"),

      setColor: (color) =>
        set({ color }, false, "white-draw/setColor"),

      setOpacity: (opacity) =>
        set({ opacity }, false, "white-draw/setOpacity"),

      addLayer: () =>
        set((state) => ({
          layers: [...state.layers, { id: Date.now().toString(), data: "", visible: true, opacity: 1 }]
        }), false, "white-draw/addLayer"),

      saveToHistory: (state) =>
        set((current) => {
          const newHistory = current.history.slice(0, current.historyIndex + 1);
          newHistory.push(state);
          return {
            history: newHistory.slice(-50), // Limit to 50 states
            historyIndex: newHistory.length - 1
          };
        }, false, "white-draw/saveToHistory"),

      undo: () =>
        set((state) => {
          const newIndex = Math.max(-1, state.historyIndex - 1);
          return { historyIndex: newIndex };
        }, false, "white-draw/undo"),

      redo: () =>
        set((state) => {
          const newIndex = Math.min(state.history.length - 1, state.historyIndex + 1);
          return { historyIndex: newIndex };
        }, false, "white-draw/redo"),

      getCurrentHistoryState: () => {
        const state = get();
        return state.history[state.historyIndex];
      },

      clear: () =>
        set({
          layers: [],
          history: [],
          historyIndex: -1,
          isDrawing: false
        }, false, "white-draw/clear"),

      setProcessing: (processing) =>
        set({ isProcessing: processing }, false, "white-draw/setProcessing")
    }),
    {
      name: "white-draw-store",
    }
  )
);

// Selectors for common use cases - matches nano-edit pattern
export const selectCurrentTool = (state: WhiteDrawStore) => state.currentTool;
export const selectIsDrawing = (state: WhiteDrawStore) => state.isDrawing;
export const selectActiveTab = (state: WhiteDrawStore) => state.activeTab;