import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import {
  getModelCapabilities,
  type ImageEditModelId,
} from "@/lib/image-edit-capabilities";

export interface EditHistoryItem {
  id: string;
  timestamp: Date;
  originalUrl: string;
  editedUrl: string;
  prompt: string;
  model: string;
  parameters: Record<string, any>;
  processingTime?: number;
}

export interface AdjustmentState {
  // Current image
  originalImage: File | null;
  originalImageUrl: string | null;
  currentEditedUrl: string | null;

  // Multiple images for multi-image models
  multipleImages: string[];
  // Multiple image files (File objects for upload)
  multipleImageFiles: File[];

  // Model selection - uses shared type from capabilities
  selectedModel: ImageEditModelId;

  // Parameters
  prompt: string;
  parameters: {
    // Existing parameters (keep for backward compatibility)
    guidanceScale: number;
    steps: number;
    seed?: number;
    safetyTolerance: number;
    numImages: number;

    // Add new V4-specific parameters (optional for backward compatibility)
    imageSize?: string; // "square_hd", "square", etc. for V4
    maxImages?: number; // 1-10 for V4
    syncMode?: boolean; // V4, Nano Banana, and Reve Edit
    enableSafetyChecker?: boolean; // V4
    outputFormat?: "jpeg" | "png" | "webp"; // Nano Banana and Reve Edit (lowercase required by FAL API)
  };

  // Edit history
  editHistory: EditHistoryItem[];
  currentHistoryIndex: number;

  // Processing state
  isProcessing: boolean;
  progress: number;
  statusMessage: string;
  elapsedTime: number;
  estimatedTime?: number;

  // UI state
  showParameters: boolean;
  showHistory: boolean;
  previewMode: "side-by-side" | "overlay" | "single";
}

export interface AdjustmentActions {
  // Image management
  setOriginalImage: (file: File, url: string) => void;
  clearImage: () => void;

  // Multiple image management
  setMultipleImages: (imageUrls: string[], files?: File[]) => void;
  addMultipleImage: (file: File, url: string) => void;
  removeMultipleImage: (index: number) => void;
  clearMultipleImages: () => void;
  reorderMultipleImages: (fromIndex: number, toIndex: number) => void;

  // Model and parameters
  setSelectedModel: (model: ImageEditModelId) => void;
  setPrompt: (prompt: string) => void;
  updateParameter: (key: string, value: any) => void;
  resetParameters: () => void;

  // Edit history
  addToHistory: (item: Omit<EditHistoryItem, "id" | "timestamp">) => void;
  goToHistoryItem: (index: number) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;

  // Processing state
  setProcessingState: (state: {
    isProcessing: boolean;
    progress?: number;
    statusMessage?: string;
    elapsedTime?: number;
    estimatedTime?: number;
  }) => void;

  // UI state
  toggleParameters: () => void;
  toggleHistory: () => void;
  setPreviewMode: (mode: AdjustmentState["previewMode"]) => void;
}

type AdjustmentStore = AdjustmentState & AdjustmentActions;

const getDefaultParameters = (model: ImageEditModelId) => {
  switch (model) {
    case "seededit":
      return {
        guidanceScale: 1.0,
        steps: 20,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
      };
    case "flux-kontext":
    case "flux-kontext-max":
      return {
        guidanceScale: 3.5,
        steps: 28,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
      };
    case "seeddream-v4":
      return {
        guidanceScale: 2.5,
        steps: 20,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
        imageSize: "square_hd",
        maxImages: 1,
        syncMode: false,
        enableSafetyChecker: true,
      };
    case "seeddream-v4-5-edit":
      return {
        guidanceScale: 2.5,
        steps: 20,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
        imageSize: "auto_2K",
        maxImages: 1,
        syncMode: false,
        enableSafetyChecker: true,
      };
    case "nano-banana":
      return {
        guidanceScale: 2.5,
        steps: 20,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
        outputFormat: "png" as const,
        syncMode: false,
      };
    case "reve-edit":
      return {
        guidanceScale: 2.5,
        steps: 20,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
        outputFormat: "png" as const,
        syncMode: false,
      };
    case "gemini-3-pro-edit":
      return {
        guidanceScale: 2.5,
        steps: 20,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
        outputFormat: "png" as const,
        resolution: "1K" as const,
        aspectRatio: "auto",
        syncMode: false,
      };
    case "flux-2-flex-edit":
      return {
        guidanceScale: 3.5,
        steps: 28,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
        outputFormat: "jpeg" as const,
        syncMode: false,
      };
    default:
      // Fallback for any new models
      return {
        guidanceScale: 2.5,
        steps: 20,
        seed: undefined,
        safetyTolerance: 2,
        numImages: 1,
      };
  }
};

