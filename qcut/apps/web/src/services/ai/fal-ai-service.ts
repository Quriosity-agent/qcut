import { fal } from "@fal-ai/client";
import type { FalAiImageResult, FalAiTextToImageInput, FalAiImageEditInput } from "../../types/nano-edit";

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
      const input: FalAiTextToImageInput = {
        prompt,
        num_images: 1,
        output_format: 'jpeg',
        sync_mode: true,
        ...options,
      };

      const result = await fal.subscribe("fal-ai/nano-banana", {
        input,
      }) as FalAiImageResult;

      return result.images?.map(img => img.url) || [];
    } catch (error) {
      console.error('Failed to generate image:', error);
      throw new Error(`Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    try {
      if (imageUrls.length === 0) {
        throw new Error('At least one image URL is required for editing');
      }

      if (imageUrls.length > 10) {
        throw new Error('Maximum 10 images can be processed at once');
      }

      const input: FalAiImageEditInput = {
        prompt,
        image_urls: imageUrls,
        num_images: 1,
        output_format: 'jpeg',
        sync_mode: true,
        ...options,
      };

      const result = await fal.subscribe("fal-ai/nano-banana/edit", {
        input,
      }) as FalAiImageResult;

      return result.images?.map(img => img.url) || [];
    } catch (error) {
      console.error('Failed to edit images:', error);
      throw new Error(`Image editing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    style: string = 'vibrant',
    count: number = 3
  ): Promise<string[]> {
    const prompt = `Create a ${style} YouTube thumbnail for "${projectTitle}"`;
    
    return this.generateImage(prompt, {
      num_images: Math.min(count, 4),
      output_format: 'png',
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
    subtitle: string = '',
    style: string = 'professional'
  ): Promise<string> {
    const subtitleText = subtitle ? ` with subtitle "${subtitle}"` : '';
    const prompt = `Create a ${style} title card with text "${title}"${subtitleText}`;
    
    const results = await this.generateImage(prompt, {
      num_images: 1,
      output_format: 'png',
    });

    return results[0] || '';
  }

  /**
   * Check if fal.ai service is available and configured
   * @returns Promise resolving to boolean indicating availability
   */
  static async isAvailable(): Promise<boolean> {
    try {
      // Simple connectivity check - could be expanded with actual API ping
      return typeof fal !== 'undefined';
    } catch {
      return false;
    }
  }
}