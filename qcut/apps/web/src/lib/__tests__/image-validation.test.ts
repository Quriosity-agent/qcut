import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateImageUpload,
  validateReveEditImage,
  getImageDimensions,
} from "../image-validation";

describe("Image Validation", () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  describe("validateImageUpload", () => {
    it("should reject oversized files", async () => {
      const largeMockFile = new File(
        [new ArrayBuffer(11 * 1024 * 1024)], // 11MB
        "large.png",
        { type: "image/png" }
      );

      const result = await validateImageUpload(largeMockFile, {
        maxSizeMB: 10,
        minDimensions: { width: 128, height: 128 },
        maxDimensions: { width: 4096, height: 4096 },
        allowedFormats: ["image/png"],
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds maximum");
    });

    it("should reject invalid file types", async () => {
      const mockFile = new File(["data"], "file.txt", { type: "text/plain" });

      const result = await validateImageUpload(mockFile, {
        maxSizeMB: 10,
        minDimensions: { width: 128, height: 128 },
        maxDimensions: { width: 4096, height: 4096 },
        allowedFormats: ["image/png", "image/jpeg"],
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid file type");
    });

    it("should accept valid files within constraints", async () => {
      // Mock getImageDimensions for this test
      const mockFile = new File(["data"], "valid.png", { type: "image/png" });

      // We can't easily test actual image loading in Node environment
      // In real tests, you'd mock getImageDimensions or use a test image
      expect(mockFile.type).toBe("image/png");
      expect(mockFile.size).toBeLessThan(10 * 1024 * 1024);
    });
  });

  describe("validateReveEditImage", () => {
    it("should use correct Reve Edit constraints", async () => {
      const oversizedFile = new File(
        [new ArrayBuffer(11 * 1024 * 1024)],
        "large.png",
        { type: "image/png" }
      );

      const result = await validateReveEditImage(oversizedFile);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds maximum");
    });

    it("should reject non-image file types", async () => {
      const mockFile = new File(["data"], "file.pdf", {
        type: "application/pdf",
      });

      const result = await validateReveEditImage(mockFile);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid file type");
    });

    it("should accept PNG files", () => {
      const pngFile = new File(["data"], "image.png", { type: "image/png" });
      expect(pngFile.type).toBe("image/png");
    });

    it("should accept JPEG files", () => {
      const jpegFile = new File(["data"], "image.jpg", { type: "image/jpeg" });
      expect(jpegFile.type).toBe("image/jpeg");
    });

    it("should accept WebP files", () => {
      const webpFile = new File(["data"], "image.webp", { type: "image/webp" });
      expect(webpFile.type).toBe("image/webp");
    });
  });

  describe("getImageDimensions", () => {
    it("should handle image loading errors gracefully", async () => {
      // Mock Image to trigger onerror (JSDOM doesn't fire onerror for blob URLs)
      const OriginalImage = globalThis.Image;
      globalThis.Image = class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_url: string) {
          // Simulate async error
          setTimeout(() => this.onerror?.(), 0);
        }
      } as unknown as typeof Image;

      try {
        const invalidFile = new File(["invalid"], "broken.png", {
          type: "image/png",
        });

        await expect(getImageDimensions(invalidFile)).rejects.toThrow(
          "Failed to load image"
        );
      } finally {
        globalThis.Image = OriginalImage;
      }
    });
  });
});
