/**
 * AI Video Generation Client
 *
 * REFACTORED: This file now re-exports from the modular ai-video/ structure.
 * The implementation has been split into focused modules for better maintainability:
 *
 * - ai-video/core/       - FAL API request utilities, polling, streaming
 * - ai-video/generators/ - Video generation functions by category
 * - ai-video/models/     - Model-specific utilities (Sora2, etc.)
 * - ai-video/validation/ - Input validation functions
 * - ai-video/api.ts      - High-level API utilities
 *
 * For new imports, prefer importing directly from "@/lib/ai-video" or specific submodules.
 * This file maintains backward compatibility with existing consumers.
 */

// Re-export everything from the modular structure
export * from "../ai-video";

// Re-export types from ai-types.ts for backward compatibility
// Types were previously defined in this file but are now centralized
export type {
	VideoGenerationRequest,
	VideoGenerationResponse,
	ImageToVideoRequest,
	TextToVideoRequest,
	ViduQ2I2VRequest,
	LTXV2T2VRequest,
	LTXV2I2VRequest,
	SeedanceI2VRequest,
	KlingI2VRequest,
	Kling26I2VRequest,
	KlingO1V2VRequest,
	KlingO1Ref2VideoRequest,
	WAN25I2VRequest,
	AvatarVideoRequest,
	ByteDanceUpscaleRequest,
	FlashVSRUpscaleRequest,
	TopazUpscaleRequest,
	GenerationStatus,
	ModelsResponse,
	CostEstimate,
	ProgressCallback,
	ProgressUpdate,
	Seeddream45ImageSize,
	Sora2ModelType,
	Sora2Payload,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
