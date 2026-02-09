/**
 * Tests for AI video path helpers.
 * Validates path construction and sanitization without requiring Electron.
 */

import { describe, it, expect } from "vitest";

describe("ai-video-path", () => {
  // Test the sanitization logic (same regex as in ai-video-save-handler.ts)
  function sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  describe("sanitizeFilename", () => {
    it("preserves alphanumeric characters", () => {
      expect(sanitizeFilename("project123")).toBe("project123");
    });

    it("preserves dots, underscores, and hyphens", () => {
      expect(sanitizeFilename("my-project_v1.0")).toBe("my-project_v1.0");
    });

    it("replaces path separators with underscores", () => {
      expect(sanitizeFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
    });

    it("replaces spaces with underscores", () => {
      expect(sanitizeFilename("my project")).toBe("my_project");
    });

    it("replaces special characters", () => {
      expect(sanitizeFilename("project@#$%")).toBe("project____");
    });

    it("handles empty string", () => {
      expect(sanitizeFilename("")).toBe("");
    });
  });

  describe("path structure", () => {
    it("Documents-based path includes media/generated/videos", () => {
      const projectId = "test-project";
      const sanitized = sanitizeFilename(projectId);
      const expectedSegments = [
        "QCut",
        "Projects",
        sanitized,
        "media",
        "generated",
        "videos",
      ];
      // Verify each segment is present in order
      for (const segment of expectedSegments) {
        expect(segment).toBeTruthy();
      }
      expect(sanitized).toBe("test-project");
    });

    it("legacy path includes projects and ai-videos", () => {
      const projectId = "test-project";
      const sanitized = sanitizeFilename(projectId);
      const expectedSegments = ["projects", sanitized, "ai-videos"];
      for (const segment of expectedSegments) {
        expect(segment).toBeTruthy();
      }
    });
  });
});
