/**
 * Text-to-Video Model Configuration
 * Defines which parameters each model supports to drive unified controls.
 */

export type T2VModelId =
  | "sora2_text_to_video"
  | "sora2_text_to_video_pro"
  | "wan_25_preview"
  | "ltxv2_pro_t2v"
  | "ltxv2_fast_t2v"
  | "veo31_fast"
  | "veo31"
  | "hailuo_v2"
  | "seedance_t2v"
  | "kling1_6_pro"
  | "kling1_6_standard";

export interface T2VModelCapabilities {
  supportsAspectRatio: boolean;
  supportedAspectRatios?: string[];
  supportsResolution: boolean;
  supportedResolutions?: string[];
  supportsDuration: boolean;
  supportedDurations?: number[];
  supportsNegativePrompt: boolean;
  supportsPromptExpansion: boolean;
  supportsSeed: boolean;
  supportsSafetyChecker: boolean;
  defaultAspectRatio?: string;
  defaultResolution?: string;
  defaultDuration?: number;
}

export const T2V_MODEL_CAPABILITIES: Record<T2VModelId, T2VModelCapabilities> = {
  sora2_text_to_video: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [4, 8, 12],
    supportsNegativePrompt: true,
    supportsPromptExpansion: true,
    supportsSeed: true,
    supportsSafetyChecker: true,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 4,
  },

  sora2_text_to_video_pro: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [2, 3, 4, 5, 6, 8, 10],
    supportsNegativePrompt: true,
    supportsPromptExpansion: true,
    supportsSeed: true,
    supportsSafetyChecker: true,
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    defaultDuration: 5,
  },

  wan_25_preview: {
    supportsAspectRatio: false,
    supportsResolution: true,
    supportedResolutions: ["480p", "720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [5, 10],
    supportsNegativePrompt: false,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: true,
    defaultResolution: "1080p",
    defaultDuration: 5,
  },

  ltxv2_pro_t2v: {
    supportsAspectRatio: false,
    supportsResolution: true,
    supportedResolutions: ["1080p", "1440p", "2160p"],
    supportsDuration: true,
    supportedDurations: [2, 3, 4, 5, 6, 8, 10],
    supportsNegativePrompt: true,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultResolution: "1080p",
    defaultDuration: 6,
  },

  ltxv2_fast_t2v: {
    supportsAspectRatio: false,
    supportsResolution: true,
    supportedResolutions: ["1080p", "1440p", "2160p"],
    supportsDuration: true,
    supportedDurations: [2, 3, 4, 5, 6, 8, 10],
    supportsNegativePrompt: false,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultResolution: "1080p",
    defaultDuration: 6,
  },

  veo31_fast: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [4, 5, 6, 8],
    supportsNegativePrompt: true,
    supportsPromptExpansion: true,
    supportsSeed: true,
    supportsSafetyChecker: true,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 8,
  },

  veo31: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [4, 5, 6, 8],
    supportsNegativePrompt: true,
    supportsPromptExpansion: true,
    supportsSeed: true,
    supportsSafetyChecker: true,
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    defaultDuration: 8,
  },

  hailuo_v2: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [2, 3, 4, 5],
    supportsNegativePrompt: false,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
  },

  seedance_t2v: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    supportsResolution: true,
    supportedResolutions: ["480p", "720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    supportsNegativePrompt: false,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
  },

  kling1_6_pro: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [5, 10],
    supportsNegativePrompt: true,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    defaultDuration: 5,
  },

  kling1_6_standard: {
    supportsAspectRatio: true,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    supportsResolution: true,
    supportedResolutions: ["720p", "1080p"],
    supportsDuration: true,
    supportedDurations: [5, 10],
    supportsNegativePrompt: false,
    supportsPromptExpansion: false,
    supportsSeed: true,
    supportsSafetyChecker: false,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: 5,
  },
};

/**
 * Get combined (intersected) capabilities for selected models.
 */
export function getCombinedCapabilities(
  selectedModelIds: T2VModelId[]
): T2VModelCapabilities {
  if (selectedModelIds.length === 0) {
    return {
      supportsAspectRatio: false,
      supportsResolution: false,
      supportsDuration: false,
      supportsNegativePrompt: false,
      supportsPromptExpansion: false,
      supportsSeed: false,
      supportsSafetyChecker: false,
    };
  }

  const capabilities = selectedModelIds.map(
    (id) => T2V_MODEL_CAPABILITIES[id]
  );

  return {
    supportsAspectRatio: capabilities.every((c) => c.supportsAspectRatio),
    supportedAspectRatios: getCommonAspectRatios(capabilities),
    supportsResolution: capabilities.every((c) => c.supportsResolution),
    supportedResolutions: getCommonResolutions(capabilities),
    supportsDuration: capabilities.every((c) => c.supportsDuration),
    supportedDurations: getCommonDurations(capabilities),
    supportsNegativePrompt: capabilities.every((c) => c.supportsNegativePrompt),
    supportsPromptExpansion: capabilities.every((c) => c.supportsPromptExpansion),
    supportsSeed: capabilities.every((c) => c.supportsSeed),
    supportsSafetyChecker: capabilities.every((c) => c.supportsSafetyChecker),
  };
}

function getCommonAspectRatios(
  capabilities: T2VModelCapabilities[]
): string[] | undefined {
  const allRatios = capabilities
    .filter((c) => c.supportsAspectRatio && c.supportedAspectRatios)
    .map((c) => c.supportedAspectRatios!);

  if (allRatios.length === 0) return undefined;
  if (allRatios.length === 1) return allRatios[0];

  return allRatios.reduce((common, ratios) =>
    common.filter((r) => ratios.includes(r))
  );
}

function getCommonResolutions(
  capabilities: T2VModelCapabilities[]
): string[] | undefined {
  const allResolutions = capabilities
    .filter((c) => c.supportsResolution && c.supportedResolutions)
    .map((c) => c.supportedResolutions!);

  if (allResolutions.length === 0) return undefined;
  if (allResolutions.length === 1) return allResolutions[0];

  return allResolutions.reduce((common, resolutions) =>
    common.filter((r) => resolutions.includes(r))
  );
}

function getCommonDurations(
  capabilities: T2VModelCapabilities[]
): number[] | undefined {
  const allDurations = capabilities
    .filter((c) => c.supportsDuration && c.supportedDurations)
    .map((c) => c.supportedDurations!);

  if (allDurations.length === 0) return undefined;
  if (allDurations.length === 1) return allDurations[0];

  return allDurations.reduce((common, durations) =>
    common.filter((d) => durations.includes(d))
  );
}
