import { create } from "zustand";
import { persist } from "zustand/middleware";
import { debugLog, debugError, isDebugEnabled } from "@/lib/debug-config";


// Circuit breaker for infinite loops
let emergencyStop = false;
// Use a high threshold so normal drags (typically 60fps) never trip.
const MAX_UPDATES_PER_SECOND = 120;
const SECOND_MS = 1000;
const CIRCUIT_BREAKER_RESET_MS = 2000;

// Size change tolerance for panel updates (in percent)
const SIZE_TOLERANCE = 0.1;

// Valid range for panel sizes (in percent)
const MIN_PANEL_SIZE = 5; // Minimum 5% to ensure panels remain usable
const MAX_PANEL_SIZE = 80; // Maximum 80% to prevent panels from taking over entire UI

// Valid range for vertical panels (mainContent/timeline split)
const MIN_VERTICAL_PANEL_SIZE = 10; // Minimum 10% for vertical panels
const MAX_VERTICAL_PANEL_SIZE = 90; // Maximum 90% for vertical panels

// Type guard for persisted panel state validation
type PersistedPanelState = Pick<
  PanelState,
  "toolsPanel" | "previewPanel" | "propertiesPanel"
>;

const isPercent = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;

function isPersistedPanelState(value: unknown): value is PersistedPanelState {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    isPercent(v.toolsPanel) &&
    isPercent(v.previewPanel) &&
    isPercent(v.propertiesPanel)
  );
}
const updateTimes: number[] = [];

/**
 * Sliding-window circuit breaker to prevent runaway update loops.
 * Returns true when updates should be blocked.
 * @param source Identifier for the source attempting the update.
 * @returns true if updates should be blocked, false otherwise.
 */
const checkCircuitBreaker = (source: string) => {
  // Never block UI updates unless debug mode is explicitly enabled.
  if (!isDebugEnabled()) return false;

  if (emergencyStop) {
    debugError(
      "🛑 [CIRCUIT-BREAKER] EMERGENCY STOP ACTIVE - Blocking update from",
      source
    );
    return true;
  }

  const now = Date.now();
  updateTimes.push(now);

  // Keep only updates from last second using sliding window
  const oneSecondAgo = now - SECOND_MS;
  // Drop timestamps older than 1 second
  while (updateTimes.length && updateTimes[0] <= oneSecondAgo) {
    updateTimes.shift();
  }

  if (updateTimes.length > MAX_UPDATES_PER_SECOND) {
    emergencyStop = true;
    debugError(
      "🛑 [CIRCUIT-BREAKER] TRIGGERED! Tolerance fix failed - emergency stop active",
      {
        source,
        updateCount: updateTimes.length,
        resetting: `in ${CIRCUIT_BREAKER_RESET_MS / SECOND_MS} seconds`,
      }
    );

    // Auto-reset after configured delay
    setTimeout(() => {
      emergencyStop = false;
      updateTimes.length = 0;
      debugLog(
        "⚡ [CIRCUIT-BREAKER] Reset - tolerance fix should prevent further issues"
      );
    }, CIRCUIT_BREAKER_RESET_MS);

    return true;
  }

  return false;
};

const DEFAULT_PANEL_SIZES = {
  toolsPanel: 20,
  previewPanel: 55,
  propertiesPanel: 25,
  mainContent: 70,
  timeline: 30,
  aiPanelWidth: 22,
  aiPanelMinWidth: 4,
} as const;

interface PanelState {
  // Panel sizes as percentages
  toolsPanel: number;
  previewPanel: number;
  propertiesPanel: number;
  mainContent: number;
  timeline: number;
  aiPanelWidth: number;
  aiPanelMinWidth: number;

  // Actions
  setToolsPanel: (size: number) => void;
  setPreviewPanel: (size: number) => void;
  setPropertiesPanel: (size: number) => void;
  setMainContent: (size: number) => void;
  setTimeline: (size: number) => void;
  setAiPanelWidth: (size: number) => void;
  normalizeHorizontalPanels: () => void;
}

// Debounce normalization to avoid excessive calls during resize
let normalizationTimeout: ReturnType<typeof setTimeout> | null = null;
let isNormalizing = false;
/**
 * Debounces panel normalization and guards against re-entrancy.
 * Schedules normalizeFunc after a short delay and blocks nested calls while running.
 * @param normalizeFunc Callback that performs normalization.
 */
const debouncedNormalize = (normalizeFunc: () => void) => {
  if (isNormalizing) return; // Prevent recursive calls

  if (normalizationTimeout) {
    clearTimeout(normalizationTimeout);
  }
  normalizationTimeout = setTimeout(() => {
    isNormalizing = true;
    try {
      normalizeFunc();
    } finally {
      isNormalizing = false;
      normalizationTimeout = null;
    }
  }, 50); // 50ms debounce
};

// Consolidated panel size setter to reduce duplication
/**
 * Shared setter for horizontal panel sizes with circuit-breaker and tolerance gating.
 * Validates input, rounds to two decimals, and schedules normalization when an update is applied.
 * @param key One of "toolsPanel" | "previewPanel" | "propertiesPanel".
 * @param size Target size percentage (0–100); must be finite.
 * @param source Identifier for debugging and circuit-breaker tracking.
 */
function setPanelSize<
  K extends "toolsPanel" | "previewPanel" | "propertiesPanel",
