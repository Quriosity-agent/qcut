import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { NanoEditStore, NanoEditAsset } from "../types/nano-edit";

export const useNanoEditStore = create<NanoEditStore>()(
  devtools(
    (set, get) => ({
      // State
      assets: [],
      isProcessing: false,
      activeTab: "image-assets",
      currentProject: undefined,

      // Actions
      addAsset: (asset: NanoEditAsset) =>
        set(
          (state) => ({
            assets: [...state.assets, asset],
          }),
          false,
          "nano-edit/addAsset"
        ),

      removeAsset: (id: string) =>
        set(
          (state) => ({
            assets: state.assets.filter((asset) => asset.id !== id),
          }),
          false,
          "nano-edit/removeAsset"
        ),

      setProcessing: (processing: boolean) =>
        set({ isProcessing: processing }, false, "nano-edit/setProcessing"),

      setActiveTab: (tab) =>
        set({ activeTab: tab }, false, "nano-edit/setActiveTab"),

      clearAssets: () => set({ assets: [] }, false, "nano-edit/clearAssets"),
    }),
    {
      name: "nano-edit-store",
    }
  )
);

// Selectors for common use cases
export const selectAssetsByType =
  (type: NanoEditAsset["type"]) => (state: NanoEditStore) =>
    state.assets.filter((asset) => asset.type === type);

export const selectAssetsByProject =
  (projectId: string) => (state: NanoEditStore) =>
    state.assets.filter((asset) => asset.projectId === projectId);

export const selectIsProcessing = (state: NanoEditStore) => state.isProcessing;

export const selectActiveTab = (state: NanoEditStore) => state.activeTab;
