import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

interface DrawingScrollStore {
  // Scroll state
  scrollX: number;
  scrollY: number;
  canvasWidth: number;
  canvasHeight: number;
  viewportWidth: number;
  viewportHeight: number;

  // Actions
  setScrollPosition: (x: number, y: number) => void;
  setScrollX: (x: number) => void;
  setScrollY: (y: number) => void;
  setCanvasSize: (width: number, height: number) => void;
  setViewportSize: (width: number, height: number) => void;
  resetScroll: () => void;

  // Computed getters
  getMaxScrollX: () => number;
  getMaxScrollY: () => number;
  getScrollRatioX: () => number;
  getScrollRatioY: () => number;
}

export const useDrawingScrollStore = create<DrawingScrollStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    scrollX: 0,
    scrollY: 0,
    canvasWidth: 5000, // Large canvas for drawing
    canvasHeight: 5000,
    viewportWidth: 800,
    viewportHeight: 600,

    // Actions
    setScrollPosition: (x: number, y: number) =>
      set((state) => {
        const maxScrollX = Math.max(0, state.canvasWidth - state.viewportWidth);
        const maxScrollY = Math.max(0, state.canvasHeight - state.viewportHeight);

        return {
          scrollX: Math.max(0, Math.min(maxScrollX, x)),
          scrollY: Math.max(0, Math.min(maxScrollY, y)),
        };
      }),

    setScrollX: (x: number) =>
      set((state) => {
        const maxScrollX = Math.max(0, state.canvasWidth - state.viewportWidth);
        return { scrollX: Math.max(0, Math.min(maxScrollX, x)) };
      }),

    setScrollY: (y: number) =>
      set((state) => {
        const maxScrollY = Math.max(0, state.canvasHeight - state.viewportHeight);
        return { scrollY: Math.max(0, Math.min(maxScrollY, y)) };
      }),

    setCanvasSize: (width: number, height: number) =>
      set(() => ({ canvasWidth: width, canvasHeight: height })),

    setViewportSize: (width: number, height: number) =>
      set(() => ({ viewportWidth: width, viewportHeight: height })),

    resetScroll: () => set(() => ({ scrollX: 0, scrollY: 0 })),

    // Computed getters
    getMaxScrollX: () => {
      const state = get();
      return Math.max(0, state.canvasWidth - state.viewportWidth);
    },

    getMaxScrollY: () => {
      const state = get();
      return Math.max(0, state.canvasHeight - state.viewportHeight);
    },

    getScrollRatioX: () => {
      const state = get();
      const maxScroll = state.getMaxScrollX();
      return maxScroll > 0 ? state.scrollX / maxScroll : 0;
    },

    getScrollRatioY: () => {
      const state = get();
      const maxScroll = state.getMaxScrollY();
      return maxScroll > 0 ? state.scrollY / maxScroll : 0;
    },
  }))
);