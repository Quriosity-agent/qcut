/**
 * Split from model-handler-implementations.ts by handler category.
 */

import { falAIClient } from "@/lib/fal-ai-client";
import {
  generateVideo,
  generateVideoFromText,
  generateLTXV2Video,
  generateViduQ3TextVideo,
  generateWAN26TextVideo,
} from "@/lib/ai-video";
import type {
  ModelHandlerContext,
  ModelHandlerResult,
  TextToVideoSettings,
} from "../model-handler-types";

// These aliases map UI values to generator literal unions.
type LTXV2Duration = 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
type LTXV2Resolution = "1080p" | "1440p" | "2160p";
type LTXV2FPS = 25 | 50;
type HailuoDuration = 6 | 10;
type ViduQ3Duration = 5;
type ViduQ3Resolution = "360p" | "540p" | "720p" | "1080p";
type ViduQ3AspectRatio = "16:9" | "9:16" | "4:3" | "3:4" | "1:1";
type WAN26Duration = 5 | 10 | 15;
type WAN26T2VResolution = "720p" | "1080p";
type WAN26AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";



