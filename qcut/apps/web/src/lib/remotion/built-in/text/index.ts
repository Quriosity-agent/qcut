/**
 * Built-in Text Animation Components
 *
 * This module exports all built-in text animation components for QCut.
 * Each component includes a React component, Zod schema, and component definition.
 *
 * @module lib/remotion/built-in/text
 */

// Typewriter
export {
  Typewriter,
  TypewriterSchema,
  TypewriterDefinition,
  typewriterDefaultProps,
  type TypewriterProps,
} from "./typewriter";

// Fade In Text
export {
  FadeInText,
  FadeInTextSchema,
  FadeInTextDefinition,
  fadeInTextDefaultProps,
  type FadeInTextProps,
} from "./fade-in-text";

// Bounce Text
export {
  BounceText,
  BounceTextSchema,
  BounceTextDefinition,
  bounceTextDefaultProps,
  type BounceTextProps,
} from "./bounce-text";

// Slide Text
export {
  SlideText,
  SlideTextSchema,
  SlideTextDefinition,
  slideTextDefaultProps,
  type SlideTextProps,
} from "./slide-text";

// Scale Text
export {
  ScaleText,
  ScaleTextSchema,
  ScaleTextDefinition,
  scaleTextDefaultProps,
  type ScaleTextProps,
} from "./scale-text";

// ============================================================================
// All Text Component Definitions
// ============================================================================

import { TypewriterDefinition } from "./typewriter";
import { FadeInTextDefinition } from "./fade-in-text";
import { BounceTextDefinition } from "./bounce-text";
import { SlideTextDefinition } from "./slide-text";
import { ScaleTextDefinition } from "./scale-text";
import type { RemotionComponentDefinition } from "../../types";

/**
 * Array of all built-in text component definitions
 */
export const textComponentDefinitions: RemotionComponentDefinition[] = [
  TypewriterDefinition,
  FadeInTextDefinition,
  BounceTextDefinition,
  SlideTextDefinition,
  ScaleTextDefinition,
];

/**
 * Map of text component definitions by ID
 */
export const textComponentsById = new Map<string, RemotionComponentDefinition>(
  textComponentDefinitions.map((def) => [def.id, def])
);

/**
 * Get a text component definition by ID
 */
export function getTextComponent(
  id: string
): RemotionComponentDefinition | undefined {
  return textComponentsById.get(id);
}

/**
 * Check if a component ID is a built-in text component
 */
export function isTextComponent(id: string): boolean {
  return textComponentsById.has(id);
}
