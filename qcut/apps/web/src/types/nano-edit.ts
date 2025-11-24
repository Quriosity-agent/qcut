// Nano-banana transformation interface
export interface Transformation {
  title: string;
  prompt: string;
  emoji: string;
  description: string;
  isMultiImage?: boolean;
  isTwoStep?: boolean;
  stepTwoPrompt?: string;
  primaryUploaderTitle?: string;
  secondaryUploaderTitle?: string;
  primaryUploaderDescription?: string;
  secondaryUploaderDescription?: string;
  category?: string;
}

export interface GeneratedContent {
  imageUrl: string | null;
  text: string | null;
  secondaryImageUrl?: string | null;
}

export interface NanoEditAsset {
  id: string;
  type: "thumbnail" | "title-card" | "logo" | "overlay";
  url: string;
  projectId?: string;
  createdAt: Date;
  prompt?: string;
  dimensions?: string;
  transformation?: Transformation;
}

export interface NanoEditState {
  assets: NanoEditAsset[];
  isProcessing: boolean;
  currentProject?: string;
}

export interface NanoEditActions {
  addAsset: (asset: NanoEditAsset) => void;
  removeAsset: (id: string) => void;
  setProcessing: (processing: boolean) => void;
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
