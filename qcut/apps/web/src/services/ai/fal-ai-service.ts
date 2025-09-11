import { fal } from '@fal-ai/client';
import type {
  FalAiImageResult,
  FalAiTextToImageInput,
  FalAiImageEditInput,
} from '@/types/nano-edit';

// FAL API response types
type FalApiResponse = {
  images?: { url: string }[];
  data?: {
    images?: { url: string }[];
    image?: string;
    output?: { url: string }[] | string;
  };
};

// Configure fal client with API key from environment or settings
const configureFalClient = async () => {
  // First try environment variable (same as AI panel)
  const envApiKey = import.meta.env.VITE_FAL_API_KEY;
  
  if (envApiKey) {
    fal.config({
      credentials: envApiKey
    });
    return true;
  }

  // Fall back to Electron storage
  if (window.electronAPI?.apiKeys) {
    try {
      const keys = await window.electronAPI.apiKeys.get();
      
      if (keys?.falApiKey) {
        fal.config({
          credentials: keys.falApiKey
        });
        return true;
      }
    } catch (error) {
      console.error("[FalAiService] Failed to load FAL API key from storage:", error);
    }
  }
  
  return false;
};

/**
 * Service class for interacting with fal.ai Nano Banana APIs
 * Provides text-to-image generation and image editing capabilities
 */
export class FalAiService {
  /**
   * Generate images from text prompts using fal.ai nano-banana model
   * @param prompt Text description for image generation
   * @param options Additional generation options
   * @returns Promise resolving to generated image URLs
   */
  static async generateImage(
    prompt: string,
    options: Partial<FalAiTextToImageInput> = {}
  ): Promise<string[]> {
    try {
      // Configure fal client with API key before making requests
      const configured = await configureFalClient();
      if (!configured) {
        throw new Error("FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings.");
      }

      const input: FalAiTextToImageInput = {
        prompt,
        num_images: 1,
        output_format: "jpeg",
        sync_mode: true,
        ...options,
      };

      const result = await fal.subscribe("fal-ai/nano-banana", {
        input,
      });
      
      // Parse response with proper typing
      const response = result as FalApiResponse;
      
      // Try different response structures
      let imageUrls: string[] = [];
      
      // Check for images in direct response
      if (response.images && Array.isArray(response.images)) {
        imageUrls = response.images.map((img) => img.url);
      }
      // Check for images in data property
      else if (response.data?.images && Array.isArray(response.data.images)) {
        imageUrls = response.data.images.map((img) => img.url);
      }
      // Check for single image in data
      else if (response.data?.image && typeof response.data.image === 'string') {
        imageUrls = [response.data.image];
      }
      // Check for output property (some FAL models use this)
      else if (response.data?.output) {
        if (Array.isArray(response.data.output)) {
          imageUrls = response.data.output.map((item) => typeof item === 'string' ? item : item.url).filter(Boolean);
        } else if (typeof response.data.output === 'string') {
          imageUrls = [response.data.output];
        }
      }

      return imageUrls;
    } catch (error) {
      console.error("[FalAiService] Image generation failed:", error);
      throw new Error(
        `Image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Edit existing images using text prompts
   * @param prompt Text description for desired changes
   * @param imageUrls Array of image URLs or data URLs to edit (max 10)
   * @param options Additional editing options
   * @returns Promise resolving to edited image URLs
   */
  static async editImages(
    prompt: string,
    imageUrls: string[],
    options: Partial<FalAiImageEditInput> = {}
  ): Promise<string[]> {
    try {
      // Configure fal client with API key before making requests
      const configured = await configureFalClient();
      if (!configured) {
        throw new Error("FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings.");
      }

      if (imageUrls.length === 0) {
        throw new Error("At least one image URL is required for editing");
      }

      if (imageUrls.length > 10) {
        throw new Error("Maximum 10 images can be processed at once");
      }

      // The nano-banana/edit endpoint accepts data URLs directly
      const input: FalAiImageEditInput = {
        prompt,
        image_urls: imageUrls, // Can be data URLs or regular URLs
        num_images: options.num_images || 1,
        output_format: options.output_format || "jpeg",
        sync_mode: true, // Return images as data URIs
        ...options,
      };

      // Use the correct nano-banana/edit endpoint
      const result = await fal.subscribe("fal-ai/nano-banana/edit", {
        input,
      });
      
      // Parse response with proper typing
      const response = result as FalApiResponse;
      
      // Try different response structures
      let editedUrls: string[] = [];
      
      // Check for images in direct response
      if (response.images && Array.isArray(response.images)) {
        editedUrls = response.images.map((img) => img.url);
      }
      // Check for images in data property
      else if (response.data?.images && Array.isArray(response.data.images)) {
        editedUrls = response.data.images.map((img) => img.url);
      }
      // Check for single image in data
      else if (response.data?.image && typeof response.data.image === 'string') {
        editedUrls = [response.data.image];
      }
      // Check for output property (some FAL models use this)
      else if (response.data?.output) {
        if (Array.isArray(response.data.output)) {
          editedUrls = response.data.output.map((item) => typeof item === 'string' ? item : item.url).filter(Boolean);
        } else if (typeof response.data.output === 'string') {
          editedUrls = [response.data.output];
        }
      }

      return editedUrls;
    } catch (error) {
      console.error("[FalAiService] Image editing failed:", error);
      throw new Error(
        `Image editing failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Generate multiple thumbnail variations for video projects
   * @param projectTitle Title of the video project
   * @param style Style preference (e.g., 'vibrant', 'minimalist', 'professional')
   * @param count Number of variations to generate (1-4)
   * @returns Promise resolving to thumbnail URLs
   */
  static async generateThumbnails(
    projectTitle: string,
    style: string = "vibrant",
    count: number = 3
  ): Promise<string[]> {
    const prompt = `Create a ${style} YouTube thumbnail for "${projectTitle}"`;

    return this.generateImage(prompt, {
      num_images: Math.min(count, 4),
      output_format: "png",
    });
  }

  /**
   * Generate title card for video projects
   * @param title Main title text
   * @param subtitle Optional subtitle text
   * @param style Style preference
   * @returns Promise resolving to title card URL
   */
  static async generateTitleCard(
    title: string,
    subtitle: string = "",
    style: string = "professional"
  ): Promise<string> {
    const subtitleText = subtitle ? ` with subtitle "${subtitle}"` : "";
    const prompt = `Create a ${style} title card with text "${title}"${subtitleText}`;

    const results = await this.generateImage(prompt, {
      num_images: 1,
      output_format: "png",
    });

    return results[0] || "";
  }

  /**
   * Check if fal.ai service is available and configured
   * @returns Promise resolving to boolean indicating availability
   */
  static async isAvailable(): Promise<boolean> {
    try {
      // Simple connectivity check - could be expanded with actual API ping
      return typeof fal !== "undefined";
    } catch {
      return false;
    }
  }
}
