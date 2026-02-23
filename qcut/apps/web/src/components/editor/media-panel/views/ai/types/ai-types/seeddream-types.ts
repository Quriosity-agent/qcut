/**
 * Seeddream 4.5 Types
 */

/**
 * Seedream 4.5 image size options
 * Supports both preset strings and custom dimensions
 */
export type Seeddream45ImageSize =
	| "square_hd"
	| "square"
	| "portrait_4_3"
	| "portrait_16_9"
	| "landscape_4_3"
	| "landscape_16_9"
	| "auto_2K"
	| "auto_4K"
	| { width: number; height: number };

/**
 * Parameters for Seedream 4.5 text-to-image generation
 */
export interface Seeddream45TextToImageParams {
	prompt: string;
	image_size?: Seeddream45ImageSize;
	num_images?: number;
	max_images?: number;
	seed?: number;
	sync_mode?: boolean;
	enable_safety_checker?: boolean;
}

/**
 * Parameters for Seedream 4.5 image editing
 */
export interface Seeddream45EditParams {
	prompt: string;
	image_urls: string[];
	image_size?: Seeddream45ImageSize;
	num_images?: number;
	max_images?: number;
	seed?: number;
	sync_mode?: boolean;
	enable_safety_checker?: boolean;
}
