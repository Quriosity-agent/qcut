/**
 * Split from model-handler-implementations.ts by handler category.
 */

import { falAIClient } from "@/lib/fal-ai-client";
import { upscaleByteDanceVideo, upscaleFlashVSRVideo } from "@/lib/ai-video";
import type {
  ModelHandlerContext,
  ModelHandlerResult,
  UpscaleSettings,
} from "../model-handler-types";

// These aliases map UI values to generator literal unions.
type ByteDanceResolution = "1080p" | "2k" | "4k";
type ByteDanceFPS = "30fps" | "60fps";
type FlashVSRAcceleration = "regular" | "high" | "full";
type FlashVSROutputFormat = "X264" | "VP9" | "PRORES4444" | "GIF";
type FlashVSROutputQuality = "low" | "medium" | "high" | "maximum";
type FlashVSRWriteMode = "fast" | "balanced" | "small";



