/**
 * Text-to-Video Helper Functions
 */

import type { AIModel } from "../../types/ai-types";
import { T2V_MODELS, type T2VModelId } from "./models";
import { T2V_MODEL_ORDER, T2V_MODEL_ID_ALIASES } from "./order";
import {
	T2V_MODEL_CAPABILITIES,
	type T2VModelCapabilities,
} from "./capabilities";

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

	const capabilities = selectedModelIds.map((id) => T2V_MODEL_CAPABILITIES[id]);

	return {
		supportsAspectRatio: capabilities.every((c) => c.supportsAspectRatio),
		supportedAspectRatios: getCommonAspectRatios(capabilities),
		supportsResolution: capabilities.every((c) => c.supportsResolution),
		supportedResolutions: getCommonResolutions(capabilities),
		supportsDuration: capabilities.every((c) => c.supportsDuration),
		supportedDurations: getCommonDurations(capabilities),
		supportsNegativePrompt: capabilities.every((c) => c.supportsNegativePrompt),
		supportsPromptExpansion: capabilities.every(
			(c) => c.supportsPromptExpansion
		),
		supportsSeed: capabilities.every((c) => c.supportsSeed),
		supportsSafetyChecker: capabilities.every((c) => c.supportsSafetyChecker),
	};
}

/**
 * Finds the intersection of supported aspect ratios across multiple models.
 */
function getCommonAspectRatios(
	capabilities: T2VModelCapabilities[]
): string[] | undefined {
	const allRatios = capabilities
		.filter((c) => c.supportsAspectRatio && c.supportedAspectRatios)
		.map((c) => c.supportedAspectRatios!);

	if (allRatios.length === 0) return;
	if (allRatios.length === 1) return allRatios[0];

	return allRatios.reduce((common, ratios) =>
		common.filter((r) => ratios.includes(r))
	);
}

/**
 * Finds the intersection of supported resolutions across multiple models.
 */
function getCommonResolutions(
	capabilities: T2VModelCapabilities[]
): string[] | undefined {
	const allResolutions = capabilities
		.filter((c) => c.supportsResolution && c.supportedResolutions)
		.map((c) => c.supportedResolutions!);

	if (allResolutions.length === 0) return;
	if (allResolutions.length === 1) return allResolutions[0];

	return allResolutions.reduce((common, resolutions) =>
		common.filter((r) => resolutions.includes(r))
	);
}

/**
 * Finds the intersection of supported durations across multiple models.
 */
function getCommonDurations(
	capabilities: T2VModelCapabilities[]
): number[] | undefined {
	const allDurations = capabilities
		.filter((c) => c.supportsDuration && c.supportedDurations)
		.map((c) => c.supportedDurations!);

	if (allDurations.length === 0) return;
	if (allDurations.length === 1) return allDurations[0];

	return allDurations.reduce((common, durations) =>
		common.filter((d) => durations.includes(d))
	);
}

/**
 * Get T2V models in priority order for UI rendering.
 */
export function getT2VModelsInOrder(): Array<[T2VModelId, AIModel]> {
	return T2V_MODEL_ORDER.map((id) => [id, T2V_MODELS[id]]);
}

/**
 * Normalize an AI model id to the canonical T2VModelId used by capability lookups.
 */
export function resolveT2VModelId(modelId: string): T2VModelId | undefined {
	if (modelId in T2V_MODEL_CAPABILITIES) {
		return modelId as T2VModelId;
	}

	return T2V_MODEL_ID_ALIASES[modelId];
}
