/**
 * FAL.ai Model Parameter Handlers
 *
 * Central export point for all model-specific parameter conversion utilities.
 * Each handler sanitizes and validates parameters for its respective model family.
 */

export { convertV3Parameters } from "./v3-params";
export { convertV4Parameters, V4_VALID_IMAGE_PRESETS } from "./v4-params";
export { convertNanoBananaParameters } from "./nano-banana-params";
export { convertFluxParameters } from "./flux-params";

/**
 * Model version types for routing.
 */
export type ModelVersion = "v3" | "v4" | "nano-banana" | "flux";

/**
 * Detects the model version based on model ID.
 * Used for routing to the appropriate parameter converter.
 *
 * @param modelId - Model identifier string
 * @returns Model version type
 *
 * @example
 * detectModelVersion("seeddream-v4")  // "v4"
 * detectModelVersion("nano-banana")   // "nano-banana"
 * detectModelVersion("flux-kontext")  // "flux"
 * detectModelVersion("seededit")      // "v3" (default)
 */
export function detectModelVersion(modelId: string): ModelVersion {
  if (modelId === "seeddream-v4") return "v4";
  if (modelId === "nano-banana") return "nano-banana";
  if (modelId.includes("flux")) return "flux";
  return "v3"; // default to V3 for backward compatibility
}

/**
 * Converts parameters for a model based on its detected version.
 *
 * @param modelId - Model identifier string
 * @param params - Raw parameters from the user
 * @returns Sanitized parameters for the appropriate API
 *
 * @example
 * const params = convertParametersForModel("seeddream-v4", {
 *   prompt: "A sunset",
 *   image_urls: ["https://..."]
 * });
 */
export function convertParametersForModel(
  modelId: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  const version = detectModelVersion(modelId);

  // Import and call the appropriate converter
  // Using dynamic requires would be cleaner but we keep it explicit for tree-shaking
  switch (version) {
    case "v4": {
      const { convertV4Parameters } = require("./v4-params");
      return convertV4Parameters(params);
    }
    case "nano-banana": {
      const { convertNanoBananaParameters } = require("./nano-banana-params");
      return convertNanoBananaParameters(params);
    }
    case "flux": {
      const { convertFluxParameters } = require("./flux-params");
      return convertFluxParameters(params);
    }
    case "v3":
    default: {
      const { convertV3Parameters } = require("./v3-params");
      return convertV3Parameters(params);
    }
  }
}
