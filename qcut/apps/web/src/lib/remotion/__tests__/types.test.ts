/**
 * Tests for Remotion Type Definitions
 *
 * @module lib/remotion/__tests__/types.test
 */

import { describe, it, expect } from "vitest";
import {
  isRemotionComponentDefinition,
  isRemotionError,
  generateCacheKey,
  parseCacheKey,
  hashProps,
  type RemotionComponentDefinition,
  type RemotionError,
  type FrameCacheKey,
} from "../types";

describe("isRemotionComponentDefinition", () => {
  it("should return true for valid component definition", () => {
    const validDef: RemotionComponentDefinition = {
      id: "test-component",
      name: "Test Component",
      category: "animation",
      durationInFrames: 100,
      fps: 30,
      width: 1920,
      height: 1080,
      schema: {} as any,
      defaultProps: {},
      component: () => null,
      source: "built-in",
    };

    expect(isRemotionComponentDefinition(validDef)).toBe(true);
  });

  it("should return false for null", () => {
    expect(isRemotionComponentDefinition(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isRemotionComponentDefinition(undefined)).toBe(false);
  });

  it("should return false for missing required fields", () => {
    const invalidDef = {
      id: "test",
      name: "Test",
      // missing other required fields
    };

    expect(isRemotionComponentDefinition(invalidDef)).toBe(false);
  });

  it("should return false for wrong types", () => {
    const invalidDef = {
      id: 123, // should be string
      name: "Test",
      category: "animation",
      durationInFrames: 100,
      fps: 30,
      width: 1920,
      height: 1080,
      component: () => null,
    };

    expect(isRemotionComponentDefinition(invalidDef)).toBe(false);
  });
});

describe("isRemotionError", () => {
  it("should return true for valid error", () => {
    const validError: RemotionError = {
      type: "render",
      message: "Failed to render",
      recoverable: true,
      timestamp: Date.now(),
    };

    expect(isRemotionError(validError)).toBe(true);
  });

  it("should return true for error with optional fields", () => {
    const errorWithOptionals: RemotionError = {
      type: "load",
      elementId: "elem-1",
      componentId: "comp-1",
      message: "Failed to load",
      stack: "Error stack trace",
      recoverable: false,
      recoveryAction: "retry",
      timestamp: Date.now(),
    };

    expect(isRemotionError(errorWithOptionals)).toBe(true);
  });

  it("should return false for null", () => {
    expect(isRemotionError(null)).toBe(false);
  });

  it("should return false for missing required fields", () => {
    const invalidError = {
      type: "render",
      message: "Error",
      // missing recoverable and timestamp
    };

    expect(isRemotionError(invalidError)).toBe(false);
  });
});

describe("generateCacheKey", () => {
  it("should generate consistent cache key", () => {
    const key = generateCacheKey("element-1", 50, "abc123");
    expect(key).toBe("element-1-50-abc123");
  });

  it("should handle different frame numbers", () => {
    const key1 = generateCacheKey("elem", 0, "hash");
    const key2 = generateCacheKey("elem", 100, "hash");

    expect(key1).toBe("elem-0-hash");
    expect(key2).toBe("elem-100-hash");
  });
});

describe("parseCacheKey", () => {
  it("should parse valid cache key", () => {
    // Cache key format: elementId-frame-propsHash
    // Note: elementId cannot contain hyphens with this simple parsing
    const result = parseCacheKey("element-50-abc123");

    expect(result).toEqual({
      elementId: "element",
      frame: 50,
      propsHash: "abc123",
    });
  });

  it("should handle propsHash with hyphens", () => {
    // The propsHash can contain hyphens since it uses slice(2).join("-")
    const result = parseCacheKey("elem-100-hash-with-hyphens");

    expect(result).not.toBeNull();
    expect(result?.elementId).toBe("elem");
    expect(result?.frame).toBe(100);
    expect(result?.propsHash).toBe("hash-with-hyphens");
  });

  it("should return null for invalid keys with too few parts", () => {
    expect(parseCacheKey("invalid")).toBeNull();
    expect(parseCacheKey("no-frame")).toBeNull();
  });

  it("should return null for non-numeric frame", () => {
    expect(parseCacheKey("elem-abc-hash")).toBeNull();
  });
});

describe("hashProps", () => {
  it("should generate consistent hash for same props", () => {
    const props = { text: "Hello", fontSize: 24 };
    const hash1 = hashProps(props);
    const hash2 = hashProps(props);

    expect(hash1).toBe(hash2);
  });

  it("should generate different hash for different props", () => {
    const props1 = { text: "Hello" };
    const props2 = { text: "World" };

    const hash1 = hashProps(props1);
    const hash2 = hashProps(props2);

    expect(hash1).not.toBe(hash2);
  });

  it("should be order-independent for object keys", () => {
    const props1 = { a: 1, b: 2 };
    const props2 = { b: 2, a: 1 };

    const hash1 = hashProps(props1);
    const hash2 = hashProps(props2);

    expect(hash1).toBe(hash2);
  });

  it("should handle empty object", () => {
    const hash = hashProps({});
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("should handle nested objects", () => {
    const props = { outer: { inner: "value" } };
    const hash = hashProps(props);

    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});
