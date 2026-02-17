/**
 * Unified API Caller for Electron main process
 *
 * Supports FAL, ElevenLabs, Google/Gemini, and OpenRouter providers.
 * Replaces Python binary's HTTP calls with native Node.js fetch.
 *
 * @module electron/native-pipeline/api-caller
 */

import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { getDecryptedApiKeys } from "../api-key-handler.js";

export interface ApiCallOptions {
  endpoint: string;
  payload: Record<string, unknown>;
  provider: "fal" | "elevenlabs" | "google" | "openrouter";
  async?: boolean;
  onProgress?: (percent: number, message: string) => void;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

export interface ApiCallResult {
  success: boolean;
  data?: unknown;
  outputUrl?: string;
  error?: string;
  duration: number;
  cost?: number;
}

interface FalQueueResponse {
  request_id: string;
  status: string;
  response_url?: string;
}

interface FalStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  logs?: { message: string }[];
  response_url?: string;
}

const FAL_BASE = "https://queue.fal.run";
const FAL_STATUS_BASE = "https://queue.fal.run";
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_RETRIES = 2;
const POLL_INTERVAL_MS = 3000;

async function getApiKey(
  provider: ApiCallOptions["provider"]
): Promise<string> {
  const keys = await getDecryptedApiKeys();
  switch (provider) {
    case "fal":
      return (
        process.env.FAL_KEY || process.env.FAL_API_KEY || keys.falApiKey || ""
      );
    case "elevenlabs":
      return process.env.ELEVENLABS_API_KEY || "";
    case "google":
      return (
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_AI_API_KEY ||
        keys.geminiApiKey ||
        ""
      );
    case "openrouter":
      return process.env.OPENROUTER_API_KEY || keys.openRouterApiKey || "";
  }
}

function buildHeaders(
  provider: ApiCallOptions["provider"],
  apiKey: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  switch (provider) {
    case "fal":
      headers.Authorization = `Key ${apiKey}`;
      break;
    case "elevenlabs":
      headers["xi-api-key"] = apiKey;
      break;
    case "google":
      headers["x-goog-api-key"] = apiKey;
      break;
    case "openrouter":
      headers.Authorization = `Bearer ${apiKey}`;
      break;
  }
  return headers;
}

