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
	ImportedFolderInfo,
	FolderImportResult,
} from "@/lib/remotion/types";
import { generateUUID } from "@/lib/utils";
import { builtInComponentDefinitions } from "@/lib/remotion/built-in";
import { debugLog, debugError } from "@/lib/debug/debug-config";
import {
	getSequenceAnalysisService,
	type AnalysisResult,
} from "@/lib/remotion/sequence-analysis-service";
import {
	importFromFolder as importFromFolderLoader,
	isFolderImportAvailable,
	type FolderLoadResult,
} from "@/lib/remotion/component-loader";

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
	analyzedSequences: new Map(),
	importedFolders: new Map(),
	isFolderImporting: false,
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
			debugLog("[REMOTION] initialize() called", {
				isInitialized: get().isInitialized,
				isLoading: get().isLoading,
			});

			const { isInitialized } = get();
			if (isInitialized) {
				debugLog("[REMOTION] Already initialized, returning early");
				return;
			}

			set({ isLoading: true });

			try {
				// Load built-in components
				const newComponents = new Map(get().registeredComponents);
				debugLog("[REMOTION] Loading built-in components...");

				for (const definition of builtInComponentDefinitions) {
					newComponents.set(definition.id, definition);
					debugLog("[REMOTION] Registered:", definition.id);
				}

				set({
					registeredComponents: newComponents,
					isInitialized: true,
					isLoading: false,
				});

				debugLog("[REMOTION] Initialization complete!", {
					totalComponents: newComponents.size,
				});
			} catch (error) {
				debugError("[REMOTION] Initialization failed:", error);
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
		// Sequence Analysis
		// ========================================================================

		setAnalysisResult: (componentId: string, result: AnalysisResult) => {
			set((state) => {
				const newMap = new Map(state.analyzedSequences);
				newMap.set(componentId, result);
				return { analyzedSequences: newMap };
			});
		},

		getAnalysisResult: (componentId: string) => {
			return get().analyzedSequences.get(componentId);
		},

		clearAnalysisResult: (componentId: string) => {
			set((state) => {
				const newMap = new Map(state.analyzedSequences);
				newMap.delete(componentId);
				return { analyzedSequences: newMap };
			});
		},

		analyzeComponentSource: async (componentId: string, sourceCode: string) => {
			const service = getSequenceAnalysisService();
			const result = await service.analyzeComponent(componentId, sourceCode);
			get().setAnalysisResult(componentId, result);

			// If analysis found sequences, update the component definition
			if (result.structure) {
				set((state) => {
					const components = new Map(state.registeredComponents);
					const existing = components.get(componentId);
					if (existing && !existing.sequenceStructure) {
						components.set(componentId, {
							...existing,
							sequenceStructure: result.structure!,
						});
						return { registeredComponents: components };
					}
					return state;
				});
			}

			return result;
		},

		// ========================================================================
		// Folder Import
		// ========================================================================

		importFromFolder: async (
			folderPath?: string
		): Promise<FolderImportResult> => {
			// Check if folder import is available
			if (!isFolderImportAvailable()) {
				return {
					success: false,
					componentIds: [],
					successCount: 0,
					errorCount: 1,
					errors: ["Folder import is only available in Electron"],
					folderPath: folderPath || "",
				};
			}

			set({ isFolderImporting: true });

			try {
				// Call the component loader to perform the import
				const result = await importFromFolderLoader(folderPath);

				if (!result.success) {
					set({ isFolderImporting: false });
					return {
						success: false,
						componentIds: [],
						successCount: 0,
						errorCount: result.errorCount,
						errors: result.errors,
						folderPath: result.folderPath,
					};
				}

				// Register all loaded components
				const componentIds: string[] = [];
				const newComponents = new Map(get().registeredComponents);

				for (const component of result.components) {
					newComponents.set(component.id, component);
					componentIds.push(component.id);
					console.log(
						`[RemotionStore] ✅ Registered component: ${component.name} (${component.id})`
					);
					debugLog("[REMOTION] Registered folder component:", component.id);
				}

				// Create folder info entry
				const folderInfo: ImportedFolderInfo = {
					folderPath: result.folderPath,
					name: result.folderPath.split(/[/\\]/).pop() || "Imported Folder",
					componentIds,
					compositionCount: result.components.length,
					importedAt: Date.now(),
					refreshedAt: Date.now(),
				};

				// Update state with new components and folder info
				const newFolders = new Map(get().importedFolders);
				newFolders.set(result.folderPath, folderInfo);

				set({
					registeredComponents: newComponents,
					importedFolders: newFolders,
					isFolderImporting: false,
				});

				debugLog("[REMOTION] Folder import complete:", {
					folderPath: result.folderPath,
					componentCount: componentIds.length,
				});

				return {
					success: true,
					componentIds,
					successCount: result.successCount,
					errorCount: result.errorCount,
					errors: result.errors,
					folderPath: result.folderPath,
				};
			} catch (error) {
				debugError("[REMOTION] Folder import failed:", error);
				set({ isFolderImporting: false });

				return {
					success: false,
					componentIds: [],
					successCount: 0,
					errorCount: 1,
					errors: [error instanceof Error ? error.message : "Unknown error"],
					folderPath: folderPath || "",
				};
			}
		},

		refreshFolder: async (folderPath: string): Promise<FolderImportResult> => {
			const existingFolder = get().importedFolders.get(folderPath);
			if (!existingFolder) {
				return {
					success: false,
					componentIds: [],
					successCount: 0,
					errorCount: 1,
					errors: ["Folder not found in imported folders"],
					folderPath,
				};
			}

			// Remove existing components from this folder
			const newComponents = new Map(get().registeredComponents);
			for (const componentId of existingFolder.componentIds) {
				newComponents.delete(componentId);
			}
			set({ registeredComponents: newComponents });

			// Re-import from the folder
			return get().importFromFolder(folderPath);
		},

		removeFolder: (folderPath: string) => {
			const existingFolder = get().importedFolders.get(folderPath);
			if (!existingFolder) {
				debugLog("[REMOTION] Folder not found for removal:", folderPath);
				return;
			}

			// Remove all components from this folder
			const newComponents = new Map(get().registeredComponents);
			for (const componentId of existingFolder.componentIds) {
				newComponents.delete(componentId);
				debugLog("[REMOTION] Removed folder component:", componentId);
			}

			// Remove folder info
			const newFolders = new Map(get().importedFolders);
			newFolders.delete(folderPath);

			set({
				registeredComponents: newComponents,
				importedFolders: newFolders,
			});

			debugLog("[REMOTION] Folder removed:", folderPath);
		},

		getImportedFolders: () => {
			return Array.from(get().importedFolders.values());
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

/**
 * Selector to get all imported folders
 */
export const selectImportedFolders = (state: RemotionStore) =>
	Array.from(state.importedFolders.values());

/**
 * Selector to check if folder import is in progress
 */
export const selectIsFolderImporting = (state: RemotionStore) =>
	state.isFolderImporting;

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to get a specific component by ID
 */
export function useRemotionComponent(componentId: string) {
	return useRemotionStore((state) =>
		state.registeredComponents.get(componentId)
	);
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

/**
 * Hook to get analysis result for a component
 */
export function useComponentAnalysis(
	componentId: string | undefined
): AnalysisResult | undefined {
	return useRemotionStore((state) =>
		componentId ? state.analyzedSequences.get(componentId) : undefined
	);
}

/**
 * Hook to get all imported folders
 */
export function useImportedFolders() {
	return useRemotionStore(selectImportedFolders);
}

/**
 * Hook to check if folder import is in progress
 */
export function useFolderImporting() {
	return useRemotionStore(selectIsFolderImporting);
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

// ============================================================================
// Debug Helper (Browser Console)
// ============================================================================

/**
 * Expose store for debugging in browser console.
 * Usage:
 *   __REMOTION_DEBUG__.isInitialized()  // Should be true
 *   __REMOTION_DEBUG__.getComponents()  // Should list 13+ component IDs
 *   __REMOTION_DEBUG__.getState()       // Full store state
 */
if (typeof window !== "undefined") {
	(window as unknown as { __REMOTION_DEBUG__: object }).__REMOTION_DEBUG__ = {
		getState: () => useRemotionStore.getState(),
		getComponents: () => [
			...useRemotionStore.getState().registeredComponents.keys(),
		],
		isInitialized: () => useRemotionStore.getState().isInitialized,
		getInstances: () => [...useRemotionStore.getState().instances.keys()],
		getImportedFolders: () => [
			...useRemotionStore.getState().importedFolders.keys(),
		],
		isFolderImporting: () => useRemotionStore.getState().isFolderImporting,
	};
}
