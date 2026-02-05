import type {
  FalAiTextToImageInput,
  FalAiImageEditInput,
} from "@/types/nano-edit";
import { getFalApiKeyAsync } from "@/lib/ai-video/core/fal-request";

const FAL_API_BASE = "https://fal.run";

// FAL API response types
type FalApiResponse = {
  images?: { url: string }[];
  data?: {
    images?: { url: string }[];
    image?: string;
    output?: { url: string }[] | string;
  };
};

// Type guard for FAL API response validation
const isFalApiResponse = (response: unknown): response is FalApiResponse => {
  if (typeof response !== "object" || response === null) {
    return false;
  }

  const resp = response as Record<string, unknown>;

  // Check if response has expected shape
  const hasImages =
    !resp.images ||
    (Array.isArray(resp.images) &&
      resp.images.every(
        (img: unknown) =>
          typeof img === "object" &&
          img !== null &&
          typeof (img as { url?: unknown }).url === "string"
      ));

  const hasValidData =
    !resp.data || (typeof resp.data === "object" && resp.data !== null);

  return hasImages && hasValidData;
};

/**
 * Make a direct FAL API request without using @fal-ai/client
 * This avoids initialization issues in Electron
 */
async function makeFalApiRequest(
  endpoint: string,
  input: Record<string, unknown>
): Promise<FalApiResponse> {
  const apiKey = await getFalApiKeyAsync();
  if (!apiKey) {
    throw new Error(
      "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
    );
  }

  const url = `${FAL_API_BASE}/${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage =
      (errorData as Record<string, unknown>).detail ||
      (errorData as Record<string, unknown>).error ||
      response.statusText;
    throw new Error(`FAL API error: ${errorMessage}`);
  }

  return response.json();
}

/**
 * Parse image URLs from FAL API response
 */
function parseImageUrls(response: FalApiResponse): string[] {
  // Check for images in direct response
  if (response.images && Array.isArray(response.images)) {
    return response.images.map((img) => img.url);
  }
  // Check for images in data property
  if (response.data?.images && Array.isArray(response.data.images)) {
    return response.data.images.map((img) => img.url);
  }
  // Check for single image in data
  if (response.data?.image && typeof response.data.image === "string") {
    return [response.data.image];
  }
  // Check for output property (some FAL models use this)
  if (response.data?.output) {
    if (Array.isArray(response.data.output)) {
      return response.data.output
        .map((item) => (typeof item === "string" ? item : item.url))
        .filter(Boolean);
    }
    if (typeof response.data.output === "string") {
      return [response.data.output];
    }
  }
  return [];
}

/**
 * Service for interacting with fal.ai Nano Banana APIs
 * Provides text-to-image generation and image editing capabilities
 * Uses direct HTTP requests to avoid @fal-ai/client initialization issues in Electron
 */
export const FalAiService = {
  /**
   * Generate images from text prompts using fal.ai nano-banana model
   * @param prompt Text description for image generation
   * @param options Additional generation options
   * @returns Promise resolving to generated image URLs
   */
  async generateImage(
    prompt: string,
    options: Partial<FalAiTextToImageInput> = {}
  ): Promise<string[]> {
    try {
      const input: FalAiTextToImageInput = {
        prompt,
        num_images: 1,
        output_format: "jpeg",
        sync_mode: true,
        ...options,
      };

      const response = await makeFalApiRequest(
        "fal-ai/nano-banana",
        input as unknown as Record<string, unknown>
      );

      if (!isFalApiResponse(response)) {
        throw new Error("Unexpected FAL response shape");
      }

      return parseImageUrls(response);
    } catch (error) {
      throw new Error(
        `Image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        { cause: error as unknown as Error }
      );
    }
  },

  /**
   * Edit existing images using text prompts
   * @param prompt Text description for desired changes
   * @param imageUrls Array of image URLs or data URLs to edit (max 10)
   * @param options Additional editing options
   * @returns Promise resolving to edited image URLs
   */
  async editImages(
    prompt: string,
    imageUrls: string[],
    options: Partial<FalAiImageEditInput> = {}
  ): Promise<string[]> {
    try {
      if (imageUrls.length === 0) {
        throw new Error("At least one image URL is required for editing");
      }

      if (imageUrls.length > 10) {
        throw new Error("Maximum 10 images can be processed at once");
      }

      const input: FalAiImageEditInput = {
        prompt,
        image_urls: imageUrls,
        num_images: options.num_images || 1,
        output_format: options.output_format || "jpeg",
        sync_mode: true,
        ...options,
      };

      const response = await makeFalApiRequest(
        "fal-ai/nano-banana/edit",
        input as unknown as Record<string, unknown>
      );

      if (!isFalApiResponse(response)) {
        throw new Error("Unexpected FAL response shape");
      }

      return parseImageUrls(response);
    } catch (error) {
      throw new Error(
        `Image editing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        { cause: error as unknown as Error }
      );
    }
  },

  /**
   * Generate multiple thumbnail variations for video projects
   * @param projectTitle Title of the video project
   * @param style Style preference (e.g., 'vibrant', 'minimalist', 'professional')
   * @param count Number of variations to generate (1-4)
   * @returns Promise resolving to thumbnail URLs
   */
  async generateThumbnails(
    projectTitle: string,
    style = "vibrant",
    count = 3
  ): Promise<string[]> {
    const prompt = `Create a ${style} YouTube thumbnail for "${projectTitle}"`;

    return FalAiService.generateImage(prompt, {
      num_images: Math.min(count, 4),
      output_format: "png",
    });
  },

  /**
   * Generate title card for video projects
   * @param title Main title text
   * @param subtitle Optional subtitle text
   * @param style Style preference
   * @returns Promise resolving to title card URL
   */
  async generateTitleCard(
    title: string,
    subtitle = "",
    style = "professional"
  ): Promise<string> {
    const subtitleText = subtitle ? ` with subtitle "${subtitle}"` : "";
    const prompt = `Create a ${style} title card with text "${title}"${subtitleText}`;

    const results = await FalAiService.generateImage(prompt, {
      num_images: 1,
      output_format: "png",
    });

    return results.at(0) ?? "";
  },

  /**
   * Check if fal.ai service is available and configured
   * @returns Promise resolving to boolean indicating availability
   */
  async isAvailable(): Promise<boolean> {
    const apiKey = await getFalApiKeyAsync();
    return !!apiKey;
  },
} as const;
