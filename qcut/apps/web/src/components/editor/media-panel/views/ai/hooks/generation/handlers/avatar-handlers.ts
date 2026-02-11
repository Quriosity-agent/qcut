/**
 * Split from model-handler-implementations.ts by handler category.
 */

import { falAIClient } from "@/lib/fal-ai-client";
import { debugLogger } from "@/lib/debug-logger";
import {
  generateAvatarVideo,
  generateKlingO1Video,
  generateWAN26RefVideo,
} from "@/lib/ai-video";
import type {
  AvatarSettings,
  ModelHandlerContext,
  ModelHandlerResult,
} from "../model-handler-types";



