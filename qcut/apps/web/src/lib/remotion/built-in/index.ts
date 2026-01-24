/**
 * Built-in Remotion Components
 *
 * This module exports all built-in Remotion components for QCut,
 * including text animations, transitions, and templates.
 *
 * @module lib/remotion/built-in
 */

// Text Components
export * from "./text";

// Transition Components
export * from "./transitions";

// Template Components
export * from "./templates";

// ============================================================================
// All Built-in Component Definitions
// ============================================================================

import { textComponentDefinitions } from "./text";
import { transitionComponentDefinitions } from "./transitions";
import { templateComponentDefinitions } from "./templates";
import type { RemotionComponentDefinition } from "../types";

/**
 * Array of all built-in component definitions
 */
export const builtInComponentDefinitions: RemotionComponentDefinition[] = [
  ...textComponentDefinitions,
  ...transitionComponentDefinitions,
  ...templateComponentDefinitions,
];

/**
 * Map of all built-in component definitions by ID
 */
export const builtInComponentsById = new Map<string, RemotionComponentDefinition>(
  builtInComponentDefinitions.map((def) => [def.id, def])
);

/**
 * Get a built-in component definition by ID
 */
export function getBuiltInComponent(id: string): RemotionComponentDefinition | undefined {
  return builtInComponentsById.get(id);
}

/**
 * Check if a component ID is a built-in component
 */
export function isBuiltInComponent(id: string): boolean {
  return builtInComponentsById.has(id);
}

/**
 * Get all built-in components by category
 */
export function getBuiltInComponentsByCategory(
  category: RemotionComponentDefinition["category"]
): RemotionComponentDefinition[] {
  return builtInComponentDefinitions.filter((def) => def.category === category);
}

/**
 * Search built-in components by name or tags
 */
export function searchBuiltInComponents(query: string): RemotionComponentDefinition[] {
  const lowerQuery = query.toLowerCase();
  return builtInComponentDefinitions.filter((def) => {
    const nameMatch = def.name.toLowerCase().includes(lowerQuery);
    const descMatch = def.description?.toLowerCase().includes(lowerQuery);
    const tagMatch = def.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery));
    return nameMatch || descMatch || tagMatch;
  });
}

/**
 * Get counts of built-in components by category
 */
export function getBuiltInComponentCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const def of builtInComponentDefinitions) {
    counts[def.category] = (counts[def.category] || 0) + 1;
  }
  return counts;
}
