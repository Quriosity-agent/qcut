/**
 * Remotion Integration Store
 *
 * Zustand store for managing Remotion component state in QCut.
 * Handles component registration, instance lifecycle, playback sync,
 * render queue management, and error tracking.
 *
 * @module stores/remotion-store
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { PlayerRef } from "@remotion/player";
import type {
  RemotionStore,
  RemotionStoreState,
  RemotionComponentDefinition,
  RemotionComponentCategory,
  RemotionInstance,
  RenderJob,
  RenderJobStatus,
  RemotionError,
  SyncState,
} from "@/lib/remotion/types";
import { generateUUID } from "@/lib/utils";
import { builtInComponentDefinitions } from "@/lib/remotion/built-in";

// ============================================================================
// Initial State
// ============================================================================

const initialSyncState: SyncState = {
  globalFrame: 0,
  isPlaying: false,
  playbackRate: 1,
  activeElementIds: [],
  lastSyncTime: Date.now(),
};

const initialState: RemotionStoreState = {
  registeredComponents: new Map(),
  instances: new Map(),
  renderQueue: [],
  syncState: initialSyncState,
  isInitialized: false,
  isLoading: false,
  recentErrors: [],
};

// ============================================================================
// Store Implementation
// ============================================================================

export const useRemotionStore = create<RemotionStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    ...initialState,

    // ========================================================================
    // Initialization
    // ========================================================================

    initialize: async () => {
      const { isInitialized } = get();
      if (isInitialized) return;

      set({ isLoading: true });

      try {
        // Load built-in components
        const newComponents = new Map(get().registeredComponents);
        for (const definition of builtInComponentDefinitions) {
          newComponents.set(definition.id, definition);
        }

        set({
          registeredComponents: newComponents,
          isInitialized: true,
          isLoading: false,
        });
      } catch (error) {
        const remotionError: RemotionError = {
          type: "load",
          message:
            error instanceof Error
              ? error.message
              : "Failed to initialize Remotion store",
          recoverable: true,
          recoveryAction: "retry",
          timestamp: Date.now(),
        };

        set((state) => ({
          isLoading: false,
          recentErrors: [...state.recentErrors.slice(-9), remotionError],
        }));
      }
    },

    // ========================================================================
    // Component Registry
    // ========================================================================

    registerComponent: (definition: RemotionComponentDefinition) => {
      set((state) => {
        const newComponents = new Map(state.registeredComponents);
        newComponents.set(definition.id, definition);
        return { registeredComponents: newComponents };
      });
    },

    unregisterComponent: (id: string) => {
      set((state) => {
        const newComponents = new Map(state.registeredComponents);
        newComponents.delete(id);
        return { registeredComponents: newComponents };
      });
    },

    getComponent: (id: string) => {
      return get().registeredComponents.get(id);
    },

    getComponentsByCategory: (category: RemotionComponentCategory) => {
      const components = Array.from(get().registeredComponents.values());
      return components.filter((c) => c.category === category);
    },

    // ========================================================================
    // Instance Management
    // ========================================================================

    createInstance: (
      elementId: string,
      componentId: string,
      props?: Record<string, unknown>
    ) => {
      const component = get().registeredComponents.get(componentId);
      if (!component) {
        const error: RemotionError = {
          type: "load",
          elementId,
          componentId,
          message: `Component "${componentId}" not found in registry`,
          recoverable: false,
          timestamp: Date.now(),
        };
        get().addError(error);
        return null;
      }

      const instance: RemotionInstance = {
        elementId,
        componentId,
        playerRef: null,
        localFrame: 0,
        props: props ?? component.defaultProps,
        cacheStatus: "none",
        isPlaying: false,
        playbackRate: 1,
      };

      set((state) => {
        const newInstances = new Map(state.instances);
        newInstances.set(elementId, instance);
        return { instances: newInstances };
      });

      return instance;
    },

    destroyInstance: (elementId: string) => {
      set((state) => {
        const newInstances = new Map(state.instances);
        newInstances.delete(elementId);

        // Also remove from active elements
        const newActiveIds = state.syncState.activeElementIds.filter(
          (id) => id !== elementId
        );

        return {
          instances: newInstances,
          syncState: {
            ...state.syncState,
            activeElementIds: newActiveIds,
          },
        };
      });
    },

    updateInstanceProps: (
      elementId: string,
      props: Record<string, unknown>
    ) => {
      set((state) => {
        const instance = state.instances.get(elementId);
        if (!instance) return state;

        const newInstances = new Map(state.instances);
        newInstances.set(elementId, {
          ...instance,
          props: { ...instance.props, ...props },
          // Invalidate cache when props change
          cacheStatus: "none",
        });

        return { instances: newInstances };
      });
    },

    setInstancePlayerRef: (elementId: string, ref: PlayerRef | null) => {
      set((state) => {
        const instance = state.instances.get(elementId);
        if (!instance) return state;

        const newInstances = new Map(state.instances);
        newInstances.set(elementId, {
          ...instance,
          playerRef: ref,
        });

        return { instances: newInstances };
      });
    },

    getInstance: (elementId: string) => {
      return get().instances.get(elementId);
    },

    // ========================================================================
    // Playback Control
    // ========================================================================

    seekInstance: (elementId: string, frame: number) => {
      const instance = get().instances.get(elementId);
      if (!instance) return;

      // Update local frame in state
      set((state) => {
        const newInstances = new Map(state.instances);
        const inst = newInstances.get(elementId);
        if (inst) {
          newInstances.set(elementId, {
            ...inst,
            localFrame: frame,
          });
        }
        return { instances: newInstances };
      });

      // Seek the player if ref is available
      if (instance.playerRef) {
        instance.playerRef.seekTo(frame);
      }
    },

    playInstance: (elementId: string) => {
      set((state) => {
        const instance = state.instances.get(elementId);
        if (!instance) return state;

        const newInstances = new Map(state.instances);
        newInstances.set(elementId, {
          ...instance,
          isPlaying: true,
        });

        // Also trigger play on player ref
        if (instance.playerRef) {
          instance.playerRef.play();
        }

        return { instances: newInstances };
      });
    },

    pauseInstance: (elementId: string) => {
      set((state) => {
        const instance = state.instances.get(elementId);
        if (!instance) return state;

        const newInstances = new Map(state.instances);
        newInstances.set(elementId, {
          ...instance,
          isPlaying: false,
        });

        // Also trigger pause on player ref
        if (instance.playerRef) {
          instance.playerRef.pause();
        }

        return { instances: newInstances };
      });
    },

    setInstancePlaybackRate: (elementId: string, rate: number) => {
      set((state) => {
        const instance = state.instances.get(elementId);
        if (!instance) return state;

        const newInstances = new Map(state.instances);
        newInstances.set(elementId, {
          ...instance,
          playbackRate: rate,
        });

        return { instances: newInstances };
      });
    },

    // ========================================================================
    // Sync
    // ========================================================================

    syncToGlobalFrame: (frame: number) => {
      const state = get();

      // Update sync state
      set({
        syncState: {
          ...state.syncState,
          globalFrame: frame,
          lastSyncTime: Date.now(),
        },
      });

      // Seek all active instances to their local frame
      // Note: The actual frame calculation (global to local) should be done
      // by the sync manager which knows element start times
      for (const elementId of state.syncState.activeElementIds) {
        const instance = state.instances.get(elementId);
        if (instance?.playerRef) {
          // This is a placeholder - actual implementation needs element start time
          // The sync manager will handle the proper conversion
          instance.playerRef.seekTo(instance.localFrame);
        }
      }
    },

    syncPlayState: (isPlaying: boolean) => {
      const state = get();

      set({
        syncState: {
          ...state.syncState,
          isPlaying,
          lastSyncTime: Date.now(),
        },
      });

      // Update all active instances
      for (const elementId of state.syncState.activeElementIds) {
        if (isPlaying) {
          get().playInstance(elementId);
        } else {
          get().pauseInstance(elementId);
        }
      }
    },

    syncPlaybackRate: (rate: number) => {
      const state = get();

      set({
        syncState: {
          ...state.syncState,
          playbackRate: rate,
          lastSyncTime: Date.now(),
        },
      });

      // Update all active instances
      for (const elementId of state.syncState.activeElementIds) {
        get().setInstancePlaybackRate(elementId, rate);
      }
    },

    updateActiveElements: (elementIds: string[]) => {
      set((state) => ({
        syncState: {
          ...state.syncState,
          activeElementIds: elementIds,
        },
      }));
    },

    // ========================================================================
    // Render Queue
    // ========================================================================

    addRenderJob: (job: Omit<RenderJob, "id" | "createdAt">) => {
      const id = generateUUID();
      const newJob: RenderJob = {
        ...job,
        id,
        createdAt: Date.now(),
      };

      set((state) => ({
        renderQueue: [...state.renderQueue, newJob].sort(
          (a, b) => b.priority - a.priority
        ),
      }));

      return id;
    },

    updateRenderJobStatus: (
      jobId: string,
      status: RenderJobStatus,
      progress?: number
    ) => {
      set((state) => ({
        renderQueue: state.renderQueue.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status,
                progress: progress ?? job.progress,
                ...(status === "rendering" && !job.startedAt
                  ? { startedAt: Date.now() }
                  : {}),
                ...(status === "complete" || status === "error"
                  ? { completedAt: Date.now() }
                  : {}),
              }
            : job
        ),
      }));
    },

    cancelRenderJob: (jobId: string) => {
      set((state) => ({
        renderQueue: state.renderQueue.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status: "cancelled" as RenderJobStatus,
                completedAt: Date.now(),
              }
            : job
        ),
      }));
    },

    clearCompletedJobs: () => {
      set((state) => ({
        renderQueue: state.renderQueue.filter(
          (job) =>
            job.status !== "complete" &&
            job.status !== "error" &&
            job.status !== "cancelled"
        ),
      }));
    },

    // ========================================================================
    // Error Handling
    // ========================================================================

    addError: (error: RemotionError) => {
      set((state) => ({
        recentErrors: [...state.recentErrors.slice(-19), error],
      }));

      // Also update the instance if applicable
      if (error.elementId) {
        set((state) => {
          const instance = state.instances.get(error.elementId!);
          if (!instance) return state;

          const newInstances = new Map(state.instances);
          newInstances.set(error.elementId!, {
            ...instance,
            error,
          });

          return { instances: newInstances };
        });
      }
    },

    clearErrors: () => {
      set({ recentErrors: [] });

      // Also clear errors from instances
      set((state) => {
        const newInstances = new Map(state.instances);
        for (const [id, instance] of newInstances) {
          if (instance.error) {
            newInstances.set(id, {
              ...instance,
              error: undefined,
            });
          }
        }
        return { instances: newInstances };
      });
    },

    // ========================================================================
    // Cleanup
    // ========================================================================

    reset: () => {
      // Cleanup all player refs
      const instances = get().instances;
      for (const [, instance] of instances) {
        if (instance.playerRef) {
          instance.playerRef.pause();
        }
      }

      set(initialState);
    },
  }))
);

// ============================================================================
// Selectors
// ============================================================================

/**
 * Selector to get all registered components as an array
 */
