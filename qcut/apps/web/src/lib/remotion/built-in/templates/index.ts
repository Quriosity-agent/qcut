/**
 * Built-in Template Components
 *
 * This module exports all built-in template components for QCut.
 * Each component includes a React component, Zod schema, and component definition.
 *
 * @module lib/remotion/built-in/templates
 */

// Lower Third
export {
  LowerThird,
  LowerThirdSchema,
  LowerThirdDefinition,
  lowerThirdDefaultProps,
  type LowerThirdProps,
} from "./lower-third";

// Title Card
export {
  TitleCard,
  TitleCardSchema,
  TitleCardDefinition,
  titleCardDefaultProps,
  type TitleCardProps,
} from "./title-card";

// Intro Scene
export {
  IntroScene,
  IntroSceneSchema,
  IntroSceneDefinition,
  introSceneDefaultProps,
  type IntroSceneProps,
} from "./intro-scene";

// Outro Scene
export {
  OutroScene,
  OutroSceneSchema,
  OutroSceneDefinition,
  outroSceneDefaultProps,
  type OutroSceneProps,
} from "./outro-scene";

// ============================================================================
// All Template Component Definitions
// ============================================================================

import { LowerThirdDefinition } from "./lower-third";
import { TitleCardDefinition } from "./title-card";
import { IntroSceneDefinition } from "./intro-scene";
import { OutroSceneDefinition } from "./outro-scene";
import type { RemotionComponentDefinition } from "../../types";

/**
 * Array of all built-in template component definitions
 */
export const templateComponentDefinitions: RemotionComponentDefinition[] = [
  LowerThirdDefinition,
  TitleCardDefinition,
  IntroSceneDefinition,
  OutroSceneDefinition,
];

/**
 * Map of template component definitions by ID
 */
export const templateComponentsById = new Map<string, RemotionComponentDefinition>(
  templateComponentDefinitions.map((def) => [def.id, def])
);

/**
 * Get a template component definition by ID
 */
export function getTemplateComponent(id: string): RemotionComponentDefinition | undefined {
  return templateComponentsById.get(id);
}

/**
 * Check if a component ID is a built-in template component
 */
export function isTemplateComponent(id: string): boolean {
  return templateComponentsById.has(id);
}