export const useAdjustmentStore = create<AdjustmentStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    originalImage: null,
    originalImageUrl: null,
    currentEditedUrl: null,
    multipleImages: [],
    multipleImageFiles: [],
    selectedModel: "seededit" as ImageEditModelId,
    prompt: "",
    parameters: getDefaultParameters("seededit"),
    editHistory: [],
    currentHistoryIndex: -1,
    isProcessing: false,
    progress: 0,
    statusMessage: "",
    elapsedTime: 0,
    estimatedTime: undefined,
    showParameters: true,
    showHistory: false,
    previewMode: "side-by-side",

    // Actions
    setOriginalImage: (file, url) => {
      // Before setting the new URL, clean up the old one
      const prevUrl = get().originalImageUrl;
      if (prevUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(prevUrl);
      }
      set({
        originalImage: file,
        originalImageUrl: url,
        currentEditedUrl: null,
        editHistory: [],
        currentHistoryIndex: -1,
      });
    },

    clearImage: () => {
      // Clean up blob URLs before clearing
      const { originalImageUrl, currentEditedUrl } = get();
      if (originalImageUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(originalImageUrl);
      }
      if (currentEditedUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(currentEditedUrl);
      }
      set({
        originalImage: null,
        originalImageUrl: null,
        currentEditedUrl: null,
        editHistory: [],
        currentHistoryIndex: -1,
        prompt: "",
      });
    },

    setMultipleImages: (imageUrls, files = []) => {
      // Clean up old URLs that are blob URLs
      const { multipleImages } = get();
      for (const url of multipleImages) {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
      set({
        multipleImages: imageUrls,
        multipleImageFiles: files,
      });
    },

    addMultipleImage: (file, url) => {
      set((state) => ({
        multipleImages: [...state.multipleImages, url],
        multipleImageFiles: [...state.multipleImageFiles, file],
      }));
    },

    removeMultipleImage: (index) => {
      const { multipleImages, multipleImageFiles } = get();
      const urlToRemove = multipleImages[index];

      // Clean up blob URL
      if (urlToRemove?.startsWith("blob:")) {
        URL.revokeObjectURL(urlToRemove);
      }

      set({
        multipleImages: multipleImages.filter((_, i) => i !== index),
        multipleImageFiles: multipleImageFiles.filter((_, i) => i !== index),
      });
    },

    clearMultipleImages: () => {
      const { multipleImages } = get();
      // Clean up all blob URLs
      for (const url of multipleImages) {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
      set({
        multipleImages: [],
        multipleImageFiles: [],
      });
    },

    reorderMultipleImages: (fromIndex, toIndex) => {
      const { multipleImages, multipleImageFiles } = get();

      const newUrls = [...multipleImages];
      const newFiles = [...multipleImageFiles];

      // Remove from old position
      const [movedUrl] = newUrls.splice(fromIndex, 1);
      const [movedFile] = newFiles.splice(fromIndex, 1);

      // Insert at new position
      newUrls.splice(toIndex, 0, movedUrl);
      newFiles.splice(toIndex, 0, movedFile);

      set({
        multipleImages: newUrls,
        multipleImageFiles: newFiles,
      });
    },

    setSelectedModel: (model) => {
      const { multipleImages, multipleImageFiles } = get();
      const capabilities = getModelCapabilities(model);

      // If switching to single-image model with multiple images, keep only first
      if (!capabilities.supportsMultiple && multipleImages.length > 1) {
        // Clean up extra blob URLs
        for (let i = 1; i < multipleImages.length; i++) {
          const url = multipleImages[i];
          if (url.startsWith("blob:")) {
            URL.revokeObjectURL(url);
          }
        }

        set({
          selectedModel: model,
          parameters: getDefaultParameters(model),
          multipleImages: multipleImages.slice(0, 1),
          multipleImageFiles: multipleImageFiles.slice(0, 1),
        });
        return;
      }

      // If exceeding new model's max, trim to max
      if (multipleImages.length > capabilities.maxImages) {
        // Clean up extra blob URLs
        for (let i = capabilities.maxImages; i < multipleImages.length; i++) {
          const url = multipleImages[i];
          if (url.startsWith("blob:")) {
            URL.revokeObjectURL(url);
          }
        }

        set({
          selectedModel: model,
          parameters: getDefaultParameters(model),
          multipleImages: multipleImages.slice(0, capabilities.maxImages),
          multipleImageFiles: multipleImageFiles.slice(0, capabilities.maxImages),
        });
        return;
      }

      // Normal case - just switch model
      set({
        selectedModel: model,
        parameters: getDefaultParameters(model),
      });
    },

    setPrompt: (prompt) => {
      set({ prompt });
    },

    updateParameter: (key, value) => {
      set((state) => ({
        parameters: {
          ...state.parameters,
          [key]: value,
        },
      }));
    },

    resetParameters: () => {
      const { selectedModel } = get();
      set({ parameters: getDefaultParameters(selectedModel) });
    },

    addToHistory: (item) => {
      const id = Math.random().toString(36).substr(2, 9);
      const historyItem: EditHistoryItem = {
        ...item,
        id,
        timestamp: new Date(),
      };

      set((state) => {
        // Remove any history items after current index (for branching)
        const newHistory = state.editHistory.slice(
          0,
          state.currentHistoryIndex + 1
        );
        newHistory.push(historyItem);

        return {
          editHistory: newHistory,
          currentHistoryIndex: newHistory.length - 1,
          currentEditedUrl: item.editedUrl,
        };
      });
    },

    goToHistoryItem: (index) => {
      const { editHistory } = get();
      if (index >= 0 && index < editHistory.length) {
        const item = editHistory[index];
        const currentParams = getDefaultParameters(item.model as ImageEditModelId);
        set({
          currentHistoryIndex: index,
          currentEditedUrl: item.editedUrl,
          prompt: item.prompt,
          selectedModel: item.model as ImageEditModelId,
          parameters: { ...currentParams, ...item.parameters },
        });
      }
    },

    canUndo: () => {
      const { currentHistoryIndex } = get();
      return currentHistoryIndex > 0;
    },

    canRedo: () => {
      const { editHistory, currentHistoryIndex } = get();
      return currentHistoryIndex < editHistory.length - 1;
    },

    undo: () => {
      const { currentHistoryIndex, goToHistoryItem } = get();
      if (currentHistoryIndex > 0) {
        goToHistoryItem(currentHistoryIndex - 1);
      }
    },

    redo: () => {
      const { editHistory, currentHistoryIndex, goToHistoryItem } = get();
      if (currentHistoryIndex < editHistory.length - 1) {
        goToHistoryItem(currentHistoryIndex + 1);
      }
    },

    clearHistory: () => {
      // Clean up blob URLs from edit history
      const { editHistory, currentEditedUrl } = get();
      editHistory.forEach((item) => {
        if (item.editedUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(item.editedUrl);
        }
      });
      if (currentEditedUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(currentEditedUrl);
      }
      set({
        editHistory: [],
        currentHistoryIndex: -1,
        currentEditedUrl: null,
      });
    },

    setProcessingState: (state) => {
      set((currentState) => ({
        isProcessing: state.isProcessing,
        progress: state.progress ?? currentState.progress,
        statusMessage: state.statusMessage ?? currentState.statusMessage,
        elapsedTime: state.elapsedTime ?? currentState.elapsedTime,
        estimatedTime: state.estimatedTime ?? currentState.estimatedTime,
      }));
    },

    toggleParameters: () => {
      set((state) => ({ showParameters: !state.showParameters }));
    },

    toggleHistory: () => {
      set((state) => ({ showHistory: !state.showHistory }));
    },

    setPreviewMode: (mode) => {
      set({ previewMode: mode });
    },
  }))
);

// Persist settings to localStorage
if (typeof window !== "undefined") {
  const savedSettings = localStorage.getItem("adjustment-settings");
  if (savedSettings) {
    try {
      const settings = JSON.parse(savedSettings);
      useAdjustmentStore.setState({
        selectedModel: settings.selectedModel || "seededit",
        showParameters: settings.showParameters ?? true,
        previewMode: settings.previewMode || "side-by-side",
      });
    } catch (error) {
      console.warn("Failed to load adjustment settings:", error);
    }
  }

  // Save settings on changes
  useAdjustmentStore.subscribe(
    (state) => ({
      selectedModel: state.selectedModel,
      showParameters: state.showParameters,
      previewMode: state.previewMode,
    }),
    (settings) => {
      localStorage.setItem("adjustment-settings", JSON.stringify(settings));
    }
  );
}
