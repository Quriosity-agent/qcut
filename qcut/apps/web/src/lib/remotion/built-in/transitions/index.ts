/**
 * Built-in Transition Components
 *
 * This module exports all built-in transition components for QCut.
 * Each component includes a React component, Zod schema, and component definition.
 *
 * @module lib/remotion/built-in/transitions
 */

// Wipe
export {
  Wipe,
  WipeSchema,
  WipeDefinition,
  wipeDefaultProps,
  type WipeProps,
} from "./wipe";

// Dissolve
export {
  Dissolve,
  DissolveSchema,
  DissolveDefinition,
  dissolveDefaultProps,
  type DissolveProps,
} from "./dissolve";

// Slide Transition
export {
  Slide,
  SlideSchema,
  SlideDefinition,
  slideDefaultProps,
  type SlideProps,
} from "./slide";

// Zoom Transition
export {
  Zoom,
  ZoomSchema,
  ZoomDefinition,
  zoomDefaultProps,
  type ZoomProps,
} from "./zoom";

// ============================================================================
// All Transition Component Definitions
// ============================================================================

import { WipeDefinition } from "./wipe";
import { DissolveDefinition } from "./dissolve";
import { SlideDefinition } from "./slide";
import { ZoomDefinition } from "./zoom";
import type { RemotionComponentDefinition } from "../../types";

/**
 * Array of all built-in transition component definitions
 */
export const transitionComponentDefinitions: RemotionComponentDefinition[] = [
  WipeDefinition,
  DissolveDefinition,
  SlideDefinition,
  ZoomDefinition,
];

/**
 * Map of transition component definitions by ID
 */
export const transitionComponentsById = new Map<string, RemotionComponentDefinition>(
  transitionComponentDefinitions.map((def) => [def.id, def])
);

/**
 * Get a transition component definition by ID
 */
export function getTransitionComponent(id: string): RemotionComponentDefinition | undefined {
  return transitionComponentsById.get(id);
}

/**
 * Check if a component ID is a built-in transition component
 */
export function isTransitionComponent(id: string): boolean {
  return transitionComponentsById.has(id);
}
