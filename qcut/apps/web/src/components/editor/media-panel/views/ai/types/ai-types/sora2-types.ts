/**
 * Sora 2 Types
 */

/**
 * Sora 2 model type variants
 */
export type Sora2ModelType =
	| "text-to-video"
	| "text-to-video-pro"
	| "image-to-video"
	| "image-to-video-pro"
	| "video-to-video-remix";

/**
 * Base payload type for all Sora 2 models
 */
export type Sora2BasePayload = {
	prompt: string;
	duration: number;
	aspect_ratio: string;
};

/**
 * Discriminated union for Sora 2 payloads
 * Uses intersection with Sora2BasePayload to reduce duplication
 */
export type Sora2Payload =
	| (Sora2BasePayload & {
			type: "text-to-video";
			resolution: "720p";
	  })
	| (Sora2BasePayload & {
			type: "text-to-video-pro";
			resolution: string;
	  })
	| (Sora2BasePayload & {
			type: "image-to-video";
			resolution: string;
			image_url: string;
	  })
	| (Sora2BasePayload & {
			type: "image-to-video-pro";
			resolution: string;
			image_url: string;
	  })
	| { type: "video-to-video-remix"; prompt: string; video_id: string };
