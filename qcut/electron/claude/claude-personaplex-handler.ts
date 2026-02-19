/**
 * Claude PersonaPlex Proxy Handler
 * Proxies speech-to-speech requests to fal-ai/personaplex API.
 */

import { claudeLog } from "./utils/logger.js";
import { HttpError } from "./utils/http-router.js";
import { getDecryptedApiKeys } from "../api-key-handler.js";

const HANDLER_NAME = "PersonaPlex";

/**
 * Generate speech via PersonaPlex (fal-ai speech-to-speech).
 */
export async function generatePersonaPlex(
  body: Record<string, unknown>
): Promise<unknown> {
  if (!body?.audio_url) {
    throw new HttpError(400, "Missing 'audio_url' in request body");
  }

  const keys = await getDecryptedApiKeys();
  const apiKey = keys.falApiKey;
  if (!apiKey) {
    throw new HttpError(
      400,
      "FAL API key not configured. Go to Settings → API Keys to set it."
    );
  }

  const requestBody: Record<string, unknown> = {
    audio_url: body.audio_url,
  };
  if (body.prompt) requestBody.prompt = body.prompt;
  if (body.voice) requestBody.voice = body.voice;
  if (body.temperature_audio != null)
    requestBody.temperature_audio = body.temperature_audio;
  if (body.temperature_text != null)
    requestBody.temperature_text = body.temperature_text;
  if (body.top_k_audio != null) requestBody.top_k_audio = body.top_k_audio;
  if (body.top_k_text != null) requestBody.top_k_text = body.top_k_text;
  if (body.seed != null) requestBody.seed = body.seed;
  if (body.output_format) requestBody.output_format = body.output_format;

  claudeLog.info(HANDLER_NAME, "PersonaPlex generate request");

  try {
    const falResponse = await fetch("https://fal.run/fal-ai/personaplex", {
      signal: AbortSignal.timeout(25_000),
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      claudeLog.error(
        HANDLER_NAME,
        `PersonaPlex API error: ${falResponse.status} ${errorText}`
      );
      throw new HttpError(
        falResponse.status,
        `PersonaPlex API error: ${errorText}`
      );
    }

    let result: unknown;
    try {
      result = await falResponse.json();
    } catch {
      throw new HttpError(502, "PersonaPlex API returned invalid JSON");
    }

    claudeLog.info(HANDLER_NAME, "PersonaPlex generate complete");
    return result;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    const errorMessage =
      error instanceof Error ? error.message : "PersonaPlex request failed";
    claudeLog.error(
      HANDLER_NAME,
      `PersonaPlex request failed: ${errorMessage}`
    );
    throw new HttpError(502, `PersonaPlex request failed: ${errorMessage}`);
  }
}

// CommonJS export for compatibility
module.exports = { generatePersonaPlex };
