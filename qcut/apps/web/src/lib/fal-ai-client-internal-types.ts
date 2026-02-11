import type { OutputFormat } from "./ai-video/validation/validators";

export interface FalAIClientRequestDelegate {
  makeRequest<T>(
    endpoint: string,
    params: Record<string, unknown>
  ): Promise<T>;
}

export interface GenerationResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
  metadata?: {
    seed?: number;
    timings?: Record<string, number>;
    dimensions?: { width: number; height: number };
  };
}

export interface GenerationSettings {
  imageSize: string | number;
  seed?: number;
  outputFormat?: OutputFormat;
}

export type MultiModelGenerationResult = Record<string, GenerationResult>;