>(key: K, size: number, source: string) {
  if (checkCircuitBreaker(source)) return;
  if (!Number.isFinite(size)) return;

  const state = usePanelStore.getState();
  const rounded = Math.round(size * 100) / 100;
  const clamped = Math.max(MIN_PANEL_SIZE, Math.min(MAX_PANEL_SIZE, rounded));
  const current = state[key];

  if (Math.abs(current - clamped) > SIZE_TOLERANCE) {
    usePanelStore.setState({ [key]: clamped } as Pick<PanelState, K>);
    // TEMP FIX: Disable automatic normalization to prevent infinite loops
    // debouncedNormalize(() =>
    //   usePanelStore.getState().normalizeHorizontalPanels()
    // );
  }
}

export const usePanelStore = create<PanelState>()(
  persist(
    (set, get) => ({
      // Default sizes - optimized for responsiveness
      ...DEFAULT_PANEL_SIZES,

      // Actions
      setToolsPanel: (size) =>
        setPanelSize("toolsPanel", size, "setToolsPanel"),
      setPreviewPanel: (size) =>
        setPanelSize("previewPanel", size, "setPreviewPanel"),
      setPropertiesPanel: (size) =>
        setPanelSize("propertiesPanel", size, "setPropertiesPanel"),
      setMainContent: (size) => {
        const clamped = Math.max(
          MIN_VERTICAL_PANEL_SIZE,
          Math.min(MAX_VERTICAL_PANEL_SIZE, size)
        );
        set({ mainContent: clamped });
      },
      setTimeline: (size) => {
        const clamped = Math.max(
          MIN_VERTICAL_PANEL_SIZE,
          Math.min(MAX_VERTICAL_PANEL_SIZE, size)
        );
        set({ timeline: clamped });
      },
      setAiPanelWidth: (size) => set({ aiPanelWidth: size }),

      // Normalize horizontal panels to ensure they add up to 100%
      /**
       * Normalizes tools/preview/properties so their total equals 100%.
       * Uses SIZE_TOLERANCE to avoid churn; applies severe reset when totals are way off.
       */
      normalizeHorizontalPanels: () => {
        const state = get();
        const totalRaw =
          state.toolsPanel + state.previewPanel + state.propertiesPanel;

        // Round the total to 2 decimals to avoid floating point drift like 99.9899999999
        const total = Math.round(totalRaw * 100) / 100;

        // Use a larger tolerance to avoid constant corrections from floating-point precision issues
        if (Math.abs(total - 100) > SIZE_TOLERANCE) {
          // If the values are way off, reset to defaults
          if (total < 50 || total > 150) {
            debugError(
              "[PanelStore] Panel sizes severely corrupted, resetting to defaults"
            );
            set({
              toolsPanel: DEFAULT_PANEL_SIZES.toolsPanel,
              previewPanel: DEFAULT_PANEL_SIZES.previewPanel,
              propertiesPanel: DEFAULT_PANEL_SIZES.propertiesPanel,
            });
          } else {
            // Calculate normalized values with rounding to avoid precision issues
            const factor = 100 / total;
            const normalizedTools =
              Math.round(state.toolsPanel * factor * 100) / 100;
            const normalizedPreview =
              Math.round(state.previewPanel * factor * 100) / 100;
            // Properties panel gets the remainder to ensure exact 100%
            const normalizedProperties =
              Math.round((100 - normalizedTools - normalizedPreview) * 100) /
              100;

            set({
              toolsPanel: normalizedTools,
              previewPanel: normalizedPreview,
              propertiesPanel: normalizedProperties,
            });
          }
        }
      },
    }),
    {
      name: "panel-sizes",
      version: 7, // Increment this to force migration and reset
      onRehydrateStorage: () => (state) => {
        // Normalize panels after rehydration
        if (state) {
          const total =
            state.toolsPanel + state.previewPanel + state.propertiesPanel;
          if (Math.abs(total - 100) > SIZE_TOLERANCE) {
            // Use setTimeout to defer normalization and avoid sync state updates during hydration
            setTimeout(() => {
              state.normalizeHorizontalPanels();
            }, 0);
          }
        }
      },
      migrate: (persistedState: unknown, version: number) => {
        // Reset to defaults if coming from old version or if data is corrupted
        if (version < 7) {
          debugLog(
            `[PanelStore] Migrating from version ${version} to version 7`
          );
          return DEFAULT_PANEL_SIZES;
        }

        // Validate persisted state
        if (!isPersistedPanelState(persistedState)) {
          debugError(
            "[PanelStore] Invalid persisted state, resetting to defaults"
          );
          return DEFAULT_PANEL_SIZES;
        }

        // Normalize horizontal panels on load
        const total =
          persistedState.toolsPanel +
          persistedState.previewPanel +
          persistedState.propertiesPanel;

        // If severely corrupted, reset to defaults
        if (total < 50 || total > 150 || Number.isNaN(total)) {
          debugError(
            "[PanelStore] Corrupted panel sizes detected, resetting to defaults"
          );
          return DEFAULT_PANEL_SIZES;
        }

        if (Math.abs(total - 100) > SIZE_TOLERANCE) {
          const factor = 100 / total;
          const normalizedTools =
            Math.round(persistedState.toolsPanel * factor * 100) / 100;
          const normalizedPreview =
            Math.round(persistedState.previewPanel * factor * 100) / 100;
          // Properties panel gets the remainder to ensure exact 100%
          const normalizedProperties =
            Math.round((100 - normalizedTools - normalizedPreview) * 100) / 100;

          return {
            ...persistedState,
            toolsPanel: normalizedTools,
            previewPanel: normalizedPreview,
            propertiesPanel: normalizedProperties,
          };
        }

        return persistedState;
      },
    }
  )
);
