import { fal } from "@fal-ai/client";
import type {
  FalAiImageResult,
  FalAiTextToImageInput,
  FalAiImageEditInput,
} from "../../types/nano-edit";

// Configure fal client with API key from environment or settings
const configureFalClient = async () => {
  console.log("[FalAiService] Starting FAL client configuration...");
  
  // First try environment variable (same as AI panel)
  const envApiKey = import.meta.env.VITE_FAL_API_KEY;
  console.log("[FalAiService] Checking environment variable:", envApiKey ? "Found (hidden)" : "Not found");
  
  if (envApiKey) {
    console.log("[FalAiService] Configuring FAL client with environment API key");
    fal.config({
      credentials: envApiKey
    });
    console.log("[FalAiService] FAL client configured successfully with env key");
    return true;
  }

  // Fall back to Electron storage
  console.log("[FalAiService] Checking Electron storage for API key...");
  if (window.electronAPI?.apiKeys) {
    try {
      const keys = await window.electronAPI.apiKeys.get();
      console.log("[FalAiService] Electron storage keys:", keys?.falApiKey ? "Found (hidden)" : "Not found");
      
      if (keys?.falApiKey) {
        console.log("[FalAiService] Configuring FAL client with storage API key");
        fal.config({
          credentials: keys.falApiKey
        });
        console.log("[FalAiService] FAL client configured successfully with storage key");
        return true;
      }
    } catch (error) {
      console.error("[FalAiService] Failed to load FAL API key from storage:", error);
    }
  } else {
    console.log("[FalAiService] Electron API not available");
  }
  
  console.log("[FalAiService] No API key found in environment or storage");
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
    console.log("[FalAiService.generateImage] Starting image generation");
    console.log("[FalAiService.generateImage] Prompt:", prompt);
    console.log("[FalAiService.generateImage] Options:", options);
    
    try {
      // Configure fal client with API key before making requests
      const configured = await configureFalClient();
      if (!configured) {
        console.error("[FalAiService.generateImage] API key configuration failed");
        throw new Error("FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings.");
      }

      const input: FalAiTextToImageInput = {
        prompt,
        num_images: 1,
        output_format: "jpeg",
        sync_mode: true,
        ...options,
      };
      
      console.log("[FalAiService.generateImage] Calling FAL API with input:", input);

      const result = await fal.subscribe("fal-ai/nano-banana", {
        input,
      });
      
      console.log("[FalAiService.generateImage] Raw FAL API response:", result);
      console.log("[FalAiService.generateImage] Response type:", typeof result);
      console.log("[FalAiService.generateImage] Response keys:", Object.keys(result));
      
      // Check if response has data property
      if ((result as any).data) {
        console.log("[FalAiService.generateImage] Response.data:", (result as any).data);
        console.log("[FalAiService.generateImage] Response.data keys:", Object.keys((result as any).data));
      }
      
      // Type guard to ensure result matches expected format
      const typedResult = result as any;
      
      // Try different response structures
      let imageUrls: string[] = [];
      
      // Check for images in direct response
      if (typedResult.images && Array.isArray(typedResult.images)) {
        console.log("[FalAiService.generateImage] Found images in direct response");
        imageUrls = typedResult.images.map((img: any) => img.url || img);
      }
      // Check for images in data property
      else if (typedResult.data?.images && Array.isArray(typedResult.data.images)) {
        console.log("[FalAiService.generateImage] Found images in data property");
        imageUrls = typedResult.data.images.map((img: any) => img.url || img);
      }
      // Check for single image in data
      else if (typedResult.data?.image) {
        console.log("[FalAiService.generateImage] Found single image in data property");
        imageUrls = [typedResult.data.image];
      }
      // Check for output property (some FAL models use this)
      else if (typedResult.data?.output) {
        console.log("[FalAiService.generateImage] Found output in data property");
        if (Array.isArray(typedResult.data.output)) {
          imageUrls = typedResult.data.output.map((item: any) => item.url || item);
        } else if (typeof typedResult.data.output === 'string') {
          imageUrls = [typedResult.data.output];
        }
      }
      
      console.log("[FalAiService.generateImage] Extracted image URLs:", imageUrls);
      console.log("[FalAiService.generateImage] Number of images returned:", imageUrls.length);

      return imageUrls;
    } catch (error) {
      console.error("[FalAiService.generateImage] Failed to generate image:", error);
      console.error("[FalAiService.generateImage] Error details:", {
        name: error instanceof Error ? error.name : "Unknown",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw new Error(
        `Image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Edit existing images using text prompts
   * @param prompt Text description for desired changes
   * @param imageUrls Array of image URLs to edit (max 10)
   * @param options Additional editing options
   * @returns Promise resolving to edited image URLs
   */
  static async editImages(
    prompt: string,
    imageUrls: string[],
    options: Partial<FalAiImageEditInput> = {}
  ): Promise<string[]> {
    console.log("[FalAiService.editImages] Starting image editing");
    console.log("[FalAiService.editImages] Prompt:", prompt);
    console.log("[FalAiService.editImages] Image URLs:", imageUrls);
    console.log("[FalAiService.editImages] Options:", options);
    
    try {
      // Configure fal client with API key before making requests
      const configured = await configureFalClient();
      if (!configured) {
        console.error("[FalAiService.editImages] API key configuration failed");
        throw new Error("FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings.");
      }

      if (imageUrls.length === 0) {
        console.error("[FalAiService.editImages] No image URLs provided");
        throw new Error("At least one image URL is required for editing");
      }

      if (imageUrls.length > 10) {
        console.error("[FalAiService.editImages] Too many images:", imageUrls.length);
        throw new Error("Maximum 10 images can be processed at once");
      }

      const input: FalAiImageEditInput = {
        prompt,
        image_urls: imageUrls, // Array of image URLs
        num_images: options.num_images || 1,
        output_format: options.output_format || "jpeg",
        sync_mode: true, // Return images as data URIs
        ...options,
      };
      
      console.log("[FalAiService.editImages] Calling FAL API with input:", input);

      // Use the correct nano-banana/edit endpoint
      const result = await fal.subscribe("fal-ai/nano-banana/edit", {
        input,
      });
      
      console.log("[FalAiService.editImages] Raw FAL API response:", result);
      console.log("[FalAiService.editImages] Response type:", typeof result);
      console.log("[FalAiService.editImages] Response keys:", Object.keys(result));
      
      // Check if response has data property
      if ((result as any).data) {
        console.log("[FalAiService.editImages] Response.data:", (result as any).data);
        console.log("[FalAiService.editImages] Response.data keys:", Object.keys((result as any).data));
      }
      
      // Type guard to ensure result matches expected format
      const typedResult = result as any;
      
      // Try different response structures
      let editedUrls: string[] = [];
      
      // Check for images in direct response
      if (typedResult.images && Array.isArray(typedResult.images)) {
        console.log("[FalAiService.editImages] Found images in direct response");
        editedUrls = typedResult.images.map((img: any) => img.url || img);
      }
      // Check for images in data property
      else if (typedResult.data?.images && Array.isArray(typedResult.data.images)) {
        console.log("[FalAiService.editImages] Found images in data property");
        editedUrls = typedResult.data.images.map((img: any) => img.url || img);
      }
      // Check for single image in data
      else if (typedResult.data?.image) {
        console.log("[FalAiService.editImages] Found single image in data property");
        editedUrls = [typedResult.data.image];
      }
      // Check for output property (some FAL models use this)
      else if (typedResult.data?.output) {
        console.log("[FalAiService.editImages] Found output in data property");
        if (Array.isArray(typedResult.data.output)) {
          editedUrls = typedResult.data.output.map((item: any) => item.url || item);
        } else if (typeof typedResult.data.output === 'string') {
          editedUrls = [typedResult.data.output];
        }
      }
      
      console.log("[FalAiService.editImages] Extracted image URLs:", editedUrls);
      console.log("[FalAiService.editImages] Number of images returned:", editedUrls.length);

      return editedUrls;
    } catch (error) {
      console.error("[FalAiService.editImages] Failed to edit images:", error);
      console.error("[FalAiService.editImages] Error details:", {
        name: error instanceof Error ? error.name : "Unknown",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
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
