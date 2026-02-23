/**
 * Text-to-speech model definitions
 * @module electron/native-pipeline/registry-data/tts
 */

import { ModelRegistry } from "../infra/registry.js";

export function registerTTSModels(): void {
	ModelRegistry.register({
		key: "elevenlabs",
		name: "ElevenLabs TTS",
		provider: "ElevenLabs",
		endpoint: "elevenlabs/tts",
		categories: ["text_to_speech"],
		description: "High quality text-to-speech",
		pricing: { per_character: 0.000_03 },
		defaults: {},
		features: ["high_quality", "professional"],
		costEstimate: 0.05,
		processingTime: 15,
	});

	ModelRegistry.register({
		key: "elevenlabs_turbo",
		name: "ElevenLabs Turbo",
		provider: "ElevenLabs",
		endpoint: "elevenlabs/tts/turbo",
		categories: ["text_to_speech"],
		description: "Fast text-to-speech",
		pricing: { per_character: 0.000_02 },
		defaults: {},
		features: ["fast_processing"],
		costEstimate: 0.03,
		processingTime: 8,
	});

	ModelRegistry.register({
		key: "elevenlabs_v3",
		name: "ElevenLabs v3",
		provider: "ElevenLabs",
		endpoint: "elevenlabs/tts/v3",
		categories: ["text_to_speech"],
		description: "Latest ElevenLabs text-to-speech model",
		pricing: { per_character: 0.000_05 },
		defaults: {},
		features: ["latest_generation", "high_quality"],
		costEstimate: 0.08,
		processingTime: 20,
	});
}