export const selectAllComponents = (state: RemotionStore) =>
  Array.from(state.registeredComponents.values());

/**
 * Selector to get all active instances as an array
 */
export const selectAllInstances = (state: RemotionStore) =>
  Array.from(state.instances.values());

/**
 * Selector to get pending render jobs
 */
export const selectPendingJobs = (state: RemotionStore) =>
  state.renderQueue.filter((job) => job.status === "pending");

/**
 * Selector to get currently rendering jobs
 */
export const selectRenderingJobs = (state: RemotionStore) =>
  state.renderQueue.filter((job) => job.status === "rendering");

/**
 * Selector to check if any render jobs are in progress
 */
export const selectIsRendering = (state: RemotionStore) =>
  state.renderQueue.some(
    (job) => job.status === "pending" || job.status === "rendering"
  );

/**
 * Selector to get recent errors
 */
export const selectRecentErrors = (state: RemotionStore) => state.recentErrors;

/**
 * Selector to get the current sync state
 */
export const selectSyncState = (state: RemotionStore) => state.syncState;

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to get a specific component by ID
 */
export function useRemotionComponent(componentId: string) {
  return useRemotionStore((state) => state.registeredComponents.get(componentId));
}

/**
 * Hook to get a specific instance by element ID
 */
export function useRemotionInstance(elementId: string) {
  return useRemotionStore((state) => state.instances.get(elementId));
}

/**
 * Hook to get components by category
 */
export function useComponentsByCategory(category: RemotionComponentCategory) {
  return useRemotionStore((state) => {
    const components = Array.from(state.registeredComponents.values());
    return components.filter((c) => c.category === category);
  });
}

/**
 * Hook to subscribe to sync state changes
 */
export function useSyncState() {
  return useRemotionStore(selectSyncState);
}

/**
 * Hook to check if store is initialized
 */
export function useRemotionInitialized() {
  return useRemotionStore((state) => state.isInitialized);
}

// ============================================================================
// Store Initialization
// ============================================================================

/**
 * Initialize the Remotion store.
 * Call this during app startup.
 */
export async function initializeRemotionStore() {
  const store = useRemotionStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
}
