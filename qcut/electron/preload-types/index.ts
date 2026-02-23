/**
 * Barrel re-export for electron/preload-types.
 *
 * Preserves the original module's public API so existing imports
 * from "electron/preload-types" continue to work unchanged.
 */

export * from "./supporting-types";
export * from "./electron-api";
