/**
 * Export CLI Sources - Barrel Export
 *
 * Re-exports all source extraction utilities for convenient imports.
 */

// Video source extraction
export { extractVideoSources, extractVideoInputPath } from "./video-sources";

// Sticker source extraction
export { extractStickerSources } from "./sticker-sources";

// Audio source detection (shared between dialog UI and export pipeline)
export { detectAudioSources, type AudioSourceInfo } from "./audio-detection";
