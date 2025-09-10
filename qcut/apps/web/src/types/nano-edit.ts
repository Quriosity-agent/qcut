export interface NanoEditAsset {
  id: string;
  type: "thumbnail" | "title-card" | "logo" | "overlay";
  url: string;
  projectId?: string;
  createdAt: Date;
  prompt?: string;
  dimensions?: string;
}

export interface NanoEditState {
  assets: NanoEditAsset[];
  isProcessing: boolean;
  activeTab: "image-assets" | "enhancement" | "templates" | "style-transfer";
  currentProject?: string;
}

export interface NanoEditActions {
  addAsset: (asset: NanoEditAsset) => void;
  removeAsset: (id: string) => void;
  setProcessing: (processing: boolean) => void;
  setActiveTab: (tab: NanoEditState["activeTab"]) => void;
  clearAssets: () => void;
}

export type NanoEditStore = NanoEditState & NanoEditActions;

// fal.ai API response types
export interface FalAiImageResult {
  images: Array<{
    url: string;
    width: number;
    height: number;
  }>;
  description?: string;
}

export interface FalAiTextToImageInput {
  prompt: string;
  num_images?: number;
  output_format?: "jpeg" | "png";
  sync_mode?: boolean;
  image_size?: {
    width: number;
    height: number;
  };
}

export interface FalAiImageEditInput {
  prompt: string;
  image_urls: string[];
  num_images?: number;
  output_format?: "jpeg" | "png";
  sync_mode?: boolean;
}
