/**
 * Zod Schema Parser for Remotion Components
 *
 * Parses Zod schemas to generate dynamic form fields for editing Remotion
 * component props. Supports nested objects, arrays, and various value types.
 *
 * @module lib/remotion/schema-parser
 */

import { z } from "zod";

// ============================================================================
// Types
// ============================================================================

/**
 * Supported field types for prop editors
 */
export type PropFieldType =
  | "string"
  | "number"
  | "boolean"
  | "color"
  | "select"
  | "object"
  | "array"
  | "unknown";

/**
 * Validation configuration for a field
 */
export interface FieldValidation {
  required: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  step?: number;
  options?: Array<{ label: string; value: unknown }>;
}

/**
 * Parsed field information from a Zod schema
 */
export interface ParsedField {
  /** Field name (key in the schema) */
  name: string;
  /** Field type for rendering appropriate editor */
  type: PropFieldType;
  /** Human-readable label */
  label: string;
  /** Optional description/help text */
  description?: string;
  /** Default value for the field */
  defaultValue: unknown;
  /** Validation constraints */
  validation: FieldValidation;
  /** For object types, nested fields */
  children?: ParsedField[];
  /** For array types, the item schema */
  itemSchema?: ParsedField;
}

/**
 * Result of validating values against a schema
 */
export interface ValidationResult {
  success: boolean;
  errors: Record<string, string>;
  data?: Record<string, unknown>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a field name to a human-readable label
 */
function nameToLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1") // Add space before capitals
    .replace(/[_-]/g, " ") // Replace underscores/dashes with spaces
    .replace(/^\s+/, "") // Trim leading space
    .replace(/\b\w/g, (c) => c.toUpperCase()); // Capitalize first letter of each word
}

/**
 * Check if a string looks like a color value
 */
function isColorString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // Check for hex colors (#fff, #ffffff, #ffffffff)
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value)) {
    return true;
  }
  // Check for rgb/rgba
  if (/^rgba?\s*\(/.test(value)) {
    return true;
  }
  // Check for hsl/hsla
  if (/^hsla?\s*\(/.test(value)) {
    return true;
  }
  return false;
}

/**
 * Detect if a field name suggests a color
 *
 * Note: This is a heuristic based on common naming conventions. It works in
 * conjunction with isColorString() which detects color values. False positives
 * are acceptable since the color picker UI still accepts any string input.
 */
function isColorFieldName(name: string): boolean {
  const colorKeywords = [
    "color",
    "colour",
    "background",
    "fill",
    "stroke",
    "tint",
    "border", // borderColor, border-color
    "highlight",
    "shadow", // shadowColor, boxShadow often includes colors
  ];
  const lowerName = name.toLowerCase();
  return colorKeywords.some((keyword) => lowerName.includes(keyword));
}

/**
 * Get the inner type from optional/nullable/default wrappers
 */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional) {
    return unwrapSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodNullable) {
    return unwrapSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodDefault) {
    return unwrapSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodEffects) {
    return unwrapSchema(schema._def.schema);
  }
  return schema;
}

/**
 * Check if schema is optional or has a default
 */
function isOptional(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodOptional) return true;
  if (schema instanceof z.ZodNullable) return true;
  if (schema instanceof z.ZodDefault) return true;
  return false;
}

/**
 * Get default value from schema if defined
 */
function getSchemaDefault(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodDefault) {
    return schema._def.defaultValue();
  }
  if (schema instanceof z.ZodOptional) {
    return getSchemaDefault(schema._def.innerType);
  }
  if (schema instanceof z.ZodNullable) {
    return getSchemaDefault(schema._def.innerType);
  }
  return undefined;
}

// ============================================================================
// Schema Parsing
// ============================================================================

/**
 * Parse a single Zod schema field into a ParsedField
 */
