import { describe, it, expect, vi } from "vitest";
import {
  generateUUID,
  generateFileBasedId,
  cn,
  isTypableElement,
} from "@/lib/utils";

describe("Utils", () => {
  describe("generateUUID", () => {
    it("generates unique UUIDs", () => {
      const id1 = generateUUID();
      const id2 = generateUUID();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("uses crypto.randomUUID when available", () => {
      const mockRandomUUID = vi.fn(() => "mock-uuid");
      const spy = vi
        .spyOn(globalThis.crypto, "randomUUID")
        .mockImplementation(mockRandomUUID);

      try {
        const id = generateUUID();
        expect(id).toBe("mock-uuid");
        expect(mockRandomUUID).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("generateFileBasedId", () => {
    it("generates consistent ID for same file", async () => {
      const file = new File(["test"], "test.txt", {
        type: "text/plain",
        lastModified: 1_234_567_890,
      });

      const id1 = await generateFileBasedId(file);
      const id2 = await generateFileBasedId(file);
      expect(id1).toBe(id2);
      expect(id1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("generates different IDs for different files", async () => {
      const file1 = new File(["test1"], "test1.txt", { type: "text/plain" });
      const file2 = new File(["test2"], "test2.txt", { type: "text/plain" });

      const id1 = await generateFileBasedId(file1);
      const id2 = await generateFileBasedId(file2);
      expect(id1).not.toBe(id2);
    });
  });

  describe("cn (className merger)", () => {
    it("merges class names correctly", () => {
      expect(cn("bg-red-500", "text-white")).toBe("bg-red-500 text-white");
      expect(cn("p-4", { "bg-blue-500": true })).toBe("p-4 bg-blue-500");
      expect(cn("p-4", { "bg-blue-500": false })).toBe("p-4");
    });

    it("handles Tailwind conflicts correctly", () => {
      expect(cn("p-4", "p-2")).toBe("p-2");
      expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
    });
  });

  describe("isTypableElement", () => {
    it("identifies input elements as typable", () => {
      const input = document.createElement("input");
      expect(isTypableElement(input)).toBe(true);

      input.disabled = true;
      expect(isTypableElement(input)).toBe(false);
    });

    it("identifies textarea as typable", () => {
      const textarea = document.createElement("textarea");
      expect(isTypableElement(textarea)).toBe(true);

      textarea.disabled = true;
      expect(isTypableElement(textarea)).toBe(false);
    });

    it("identifies contentEditable as typable", () => {
      const div = document.createElement("div");
      div.contentEditable = "true";
      expect(isTypableElement(div)).toBe(true);
    });

    it("identifies non-typable elements", () => {
      const div = document.createElement("div");
      expect(isTypableElement(div)).toBe(false);

      const button = document.createElement("button");
      expect(isTypableElement(button)).toBe(false);
    });
  });
});
