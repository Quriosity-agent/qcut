/**
 * Model definitions for the native registry (Part 2)
 *
 * Categories: avatar, video_to_video, add_audio, upscale_video,
 * text_to_image, text_to_speech, image_understanding, prompt_generation, speech_to_text
 *
 * @module electron/native-pipeline/registry-data-2
 */

import { ModelRegistry } from "./registry.js";

export function registerAvatarModels(): void {
  ModelRegistry.register({
    key: "omnihuman_v1_5",
    name: "OmniHuman v1.5 (ByteDance)",
    provider: "ByteDance",
    endpoint: "fal-ai/bytedance/omnihuman/v1.5",
    categories: ["avatar"],
    description: "High-quality audio-driven human animation",
    pricing: { per_second: 0.16 },
    resolutions: ["720p", "1080p"],
    defaults: { resolution: "1080p", turbo_mode: false },
    features: ["audio_driven", "high_quality"],
    maxDuration: 30,
    inputRequirements: {
      required: ["image_url", "audio_url"],
      optional: ["prompt", "turbo_mode", "resolution"],
    },
    modelInfo: { max_durations: { "1080p": 30, "720p": 60 } },
    costEstimate: 0.8,
    processingTime: 60,
  });

  ModelRegistry.register({
    key: "fabric_1_0",
    name: "VEED Fabric 1.0",
    provider: "VEED",
    endpoint: "veed/fabric-1.0",
    categories: ["avatar"],
    description: "Cost-effective lip-sync avatar generation",
    pricing: { "480p": 0.08, "720p": 0.15 },
    resolutions: ["480p", "720p"],
    defaults: { resolution: "720p" },
    features: ["lipsync", "cost_effective"],
    maxDuration: 120,
    inputRequirements: {
      required: ["image_url", "audio_url", "resolution"],
      optional: [],
    },
    costEstimate: 0.75,
    processingTime: 45,
  });

  ModelRegistry.register({
    key: "fabric_1_0_fast",
    name: "VEED Fabric 1.0 Fast",
    provider: "VEED",
    endpoint: "veed/fabric-1.0/fast",
    categories: ["avatar"],
    description: "Speed-optimized lip-sync avatar generation",
    pricing: { "480p": 0.1, "720p": 0.19 },
    resolutions: ["480p", "720p"],
    defaults: { resolution: "720p" },
    features: ["lipsync", "fast_processing"],
    maxDuration: 120,
    inputRequirements: {
      required: ["image_url", "audio_url", "resolution"],
      optional: [],
    },
    costEstimate: 0.94,
    processingTime: 30,
  });

  ModelRegistry.register({
    key: "fabric_1_0_text",
    name: "VEED Fabric 1.0 Text-to-Speech",
    provider: "VEED",
    endpoint: "veed/fabric-1.0/text",
    categories: ["avatar"],
    description: "Text-to-speech + lip-sync avatar generation",
    pricing: { "480p": 0.08, "720p": 0.15 },
    resolutions: ["480p", "720p"],
    defaults: { resolution: "720p" },
    features: ["text_to_speech", "lipsync"],
    maxDuration: 120,
    inputRequirements: {
      required: ["image_url", "text", "resolution"],
      optional: ["voice_description"],
    },
    costEstimate: 0.75,
    processingTime: 50,
  });

  ModelRegistry.register({
    key: "kling_ref_to_video",
    name: "Kling O1 Reference-to-Video",
    provider: "Kuaishou",
    endpoint: "fal-ai/kling-video/o1/standard/reference-to-video",
    categories: ["avatar"],
    description: "Character consistency with reference image",
    pricing: { per_second: 0.112 },
    durationOptions: ["5", "10"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaults: { duration: "5", aspect_ratio: "16:9" },
    features: ["character_consistency", "reference_image"],
    maxDuration: 10,
    inputRequirements: {
      required: ["prompt", "reference_images"],
      optional: ["duration", "aspect_ratio", "audio_url", "face_id"],
    },
    costEstimate: 0.56,
    processingTime: 90,
  });

  ModelRegistry.register({
    key: "kling_v2v_reference",
    name: "Kling O1 V2V Reference",
    provider: "Kuaishou",
    endpoint: "fal-ai/kling-video/o1/standard/video-to-video/reference",
    categories: ["avatar"],
    description: "Style-guided video transformation",
    pricing: { per_second: 0.168 },
    durationOptions: ["5", "10"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaults: { duration: "5", aspect_ratio: "16:9" },
    features: ["style_transfer", "video_reference"],
    maxDuration: 10,
    inputRequirements: {
      required: ["prompt", "video_url"],
      optional: ["duration", "aspect_ratio", "audio_url", "face_id"],
    },
    costEstimate: 0.84,
    processingTime: 90,
  });

  ModelRegistry.register({
    key: "kling_v2v_edit",
    name: "Kling O1 V2V Edit",
    provider: "Kuaishou",
    endpoint: "fal-ai/kling-video/o1/standard/video-to-video/edit",
    categories: ["avatar"],
    description: "Targeted video editing with prompts",
    pricing: { per_second: 0.168 },
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaults: { aspect_ratio: "16:9" },
    features: ["video_editing", "prompt_based"],
    maxDuration: 10,
    inputRequirements: {
      required: ["video_url", "prompt"],
      optional: ["mask_url"],
    },
    costEstimate: 0.84,
    processingTime: 60,
  });

  ModelRegistry.register({
    key: "kling_motion_control",
    name: "Kling v2.6 Motion Control",
    provider: "Kuaishou",
    endpoint: "fal-ai/kling-video/v2.6/standard/motion-control",
    categories: ["avatar"],
    description: "Motion transfer from video to image",
    pricing: { per_second: 0.06 },
    defaults: { character_orientation: "video", keep_original_sound: true },
    features: ["motion_transfer", "audio_preservation"],
    maxDuration: 30,
    inputRequirements: {
      required: ["image_url", "video_url"],
      optional: ["character_orientation", "keep_original_sound", "prompt"],
    },
    modelInfo: { max_durations: { video: 30, image: 10 } },
    costEstimate: 0.6,
    processingTime: 60,
  });

  ModelRegistry.register({
    key: "multitalk",
    name: "AI Avatar Multi (FAL)",
    provider: "FAL AI",
    endpoint: "fal-ai/ai-avatar/multi",
    categories: ["avatar"],
    description: "Multi-person conversational avatar generation",
    pricing: {
      base: 0.1,
      "720p_multiplier": 2.0,
      extended_frames_multiplier: 1.25,
    },
    resolutions: ["480p", "720p"],
    defaults: { num_frames: 81, resolution: "480p", acceleration: "regular" },
    features: ["multi_person", "conversation", "audio_driven"],
    maxDuration: 60,
    inputRequirements: {
      required: ["image_url", "first_audio_url", "prompt"],
      optional: [
        "second_audio_url",
        "num_frames",
        "resolution",
        "seed",
        "acceleration",
        "use_only_first_audio",
      ],
    },
    costEstimate: 0.1,
    processingTime: 60,
  });

  ModelRegistry.register({
    key: "grok_video_edit",
    name: "xAI Grok Video Edit",
    provider: "xAI (via FAL)",
    endpoint: "xai/grok-imagine-video/edit-video",
    categories: ["avatar"],
    description: "Video editing with AI-powered prompts",
    pricing: { input_per_second: 0.01, output_per_second: 0.05 },
    resolutions: ["auto", "480p", "720p"],
    defaults: { resolution: "auto" },
    features: ["video_editing", "prompt_based", "colorize"],
    maxDuration: 8,
    inputRequirements: {
      required: ["video_url", "prompt"],
      optional: ["resolution"],
    },
    costEstimate: 0.36,
    processingTime: 45,
  });
}

export function registerVideoToVideoModels(): void {
  ModelRegistry.register({
    key: "thinksound",
    name: "ThinkSound",
    provider: "FAL AI",
    endpoint: "fal-ai/thinksound",
    categories: ["add_audio"],
    description:
      "AI-powered video audio generation that creates realistic sound effects",
    pricing: { per_second: 0.001 },
    defaults: { seed: null, prompt: null },
    features: [
      "Automatic sound effect generation",
      "Text prompt guidance",
      "Video context understanding",
      "High-quality audio synthesis",
      "Commercial use license",
    ],
    maxDuration: 300,
    costEstimate: 0.05,
    processingTime: 45,
  });

  ModelRegistry.register({
    key: "topaz",
    name: "Topaz Video Upscale",
    provider: "Topaz Labs (via FAL)",
    endpoint: "fal-ai/topaz/upscale/video",
    categories: ["upscale_video"],
    description: "Professional-grade video upscaling with frame interpolation",
    pricing: { per_video: "commercial" },
    defaults: { upscale_factor: 2, target_fps: null },
    features: [
      "Up to 4x upscaling",
      "Frame rate enhancement up to 120 FPS",
      "Proteus v4 upscaling engine",
      "Apollo v8 frame interpolation",
      "Professional quality enhancement",
      "Commercial use license",
    ],
    costEstimate: 1.5,
    processingTime: 120,
  });

  ModelRegistry.register({
    key: "kling_o3_standard_edit",
    name: "Kling O3 Standard Video Edit",
    provider: "Kuaishou",
    endpoint: "fal-ai/kling-video/o3/standard/video-to-video/edit",
    categories: ["video_to_video"],
    description:
      "O3 video editing with element replacement and @ reference syntax",
    pricing: { per_second: 0.252 },
    durationOptions: ["3", "5", "10", "15"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaults: {
      duration: "5",
      elements: [],
      image_urls: [],
      aspect_ratio: "16:9",
    },
    features: [
      "Element-based object/character replacement",
      "Environment modification",
      "@ reference syntax",
      "Reference image integration",
    ],
    maxDuration: 15,
    costEstimate: 1.26,
    processingTime: 60,
  });

  ModelRegistry.register({
    key: "kling_o3_pro_edit",
    name: "Kling O3 Pro Video Edit",
    provider: "Kuaishou",
    endpoint: "fal-ai/kling-video/o3/pro/video-to-video/edit",
    categories: ["video_to_video"],
    description:
      "Professional O3 video editing with enhanced quality and element replacement",
    pricing: { per_second: 0.336 },
    durationOptions: ["3", "5", "10", "15"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaults: {
      duration: "5",
      elements: [],
      image_urls: [],
      aspect_ratio: "16:9",
    },
    features: [
      "Professional-tier quality",
      "Element-based object/character replacement",
      "Environment modification",
      "@ reference syntax",
      "Reference image integration",
    ],
    maxDuration: 15,
    costEstimate: 1.68,
    processingTime: 60,
  });

  ModelRegistry.register({
    key: "kling_o3_standard_v2v_ref",
    name: "Kling O3 Standard V2V Reference",
    provider: "Kuaishou",
    endpoint: "fal-ai/kling-video/o3/standard/video-to-video/reference",
    categories: ["video_to_video"],
    description:
      "O3 video-to-video with style transfer and element consistency",
    pricing: { per_second: 0.252 },
    durationOptions: ["3", "5", "10", "15"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaults: {
      duration: "5",
      elements: [],
      image_urls: [],
      aspect_ratio: "16:9",
      keep_audio: false,
    },
    features: [
      "Style transfer from reference images",
      "Element integration with consistency",
      "@ reference syntax",
      "Optional audio preservation",
    ],
    maxDuration: 15,
    costEstimate: 1.26,
    processingTime: 60,
  });

  ModelRegistry.register({
    key: "kling_o3_pro_v2v_ref",
    name: "Kling O3 Pro V2V Reference",
    provider: "Kuaishou",
    endpoint: "fal-ai/kling-video/o3/pro/video-to-video/reference",
    categories: ["video_to_video"],
    description:
      "Professional O3 video-to-video with style transfer and enhanced quality",
    pricing: { per_second: 0.336 },
    durationOptions: ["3", "5", "10", "15"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaults: {
      duration: "5",
      elements: [],
      image_urls: [],
      aspect_ratio: "16:9",
      keep_audio: false,
    },
    features: [
      "Professional-tier quality",
      "Style transfer from reference images",
      "Element integration with consistency",
      "@ reference syntax",
      "Optional audio preservation",
    ],
    maxDuration: 15,
    costEstimate: 1.68,
    processingTime: 60,
  });
}

export function registerTextToImageModels(): void {
  ModelRegistry.register({
    key: "flux_dev",
    name: "FLUX.1 Dev",
    provider: "Black Forest Labs",
    endpoint: "fal-ai/flux/dev",
    categories: ["text_to_image"],
    description: "Highest quality 12B parameter text-to-image model",
    pricing: { per_image: 0.003 },
    aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    defaults: { aspect_ratio: "16:9", style: "cinematic" },
    features: ["high_quality", "12B_parameters"],
    costEstimate: 0.003,
    processingTime: 15,
  });

  ModelRegistry.register({
    key: "flux_schnell",
    name: "FLUX.1 Schnell",
    provider: "Black Forest Labs",
    endpoint: "fal-ai/flux/schnell",
    categories: ["text_to_image"],
    description: "Fastest inference speed text-to-image model",
    pricing: { per_image: 0.001 },
    aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    defaults: { aspect_ratio: "16:9" },
    features: ["fast_inference", "cost_effective"],
    costEstimate: 0.001,
    processingTime: 5,
  });

  ModelRegistry.register({
    key: "imagen4",
    name: "Google Imagen 4",
    provider: "Google (via FAL)",
    endpoint: "fal-ai/imagen4/preview",
    categories: ["text_to_image"],
    description: "Google's photorealistic text-to-image model",
    pricing: { per_image: 0.004 },
    aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
    defaults: { aspect_ratio: "16:9" },
    features: ["photorealistic", "high_quality"],
    costEstimate: 0.004,
    processingTime: 20,
  });

  ModelRegistry.register({
    key: "seedream_v3",
    name: "Seedream v3",
    provider: "ByteDance",
    endpoint: "fal-ai/seedream-3",
    categories: ["text_to_image"],
    description: "Multilingual text-to-image model",
    pricing: { per_image: 0.002 },
    aspectRatios: ["1:1", "16:9", "9:16"],
    defaults: { aspect_ratio: "16:9" },
    features: ["multilingual", "cost_effective"],
    costEstimate: 0.002,
    processingTime: 10,
  });

  ModelRegistry.register({
    key: "seedream3",
    name: "Seedream-3",
    provider: "ByteDance (via Replicate)",
    endpoint: "replicate/seedream-3",
    categories: ["text_to_image"],
    description: "High-resolution text-to-image model",
    pricing: { per_image: 0.003 },
    aspectRatios: ["1:1", "16:9", "9:16"],
    defaults: { aspect_ratio: "16:9" },
    features: ["high_resolution"],
    costEstimate: 0.003,
    processingTime: 15,
  });

  ModelRegistry.register({
    key: "gen4",
    name: "Runway Gen-4",
    provider: "Runway (via Replicate)",
    endpoint: "replicate/gen4",
    categories: ["text_to_image"],
    description: "Multi-reference guided image generation",
    pricing: { per_image: 0.08 },
    aspectRatios: ["1:1", "16:9", "9:16"],
    defaults: { aspect_ratio: "16:9" },
    features: ["reference_guided", "cinematic"],
    costEstimate: 0.08,
    processingTime: 20,
  });

  ModelRegistry.register({
    key: "nano_banana_pro",
    name: "Nano Banana Pro",
    provider: "FAL AI",
    endpoint: "fal-ai/nano-banana-pro",
    categories: ["text_to_image"],
    description: "Fast, high-quality text-to-image generation",
    pricing: { per_image: 0.002 },
    aspectRatios: ["1:1", "16:9", "9:16"],
    defaults: { aspect_ratio: "16:9" },
    features: ["fast_processing", "high_quality"],
    costEstimate: 0.002,
    processingTime: 5,
  });

  ModelRegistry.register({
    key: "gpt_image_1_5",
    name: "GPT Image 1.5",
    provider: "OpenAI (via FAL)",
    endpoint: "fal-ai/gpt-image-1.5",
    categories: ["text_to_image"],
    description: "GPT-powered image generation",
    pricing: { per_image: 0.003 },
    aspectRatios: ["1:1", "16:9", "9:16"],
    defaults: { aspect_ratio: "16:9" },
    features: ["gpt_powered", "natural_language"],
    costEstimate: 0.003,
    processingTime: 10,
  });
}

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

export function registerImageUnderstandingModels(): void {
  ModelRegistry.register({
    key: "gemini_describe",
    name: "Gemini Describe",
    provider: "Google",
    endpoint: "google/gemini/describe",
    categories: ["image_understanding"],
    description: "Basic image description",
    pricing: { per_request: 0.001 },
    defaults: {},
    features: ["image_description", "basic"],
    costEstimate: 0.001,
    processingTime: 3,
  });

  ModelRegistry.register({
    key: "gemini_detailed",
    name: "Gemini Detailed",
    provider: "Google",
    endpoint: "google/gemini/detailed",
    categories: ["image_understanding"],
    description: "Detailed image analysis",
    pricing: { per_request: 0.002 },
    defaults: {},
    features: ["image_analysis", "detailed"],
    costEstimate: 0.002,
    processingTime: 5,
  });

  ModelRegistry.register({
    key: "gemini_classify",
    name: "Gemini Classify",
    provider: "Google",
    endpoint: "google/gemini/classify",
    categories: ["image_understanding"],
    description: "Image classification and categorization",
    pricing: { per_request: 0.001 },
    defaults: {},
    features: ["classification", "categorization"],
    costEstimate: 0.001,
    processingTime: 3,
  });

  ModelRegistry.register({
    key: "gemini_objects",
    name: "Gemini Objects",
    provider: "Google",
    endpoint: "google/gemini/objects",
    categories: ["image_understanding"],
    description: "Object detection and identification",
    pricing: { per_request: 0.002 },
    defaults: {},
    features: ["object_detection", "identification"],
    costEstimate: 0.002,
    processingTime: 4,
  });

  ModelRegistry.register({
    key: "gemini_ocr",
    name: "Gemini OCR",
    provider: "Google",
    endpoint: "google/gemini/ocr",
    categories: ["image_understanding"],
    description: "Text extraction (OCR)",
    pricing: { per_request: 0.001 },
    defaults: {},
    features: ["ocr", "text_extraction"],
    costEstimate: 0.001,
    processingTime: 3,
  });

  ModelRegistry.register({
    key: "gemini_composition",
    name: "Gemini Composition",
    provider: "Google",
    endpoint: "google/gemini/composition",
    categories: ["image_understanding"],
    description: "Artistic and technical composition analysis",
    pricing: { per_request: 0.002 },
    defaults: {},
    features: ["composition_analysis", "artistic"],
    costEstimate: 0.002,
    processingTime: 5,
  });

  ModelRegistry.register({
    key: "gemini_qa",
    name: "Gemini Q&A",
    provider: "Google",
    endpoint: "google/gemini/qa",
    categories: ["image_understanding"],
    description: "Question and answer system for images",
    pricing: { per_request: 0.001 },
    defaults: {},
    features: ["qa", "interactive"],
    costEstimate: 0.001,
    processingTime: 4,
  });
}

export function registerPromptGenerationModels(): void {
  ModelRegistry.register({
    key: "openrouter_video_prompt",
    name: "OpenRouter Video Prompt",
    provider: "OpenRouter",
    endpoint: "openrouter/video-prompt",
    categories: ["prompt_generation"],
    description: "General video prompt generation",
    pricing: { per_request: 0.002 },
    defaults: {},
    features: ["prompt_generation", "general"],
    costEstimate: 0.002,
    processingTime: 4,
  });

  ModelRegistry.register({
    key: "openrouter_video_cinematic",
    name: "OpenRouter Video Cinematic",
    provider: "OpenRouter",
    endpoint: "openrouter/video-cinematic",
    categories: ["prompt_generation"],
    description: "Cinematic style video prompt generation",
    pricing: { per_request: 0.002 },
    defaults: {},
    features: ["prompt_generation", "cinematic"],
    costEstimate: 0.002,
    processingTime: 5,
  });

  ModelRegistry.register({
    key: "openrouter_video_realistic",
    name: "OpenRouter Video Realistic",
    provider: "OpenRouter",
    endpoint: "openrouter/video-realistic",
    categories: ["prompt_generation"],
    description: "Realistic style video prompt generation",
    pricing: { per_request: 0.002 },
    defaults: {},
    features: ["prompt_generation", "realistic"],
    costEstimate: 0.002,
    processingTime: 4,
  });

  ModelRegistry.register({
    key: "openrouter_video_artistic",
    name: "OpenRouter Video Artistic",
    provider: "OpenRouter",
    endpoint: "openrouter/video-artistic",
    categories: ["prompt_generation"],
    description: "Artistic style video prompt generation",
    pricing: { per_request: 0.002 },
    defaults: {},
    features: ["prompt_generation", "artistic"],
    costEstimate: 0.002,
    processingTime: 5,
  });

  ModelRegistry.register({
    key: "openrouter_video_dramatic",
    name: "OpenRouter Video Dramatic",
    provider: "OpenRouter",
    endpoint: "openrouter/video-dramatic",
    categories: ["prompt_generation"],
    description: "Dramatic style video prompt generation",
    pricing: { per_request: 0.002 },
    defaults: {},
    features: ["prompt_generation", "dramatic"],
    costEstimate: 0.002,
    processingTime: 5,
  });
}

export function registerSpeechToTextModels(): void {
  ModelRegistry.register({
    key: "scribe_v2",
    name: "ElevenLabs Scribe v2",
    provider: "ElevenLabs (via FAL)",
    endpoint: "fal-ai/elevenlabs/scribe/v2",
    categories: ["speech_to_text"],
    description: "Fast, accurate transcription with speaker diarization",
    pricing: { per_minute: 0.008 },
    defaults: {},
    features: ["transcription", "speaker_diarization", "multilingual"],
    costEstimate: 0.08,
    processingTime: 15,
  });
}

export function registerRunwayModels(): void {
  ModelRegistry.register({
    key: "runway_gen4",
    name: "Runway Gen-4",
    provider: "Runway",
    endpoint: "fal-ai/runway/gen4/turbo/image-to-video",
    categories: ["image_to_video", "text_to_video"],
    description: "Runway Gen-4 text/image to video with turbo mode",
    pricing: { per_second: 0.05 },
    defaults: { duration: 5 },
    features: ["text_to_video", "image_to_video", "turbo"],
    maxDuration: 10,
    costEstimate: 0.25,
    processingTime: 60,
  });
}

export function registerHeyGenModels(): void {
  ModelRegistry.register({
    key: "heygen_avatar",
    name: "HeyGen Avatar",
    provider: "HeyGen",
    endpoint: "fal-ai/heygen/v2/avatar",
    categories: ["avatar"],
    description: "AI avatar generation with customizable appearances",
    pricing: { per_second: 0.1 },
    defaults: { resolution: "1080p" },
    features: ["avatar_generation", "customizable", "lip_sync"],
    maxDuration: 60,
    costEstimate: 1.0,
    processingTime: 90,
  });
}

export function registerDIDModels(): void {
  ModelRegistry.register({
    key: "did_studio",
    name: "D-ID Studio",
    provider: "D-ID",
    endpoint: "fal-ai/d-id/studio",
    categories: ["avatar"],
    description: "D-ID talking avatar with text or audio input",
    pricing: { per_second: 0.08 },
    defaults: { resolution: "1080p" },
    features: ["avatar_generation", "text_driven", "audio_driven"],
    maxDuration: 120,
    costEstimate: 0.8,
    processingTime: 60,
  });
}

export function registerSynthesiaModels(): void {
  ModelRegistry.register({
    key: "synthesia_avatar",
    name: "Synthesia Avatar",
    provider: "Synthesia",
    endpoint: "fal-ai/synthesia/avatar",
    categories: ["avatar"],
    description: "Enterprise avatar generation with multiple languages",
    pricing: { per_second: 0.12 },
    defaults: { resolution: "1080p" },
    features: ["avatar_generation", "enterprise", "multilingual"],
    maxDuration: 300,
    costEstimate: 1.2,
    processingTime: 120,
  });
}

/** Register all Part 2 models. */
export function registerAllPart2Models(): void {
  registerAvatarModels();
  registerVideoToVideoModels();
  registerTextToImageModels();
  registerTTSModels();
  registerImageUnderstandingModels();
  registerPromptGenerationModels();
  registerSpeechToTextModels();
  registerRunwayModels();
  registerHeyGenModels();
  registerDIDModels();
  registerSynthesiaModels();
}