function buildUrl(
  provider: ApiCallOptions["provider"],
  endpoint: string
): string {
  switch (provider) {
    case "fal":
      return `${FAL_BASE}/${endpoint}`;
    case "elevenlabs":
      return `${ELEVENLABS_BASE}/${endpoint}`;
    case "google":
      return `${GEMINI_BASE}/${endpoint}`;
    case "openrouter":
      return `${OPENROUTER_BASE}/${endpoint}`;
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries: number
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || attempt === retries) {
        return response;
      }
      if (response.status >= 500) {
        lastError = new Error(
          `Server error ${response.status}: ${response.statusText}`
        );
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError ?? new Error("Fetch failed");
}

export async function pollQueueStatus(
  requestId: string,
  endpoint: string,
  options?: {
    onProgress?: (percent: number, message: string) => void;
    signal?: AbortSignal;
  }
): Promise<ApiCallResult> {
  const startTime = Date.now();
  const apiKey = await getApiKey("fal");
  const headers = buildHeaders("fal", apiKey);

  const statusUrl = `${FAL_STATUS_BASE}/${endpoint}/requests/${requestId}/status`;
  const resultUrl = `${FAL_STATUS_BASE}/${endpoint}/requests/${requestId}`;

  let lastPercent = 0;

  while (true) {
    if (options?.signal?.aborted) {
      return {
        success: false,
        error: "Cancelled",
        duration: (Date.now() - startTime) / 1000,
      };
    }

    const statusRes = await fetch(statusUrl, {
      headers,
      signal: options?.signal,
    });
    if (!statusRes.ok) {
      return {
        success: false,
        error: `Queue status check failed: ${statusRes.status}`,
        duration: (Date.now() - startTime) / 1000,
      };
    }

    const status = (await statusRes.json()) as FalStatusResponse;

    if (status.status === "COMPLETED") {
      const resultRes = await fetch(resultUrl, {
        headers,
        signal: options?.signal,
      });
      if (!resultRes.ok) {
        return {
          success: false,
          error: `Failed to fetch result: ${resultRes.status}`,
          duration: (Date.now() - startTime) / 1000,
        };
      }
      const data = await resultRes.json();
      return {
        success: true,
        data,
        outputUrl: extractOutputUrl(data),
        duration: (Date.now() - startTime) / 1000,
      };
    }

    if (status.status === "FAILED") {
      const errorMsg =
        status.logs?.map((l) => l.message).join("; ") || "Generation failed";
      return {
        success: false,
        error: errorMsg,
        duration: (Date.now() - startTime) / 1000,
      };
    }

    if (status.status === "IN_PROGRESS" && options?.onProgress) {
      lastPercent = Math.min(lastPercent + 5, 90);
      options.onProgress(lastPercent, `Processing... (${status.status})`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

function extractOutputUrl(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return;
  const obj = data as Record<string, unknown>;

  if (typeof obj.video === "object" && obj.video !== null) {
    const video = obj.video as Record<string, unknown>;
    if (typeof video.url === "string") return video.url;
  }
  if (typeof obj.image === "object" && obj.image !== null) {
    const image = obj.image as Record<string, unknown>;
    if (typeof image.url === "string") return image.url;
  }
  if (typeof obj.audio === "object" && obj.audio !== null) {
    const audio = obj.audio as Record<string, unknown>;
    if (typeof audio.url === "string") return audio.url;
  }
  if (Array.isArray(obj.images) && obj.images.length > 0) {
    const first = obj.images[0] as Record<string, unknown>;
    if (typeof first?.url === "string") return first.url;
  }
  if (Array.isArray(obj.videos) && obj.videos.length > 0) {
    const first = obj.videos[0] as Record<string, unknown>;
    if (typeof first?.url === "string") return first.url;
  }
  if (typeof obj.output_url === "string") return obj.output_url;
  if (typeof obj.url === "string") return obj.url;

  return;
}

export async function callModelApi(
  options: ApiCallOptions
): Promise<ApiCallResult> {
  const startTime = Date.now();
  const {
    endpoint,
    payload,
    provider,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    signal,
  } = options;

  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    return {
      success: false,
      error: `No API key configured for provider: ${provider}`,
      duration: 0,
    };
  }

  const headers = buildHeaders(provider, apiKey);
  const url = buildUrl(provider, endpoint);

  const controller = new AbortController();
  const combinedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (provider === "fal" && options.async !== false) {
      const queueRes = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: combinedSignal,
        },
        retries
      );

      if (!queueRes.ok) {
        const errorText = await queueRes.text();
        return {
          success: false,
          error: `FAL API error ${queueRes.status}: ${errorText}`,
          duration: (Date.now() - startTime) / 1000,
        };
      }

      const queueData = (await queueRes.json()) as FalQueueResponse;

      if (queueData.request_id) {
        return pollQueueStatus(queueData.request_id, endpoint, {
          onProgress: options.onProgress,
          signal: combinedSignal,
        });
      }

      return {
        success: true,
        data: queueData,
        outputUrl: extractOutputUrl(queueData),
        duration: (Date.now() - startTime) / 1000,
      };
    }

    const response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: combinedSignal,
      },
      retries
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `API error ${response.status}: ${errorText}`,
        duration: (Date.now() - startTime) / 1000,
      };
    }

    const data = await response.json();
    return {
      success: true,
      data,
      outputUrl: extractOutputUrl(data),
      duration: (Date.now() - startTime) / 1000,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: msg.includes("aborted") ? "Cancelled" : msg,
      duration: (Date.now() - startTime) / 1000,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadOutput(
  url: string,
  outputPath: string
): Promise<string> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`
    );
  }

  if (!response.body) {
    throw new Error("No response body for download");
  }

  const fileStream = fs.createWriteStream(outputPath);
  await pipeline(Readable.fromWeb(response.body as never), fileStream);
  return outputPath;
}
