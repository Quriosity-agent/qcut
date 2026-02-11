/**
 * Split from model-handler-implementations.ts by handler category.
 */

import { falAIClient } from "@/lib/fal-ai-client";
import {
  generateVideo,
  generateVideoFromImage,
  generateViduQ2Video,
  generateLTXV2ImageVideo,
  generateSeedanceVideo,
  generateKlingImageVideo,
  generateKling26ImageVideo,
  generateWAN25ImageVideo,
  generateWAN26ImageVideo,
  generateViduQ3ImageVideo,
} from "@/lib/ai-video";
import type {
  ImageToVideoSettings,
  ModelHandlerContext,
  ModelHandlerResult,
} from "../model-handler-types";

// These aliases map UI values to generator literal unions.
type ViduQ2Duration = 2 | 3 | 4 | 5 | 6 | 7 | 8;
type ViduQ2Resolution = "720p" | "1080p";
type ViduQ2MovementAmplitude = "auto" | "small" | "medium" | "large";
type LTXV2Duration = 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
type LTXV2Resolution = "1080p" | "1440p" | "2160p";
type LTXV2FPS = 25 | 50;
type SeedanceDuration = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
type SeedanceResolution = "480p" | "720p" | "1080p";
type SeedanceAspectRatio =
  | "16:9"
  | "9:16"
  | "1:1"
  | "4:3"
  | "3:4"
  | "21:9"
  | "auto";
type KlingDuration = 5 | 10;
type KlingAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
type WAN25Duration = 5 | 10;
type WAN25Resolution = "480p" | "720p" | "1080p";
type WAN26Duration = 5 | 10 | 15;
type WAN26Resolution = "720p" | "1080p";
type WAN26AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
type ViduQ3Duration = 5;
type ViduQ3Resolution = "360p" | "540p" | "720p" | "1080p";



