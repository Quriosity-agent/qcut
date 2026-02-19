/**
 * Video Generator Adapter for ViMax agents.
 *
 * Wraps FAL video generators (Kling, Veo, Hailuo, etc.) to provide
 * a consistent interface for ViMax agents. Falls back to mock generation
 * when API key is not configured.
 *
 * Ported from: vimax/adapters/video_adapter.py
 */

import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  BaseAdapter,
  type AdapterConfig,
  createAdapterConfig,
} from "./base-adapter.js";
import { callModelApi, downloadOutput } from "../../api-caller.js";
import type { VideoOutput, ImageOutput } from "../types/output.js";
import { createVideoOutput } from "../types/output.js";

const execFileAsync = promisify(execFile);

export interface VideoAdapterConfig extends AdapterConfig {
  duration: number;
  fps: number;
  output_dir: string;
}

export function createVideoAdapterConfig(
  partial?: Partial<VideoAdapterConfig>
): VideoAdapterConfig {
  return {
    ...createAdapterConfig({ provider: "fal", model: "kling" }),
    duration: 5.0,
    fps: 24,
    output_dir: "media/generated/vimax/videos",
    ...partial,
  };
}

/** Model → FAL endpoint for image-to-video. */
const MODEL_MAP: Record<string, string> = {
  kling: "fal-ai/kling-video/v1/standard/image-to-video",
  kling_2_1: "fal-ai/kling-video/v2.1/standard/image-to-video",
  kling_2_6_pro: "fal-ai/kling-video/v2.6/pro/image-to-video",
  veo3: "google/veo-3",
  veo3_fast: "google/veo-3-fast",
  hailuo: "fal-ai/hailuo/image-to-video",
  grok_imagine: "fal-ai/grok/imagine",
};

/** Cost estimates per second of video. */
const COST_PER_SECOND: Record<string, number> = {
  kling: 0.03,
  kling_2_1: 0.03,
  kling_2_6_pro: 0.06,
  veo3: 0.1,
  veo3_fast: 0.06,
  hailuo: 0.02,
  grok_imagine: 0.05,
};

export class VideoGeneratorAdapter extends BaseAdapter<
  Record<string, unknown>,
  VideoOutput
> {
  declare config: VideoAdapterConfig;
  private _hasApiKey = false;

  constructor(config?: Partial<VideoAdapterConfig>) {
    super(createVideoAdapterConfig(config));
  }

  /** Returns list of supported video model keys. */
  static getAvailableModels(): string[] {
    return Object.keys(MODEL_MAP);
  }

  async initialize(): Promise<boolean> {
    const apiKey = process.env.FAL_KEY ?? process.env.FAL_API_KEY ?? "";
    this._hasApiKey = apiKey.length > 0;
    if (!this._hasApiKey) {
      console.warn("[vimax.video] FAL_KEY not set — using mock mode");
    }
    return true;
  }

  async execute(input: Record<string, unknown>): Promise<VideoOutput> {
    return this.generate(
      input.image_path as string,
      input.prompt as string,
      input
    );
  }

  /** Generate video from image and prompt via FAL. */
  async generate(
    imagePath: string,
    prompt: string,
    options?: {
      model?: string;
      duration?: number;
      output_path?: string;
    }
  ): Promise<VideoOutput> {
    await this.ensureInitialized();

    const model = options?.model ?? this.config.model;
    const duration = options?.duration ?? this.config.duration;

    if (!this._hasApiKey) {
      return this._mockGenerate(
        imagePath,
        prompt,
        model,
        duration,
        options?.output_path
      );
    }

    const startTime = Date.now();
    const endpoint = MODEL_MAP[model] ?? MODEL_MAP.kling;

    const payload: Record<string, unknown> = {
      prompt,
      image_url: imagePath,
      duration: String(Math.round(duration)),
    };

    const result = await callModelApi({
      endpoint,
      payload,
      provider: "fal",
    });

    const generationTime = (Date.now() - startTime) / 1000;

    if (!result.success) {
      throw new Error(`Video generation failed: ${result.error}`);
    }

    const videoPath = options?.output_path ?? this._defaultOutputPath(model);
    this._ensureDir(videoPath);

    if (result.outputUrl) {
      await downloadOutput(result.outputUrl, videoPath);
    }

    return createVideoOutput({
      video_path: videoPath,
      video_url: result.outputUrl,
      source_image: imagePath,
      prompt,
      model,
      duration,
      width: 1280,
      height: 720,
      fps: this.config.fps,
      generation_time: generationTime,
      cost: (COST_PER_SECOND[model] ?? 0.03) * duration,
    });
  }

  /** Generate videos from multiple images. */
  async generateFromImages(
    images: Array<ImageOutput | string>,
    prompts: string[],
    options?: { model?: string }
  ): Promise<VideoOutput[]> {
    if (images.length !== prompts.length) {
      throw new Error("Number of images must match number of prompts");
    }

    const results: VideoOutput[] = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const imagePath = typeof img === "string" ? img : img.image_path;
      const result = await this.generate(imagePath, prompts[i], {
        model: options?.model,
      });
      results.push(result);
    }
    return results;
  }

  /** Concatenate multiple videos into one using FFmpeg. */
  async concatenateVideos(
    videos: VideoOutput[],
    outputPath: string
  ): Promise<VideoOutput> {
    this._ensureDir(outputPath);

    const concatFile = path.join(path.dirname(outputPath), "concat_list.txt");
    const concatContent = videos
      .map((v) => `file '${v.video_path.replace(/\\/g, "/")}'`)
      .join("\n");
    fs.writeFileSync(concatFile, concatContent);

    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatFile,
        "-c",
        "copy",
        outputPath,
      ]);
    } catch (err) {
      console.warn(
        `[vimax.video] FFmpeg concat may have failed: ${err instanceof Error ? err.message : err}`
      );
      // Create placeholder if ffmpeg failed
      fs.writeFileSync(outputPath, "Concatenated video placeholder");
    } finally {
      if (fs.existsSync(concatFile)) {
        fs.unlinkSync(concatFile);
      }
    }

    const totalDuration = videos.reduce((sum, v) => sum + v.duration, 0);
    const totalCost = videos.reduce((sum, v) => sum + v.cost, 0);

    return createVideoOutput({
      video_path: outputPath,
      duration: totalDuration,
      cost: totalCost,
      metadata: { source_videos: videos.map((v) => v.video_path) },
    });
  }

  // -- Private helpers --

  private _defaultOutputPath(prefix: string): string {
    return path.join(this.config.output_dir, `${prefix}_${Date.now()}.mp4`);
  }

  private _ensureDir(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private _mockGenerate(
    imagePath: string,
    prompt: string,
    model: string,
    duration: number,
    outputPath?: string
  ): VideoOutput {
    const videoPath = outputPath ?? this._defaultOutputPath(`mock_${model}`);
    this._ensureDir(videoPath);
    fs.writeFileSync(videoPath, `Mock video: ${prompt}`);

    return createVideoOutput({
      video_path: videoPath,
      source_image: imagePath,
      prompt,
      model,
      duration,
      width: 1280,
      height: 720,
      fps: 24,
      generation_time: 0.1,
      cost: 0,
      metadata: { mock: true },
    });
  }
}