function parseField(
  name: string,
  schema: z.ZodTypeAny,
  defaultValue?: unknown
): ParsedField {
  const unwrapped = unwrapSchema(schema);
  const schemaDefault = getSchemaDefault(schema);
  const effectiveDefault = defaultValue ?? schemaDefault;
  const required = !isOptional(schema);

  // Get description from schema if available
  const description = schema._def.description || schema.description;

  // Base validation
  const validation: FieldValidation = {
    required,
  };

  // Determine field type and extract validation
  let type: PropFieldType = "unknown";
  let children: ParsedField[] | undefined;
  let itemSchema: ParsedField | undefined;

  if (unwrapped instanceof z.ZodString) {
    type = "string";
    const checks = unwrapped._def.checks || [];
    for (const check of checks) {
      if (check.kind === "min") validation.minLength = check.value;
      if (check.kind === "max") validation.maxLength = check.value;
      if (check.kind === "regex") validation.pattern = check.regex.source;
    }

    // Detect color fields
    if (
      isColorFieldName(name) ||
      isColorString(effectiveDefault)
    ) {
      type = "color";
    }
  } else if (unwrapped instanceof z.ZodNumber) {
    type = "number";
    const checks = unwrapped._def.checks || [];
    for (const check of checks) {
      if (check.kind === "min") validation.min = check.value;
      if (check.kind === "max") validation.max = check.value;
      if (check.kind === "multipleOf") validation.step = check.value;
    }
  } else if (unwrapped instanceof z.ZodBoolean) {
    type = "boolean";
  } else if (unwrapped instanceof z.ZodEnum) {
    type = "select";
    const values = unwrapped._def.values as string[];
    validation.options = values.map((v) => ({
      label: nameToLabel(String(v)),
      value: v,
    }));
  } else if (unwrapped instanceof z.ZodNativeEnum) {
    type = "select";
    const enumObj = unwrapped._def.values;
    validation.options = Object.entries(enumObj)
      .filter(([key]) => isNaN(Number(key))) // Filter out numeric keys for numeric enums
      .map(([key, value]) => ({
        label: nameToLabel(key),
        value,
      }));
  } else if (unwrapped instanceof z.ZodLiteral) {
    type = "select";
    validation.options = [
      {
        label: nameToLabel(String(unwrapped._def.value)),
        value: unwrapped._def.value,
      },
    ];
  } else if (unwrapped instanceof z.ZodUnion) {
    // Check if it's a union of literals (for select)
    const options = unwrapped._def.options as z.ZodTypeAny[];
    const allLiterals = options.every((opt) => unwrapSchema(opt) instanceof z.ZodLiteral);

    if (allLiterals) {
      type = "select";
      validation.options = options.map((opt) => {
        const literal = unwrapSchema(opt) as z.ZodLiteral<unknown>;
        return {
          label: nameToLabel(String(literal._def.value)),
          value: literal._def.value,
        };
      });
    }
  } else if (unwrapped instanceof z.ZodObject) {
    type = "object";
    const shape = unwrapped._def.shape();
    const defaultObj = (effectiveDefault as Record<string, unknown>) || {};
    children = Object.entries(shape).map(([key, value]) =>
      parseField(key, value as z.ZodTypeAny, defaultObj[key])
    );
  } else if (unwrapped instanceof z.ZodArray) {
    type = "array";
    itemSchema = parseField("item", unwrapped._def.type);
    const checks = unwrapped._def.minLength;
    if (checks) {
      validation.min = checks.value;
    }
    const maxCheck = unwrapped._def.maxLength;
    if (maxCheck) {
      validation.max = maxCheck.value;
    }
  }

  return {
    name,
    type,
    label: nameToLabel(name),
    description,
    defaultValue: effectiveDefault,
    validation,
    children,
    itemSchema,
  };
}

/**
 * Parse a Zod object schema into an array of ParsedFields
 */
export function parseSchema(
  schema: z.ZodTypeAny,
  defaultProps?: Record<string, unknown>
): ParsedField[] {
  const unwrapped = unwrapSchema(schema);

  if (!(unwrapped instanceof z.ZodObject)) {
    // If not an object, wrap it as a single field
    return [parseField("value", schema, defaultProps)];
  }

  const shape = unwrapped._def.shape();
  const defaults = defaultProps || {};

  return Object.entries(shape).map(([name, fieldSchema]) =>
    parseField(name, fieldSchema as z.ZodTypeAny, defaults[name])
  );
}

/**
 * Validate values against a Zod schema
 */
export function validateSchema(
  schema: z.ZodTypeAny,
  values: Record<string, unknown>
): ValidationResult {
  const result = schema.safeParse(values);

  if (result.success) {
    return {
      success: true,
      errors: {},
      data: result.data as Record<string, unknown>,
    };
  }

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    errors[path] = issue.message;
  }

  return {
    success: false,
    errors,
  };
}

/**
 * Extract default values from a Zod schema
 */
export function getDefaultValues(
  schema: z.ZodTypeAny,
  existingDefaults?: Record<string, unknown>
): Record<string, unknown> {
  const unwrapped = unwrapSchema(schema);

  if (!(unwrapped instanceof z.ZodObject)) {
    const schemaDefault = getSchemaDefault(schema);
    return { value: existingDefaults ?? schemaDefault };
  }

  const shape = unwrapped._def.shape();
  const defaults: Record<string, unknown> = {};
  const existing = existingDefaults || {};

  for (const [name, fieldSchema] of Object.entries(shape)) {
    const field = fieldSchema as z.ZodTypeAny;
    const schemaDefault = getSchemaDefault(field);
    const unwrappedField = unwrapSchema(field);

    if (name in existing) {
      defaults[name] = existing[name];
    } else if (schemaDefault !== undefined) {
      defaults[name] = schemaDefault;
    } else if (unwrappedField instanceof z.ZodObject) {
      defaults[name] = getDefaultValues(field);
    } else if (unwrappedField instanceof z.ZodArray) {
      defaults[name] = [];
    } else if (unwrappedField instanceof z.ZodString) {
      defaults[name] = "";
    } else if (unwrappedField instanceof z.ZodNumber) {
      defaults[name] = 0;
    } else if (unwrappedField instanceof z.ZodBoolean) {
      defaults[name] = false;
    } else {
      defaults[name] = undefined;
    }
  }

  return defaults;
}

/**
 * Get a field by path from parsed fields
 */
export function getFieldByPath(
  fields: ParsedField[],
  path: string
): ParsedField | undefined {
  const parts = path.split(".");
  let current: ParsedField | undefined;
  let currentFields = fields;

  for (const part of parts) {
    current = currentFields.find((f) => f.name === part);
    if (!current) return undefined;

    if (current.children) {
      currentFields = current.children;
    } else {
      break;
    }
  }

  return current;
}

/**
 * Update a nested value by path
 */
export function setValueByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const parts = path.split(".");
  const result = { ...obj };
  let current: Record<string, unknown> = result;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") {
      current[part] = {};
    } else {
      current[part] = { ...(current[part] as Record<string, unknown>) };
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
  return result;
}

/**
 * Get a nested value by path
 */
export function getValueByPath(
  obj: Record<string, unknown>,
  path: string
): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
