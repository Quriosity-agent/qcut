/**
 * Tests for Zod Schema Parser
 *
 * @module lib/remotion/__tests__/schema-parser.test
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  parseSchema,
  validateSchema,
  getDefaultValues,
  getFieldByPath,
  setValueByPath,
  getValueByPath,
  type ParsedField,
} from "../schema-parser";

// ============================================================================
// parseSchema Tests
// ============================================================================

describe("parseSchema", () => {
  it("should parse a simple string field", () => {
    const schema = z.object({
      text: z.string(),
    });

    const fields = parseSchema(schema);

    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe("text");
    expect(fields[0].type).toBe("string");
    expect(fields[0].label).toBe("Text");
    expect(fields[0].validation.required).toBe(true);
  });

  it("should parse a number field with constraints", () => {
    const schema = z.object({
      opacity: z.number().min(0).max(1),
    });

    const fields = parseSchema(schema);

    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe("opacity");
    expect(fields[0].type).toBe("number");
    expect(fields[0].validation.min).toBe(0);
    expect(fields[0].validation.max).toBe(1);
  });

  it("should parse a boolean field", () => {
    const schema = z.object({
      visible: z.boolean(),
    });

    const fields = parseSchema(schema);

    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe("visible");
    expect(fields[0].type).toBe("boolean");
  });

  it("should parse an enum field as select", () => {
    const schema = z.object({
      alignment: z.enum(["left", "center", "right"]),
    });

    const fields = parseSchema(schema);

    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe("alignment");
    expect(fields[0].type).toBe("select");
    expect(fields[0].validation.options).toHaveLength(3);
    expect(fields[0].validation.options?.[0]).toEqual({
      label: "Left",
      value: "left",
    });
  });

  it("should detect color fields by name", () => {
    const schema = z.object({
      backgroundColor: z.string(),
      fillColor: z.string(),
      regularText: z.string(),
    });

    const fields = parseSchema(schema);

    expect(fields.find((f) => f.name === "backgroundColor")?.type).toBe("color");
    expect(fields.find((f) => f.name === "fillColor")?.type).toBe("color");
    expect(fields.find((f) => f.name === "regularText")?.type).toBe("string");
  });

  it("should detect color fields by default value", () => {
    const schema = z.object({
      tint: z.string().default("#ff0000"),
    });

    const fields = parseSchema(schema);

    expect(fields[0].type).toBe("color");
    expect(fields[0].defaultValue).toBe("#ff0000");
  });

  it("should parse optional fields correctly", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
      withDefault: z.string().default("default value"),
    });

    const fields = parseSchema(schema);

    expect(fields.find((f) => f.name === "required")?.validation.required).toBe(true);
    expect(fields.find((f) => f.name === "optional")?.validation.required).toBe(false);
    expect(fields.find((f) => f.name === "withDefault")?.validation.required).toBe(false);
  });

  it("should parse nested objects", () => {
    const schema = z.object({
      position: z.object({
        x: z.number(),
        y: z.number(),
      }),
    });

    const fields = parseSchema(schema);

    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe("position");
    expect(fields[0].type).toBe("object");
    expect(fields[0].children).toHaveLength(2);
    expect(fields[0].children?.[0].name).toBe("x");
    expect(fields[0].children?.[1].name).toBe("y");
  });

  it("should parse arrays", () => {
    const schema = z.object({
      items: z.array(z.string()),
    });

    const fields = parseSchema(schema);

    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe("items");
    expect(fields[0].type).toBe("array");
    expect(fields[0].itemSchema?.type).toBe("string");
  });

  it("should use provided default props", () => {
    const schema = z.object({
      text: z.string(),
      count: z.number(),
    });

    const fields = parseSchema(schema, { text: "Hello", count: 42 });

    expect(fields.find((f) => f.name === "text")?.defaultValue).toBe("Hello");
    expect(fields.find((f) => f.name === "count")?.defaultValue).toBe(42);
  });

  it("should parse string with length constraints", () => {
    const schema = z.object({
      username: z.string().min(3).max(20),
    });

    const fields = parseSchema(schema);

    expect(fields[0].validation.minLength).toBe(3);
    expect(fields[0].validation.maxLength).toBe(20);
  });

  it("should handle union of literals as select", () => {
    const schema = z.object({
      size: z.union([z.literal("small"), z.literal("medium"), z.literal("large")]),
    });

    const fields = parseSchema(schema);

    expect(fields[0].type).toBe("select");
    expect(fields[0].validation.options).toHaveLength(3);
  });

  it("should convert camelCase names to readable labels", () => {
    const schema = z.object({
      backgroundColor: z.string(),
      fontSize: z.number(),
      isVisible: z.boolean(),
    });

    const fields = parseSchema(schema);

    expect(fields.find((f) => f.name === "backgroundColor")?.label).toBe("Background Color");
    expect(fields.find((f) => f.name === "fontSize")?.label).toBe("Font Size");
    expect(fields.find((f) => f.name === "isVisible")?.label).toBe("Is Visible");
  });
});

// ============================================================================
// validateSchema Tests
// ============================================================================

describe("validateSchema", () => {
  it("should validate correct values", () => {
    const schema = z.object({
      text: z.string(),
      count: z.number(),
    });

    const result = validateSchema(schema, { text: "hello", count: 5 });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.data).toEqual({ text: "hello", count: 5 });
  });

  it("should return errors for invalid values", () => {
    const schema = z.object({
      text: z.string(),
      count: z.number(),
    });

    const result = validateSchema(schema, { text: 123, count: "not a number" });

    expect(result.success).toBe(false);
    expect(Object.keys(result.errors)).toContain("text");
    expect(Object.keys(result.errors)).toContain("count");
  });

  it("should validate nested objects", () => {
    const schema = z.object({
      position: z.object({
        x: z.number().min(0),
        y: z.number().min(0),
      }),
    });

    const result = validateSchema(schema, { position: { x: -1, y: 10 } });

    expect(result.success).toBe(false);
    expect(Object.keys(result.errors)).toContain("position.x");
  });

  it("should validate number constraints", () => {
    const schema = z.object({
      opacity: z.number().min(0).max(1),
    });

    const valid = validateSchema(schema, { opacity: 0.5 });
    expect(valid.success).toBe(true);

    const tooLow = validateSchema(schema, { opacity: -0.5 });
    expect(tooLow.success).toBe(false);

    const tooHigh = validateSchema(schema, { opacity: 1.5 });
    expect(tooHigh.success).toBe(false);
  });

  it("should allow optional fields to be undefined", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const result = validateSchema(schema, { required: "hello" });

    expect(result.success).toBe(true);
  });
});

// ============================================================================
// getDefaultValues Tests
// ============================================================================

describe("getDefaultValues", () => {
  it("should extract schema defaults", () => {
    const schema = z.object({
      text: z.string().default("default text"),
      count: z.number().default(10),
      visible: z.boolean().default(true),
    });

    const defaults = getDefaultValues(schema);

    expect(defaults.text).toBe("default text");
    expect(defaults.count).toBe(10);
    expect(defaults.visible).toBe(true);
  });

  it("should use existing defaults over schema defaults", () => {
    const schema = z.object({
      text: z.string().default("schema default"),
    });

    const defaults = getDefaultValues(schema, { text: "provided default" });

    expect(defaults.text).toBe("provided default");
  });

  it("should provide type-appropriate defaults for fields without defaults", () => {
    const schema = z.object({
      text: z.string(),
      count: z.number(),
      visible: z.boolean(),
      items: z.array(z.string()),
    });

    const defaults = getDefaultValues(schema);

    expect(defaults.text).toBe("");
    expect(defaults.count).toBe(0);
    expect(defaults.visible).toBe(false);
    expect(defaults.items).toEqual([]);
  });

  it("should handle nested objects", () => {
    const schema = z.object({
      position: z.object({
        x: z.number().default(100),
        y: z.number().default(200),
      }),
    });

    const defaults = getDefaultValues(schema);

    expect(defaults.position).toEqual({ x: 100, y: 200 });
  });
});

// ============================================================================
// Path Utility Tests
// ============================================================================

describe("getFieldByPath", () => {
  it("should get top-level field", () => {
    const fields: ParsedField[] = [
      {
        name: "text",
        type: "string",
        label: "Text",
        defaultValue: "",
        validation: { required: true },
      },
    ];

    const field = getFieldByPath(fields, "text");
    expect(field?.name).toBe("text");
  });

  it("should get nested field", () => {
    const fields: ParsedField[] = [
      {
        name: "position",
        type: "object",
        label: "Position",
        defaultValue: {},
        validation: { required: true },
        children: [
          {
            name: "x",
            type: "number",
            label: "X",
            defaultValue: 0,
            validation: { required: true },
          },
        ],
      },
    ];

    const field = getFieldByPath(fields, "position.x");
    expect(field?.name).toBe("x");
    expect(field?.type).toBe("number");
  });

  it("should return undefined for non-existent path", () => {
    const fields: ParsedField[] = [
      {
        name: "text",
        type: "string",
        label: "Text",
        defaultValue: "",
        validation: { required: true },
      },
    ];

    const field = getFieldByPath(fields, "nonexistent");
    expect(field).toBeUndefined();
  });
});

describe("setValueByPath", () => {
  it("should set top-level value", () => {
    const obj = { text: "old" };
    const result = setValueByPath(obj, "text", "new");

    expect(result.text).toBe("new");
    expect(obj.text).toBe("old"); // Original should be unchanged
  });

  it("should set nested value", () => {
    const obj = { position: { x: 0, y: 0 } };
    const result = setValueByPath(obj, "position.x", 100);

    expect((result.position as { x: number; y: number }).x).toBe(100);
    expect((result.position as { x: number; y: number }).y).toBe(0);
  });

  it("should create intermediate objects if needed", () => {
    const obj: Record<string, unknown> = {};
    const result = setValueByPath(obj, "position.x", 100);

    expect((result.position as Record<string, unknown>).x).toBe(100);
  });
});

describe("getValueByPath", () => {
  it("should get top-level value", () => {
    const obj = { text: "hello" };
    const value = getValueByPath(obj, "text");

    expect(value).toBe("hello");
  });

  it("should get nested value", () => {
    const obj = { position: { x: 100, y: 200 } };
    const value = getValueByPath(obj, "position.x");

    expect(value).toBe(100);
  });

  it("should return undefined for non-existent path", () => {
    const obj = { text: "hello" };
    const value = getValueByPath(obj, "nonexistent");

    expect(value).toBeUndefined();
  });

  it("should return undefined for partial path", () => {
    const obj = { text: "hello" };
    const value = getValueByPath(obj, "text.nested");

    expect(value).toBeUndefined();
  });
});
