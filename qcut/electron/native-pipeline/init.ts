/**
 * Registry-only initialization (no Electron dependencies)
 *
 * CLI imports this; Electron imports index.ts (which does the same + exports manager).
 * Safe to call multiple times — initialization is idempotent.
 *
 * @module electron/native-pipeline/init
 */

import {
  registerTextToVideoModels,
  registerImageToVideoModels,
  registerImageToImageModels,
} from "./registry-data.js";
import { registerAllPart2Models } from "./registry-data-2.js";

let initialized = false;

export function initRegistry(): void {
  if (initialized) return;
  registerTextToVideoModels();
  registerImageToVideoModels();
  registerImageToImageModels();
  registerAllPart2Models();
  initialized = true;
}

/** Reset initialization state (for tests only). */
export function resetInitState(): void {
  initialized = false;
}
