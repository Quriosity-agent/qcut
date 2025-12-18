/**
 * Model Configuration Validation Utilities
 *
 * Provides runtime validation functions to ensure model configuration integrity:
 * - Model order arrays match actual model definitions
 * - Alias maps reference valid model IDs
 * - No duplicate model IDs across categories
 */

import type { AIModel } from "../types/ai-types";

/**
 * Formats an array of items into a comma-separated string for error messages.
 * @param items - Array of strings to format
 * @returns Formatted string or "(none)" if empty
 */
function formatInvariantList(items: readonly string[]): string {
  if (items.length === 0) return "(none)";
  return items.join(", ");
}

/**
 * Identifies duplicate values in an array.
 * @param values - Array to check for duplicates
 * @returns Array of duplicate values (empty if no duplicates found)
 */
function getDuplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return Array.from(duplicates);
}

/**
 * Validates that a model order array matches the model definitions exactly.
 *
 * Ensures:
 * - Every model in the definitions has a corresponding entry in the order array
 * - Every entry in the order array corresponds to a defined model
 * - No duplicates exist in the order array
 * - Count of models matches count of order entries
 *
 * @param params - Validation parameters
 * @param params.category - Category name for error messages (e.g., "T2V", "I2V")
 * @param params.models - Model definitions record
 * @param params.order - Order array to validate
 * @throws {Error} If validation fails with detailed mismatch information
 */
export function validateModelOrderInvariant({
  category,
  models,
  order,
}: {
  category: string;
  models: Record<string, unknown>;
  order: readonly string[];
}): void {
  try {
    const modelIds = Object.keys(models);
    const orderIds = Array.from(order);

    const modelIdSet = new Set(modelIds);
    const orderIdSet = new Set(orderIds);

    const missingFromOrder: string[] = [];
    for (const modelId of modelIds) {
      if (!orderIdSet.has(modelId)) missingFromOrder.push(modelId);
    }

    const unknownInOrder: string[] = [];
    for (const orderId of orderIds) {
      if (!modelIdSet.has(orderId)) unknownInOrder.push(orderId);
    }

    const duplicateOrderIds = getDuplicateValues(orderIds);

    const lengthMismatch = modelIds.length !== orderIds.length;
    const hasMismatch =
      lengthMismatch ||
      missingFromOrder.length > 0 ||
      unknownInOrder.length > 0 ||
      duplicateOrderIds.length > 0;

    if (!hasMismatch) return;

    const details = [
      lengthMismatch
        ? `count mismatch: models=${modelIds.length}, order=${orderIds.length}`
        : undefined,
      duplicateOrderIds.length > 0
        ? `duplicates in order: ${formatInvariantList(duplicateOrderIds)}`
        : undefined,
      missingFromOrder.length > 0
        ? `missing from order: ${formatInvariantList(missingFromOrder)}`
        : undefined,
      unknownInOrder.length > 0
        ? `unknown in order: ${formatInvariantList(unknownInOrder)}`
        : undefined,
    ]
      .filter((detail) => detail)
      .join("; ");

    throw new Error(`[${category}] Model order invariant violated: ${details}`);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`[${category}] Model order invariant violated`);
  }
}

/**
 * Validates that all alias map targets reference existing model IDs.
 *
 * Ensures backward compatibility by verifying that legacy model IDs
 * correctly map to current canonical model IDs in the model definitions.
 *
 * @param params - Validation parameters
 * @param params.category - Category name for error messages (e.g., "T2V")
 * @param params.models - Model definitions record
 * @param params.aliases - Alias map where keys are legacy IDs and values are canonical IDs
 * @throws {Error} If any alias targets a non-existent model ID
 */
export function validateAliasMapTargetsExist({
  category,
  models,
  aliases,
}: {
  category: string;
  models: Record<string, unknown>;
  aliases: Record<string, string>;
}): void {
  try {
    const modelIdSet = new Set(Object.keys(models));
    const invalidTargets: Array<{ alias: string; target: string }> = [];

    for (const [alias, target] of Object.entries(aliases)) {
      if (modelIdSet.has(target)) continue;
      invalidTargets.push({ alias, target });
    }

    if (invalidTargets.length === 0) return;

    const formatted = invalidTargets
      .map(({ alias, target }) => `${alias} -> ${target}`)
      .join(", ");

    throw new Error(
      `[${category}] Alias map contains invalid targets: ${formatted}`
    );
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`[${category}] Alias map contains invalid targets`);
  }
}

/**
 * Validates that AI model IDs are unique across all categories.
 *
 * Prevents ID collisions that could cause runtime errors when looking up
 * models from the combined AI_MODELS array.
 *
 * @param params - Validation parameters
 * @param params.categories - Record of category names to model arrays
 * @throws {Error} If duplicate model IDs are detected with details about conflicts
 */
export function validateUniqueAIModelIds({
  categories,
}: {
  categories: Record<string, readonly AIModel[]>;
}): void {
  try {
    const occurrences = new Map<
      string,
      Array<{ category: string; name: string }>
    >();

    for (const [category, models] of Object.entries(categories)) {
      for (const model of models) {
        const existing = occurrences.get(model.id) ?? [];
        existing.push({ category, name: model.name });
        occurrences.set(model.id, existing);
      }
    }

    const duplicates: Array<{
      id: string;
      refs: Array<{ category: string; name: string }>;
    }> = [];

    for (const [id, refs] of occurrences.entries()) {
      if (refs.length <= 1) continue;
      duplicates.push({ id, refs });
    }

    if (duplicates.length === 0) return;

    const formatted = duplicates
      .map(({ id, refs }) => {
        const locations = refs
          .map(({ category, name }) => `${category}(${name})`)
          .join(", ");
        return `${id}: ${locations}`;
      })
      .join("; ");

    throw new Error(`Duplicate AI model ids detected: ${formatted}`);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Duplicate AI model ids detected");
  }
}
