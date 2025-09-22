import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getImageInfo,
  validateImageFile,
  resizeImage,
  imageToDataUrl,
  formatFileSize,
  getDisplayDimensions,
  needsBlobConversion,
  convertToBlob,
  revokeBlobUrl,
  getCachedBlobUrls,
} from "@/lib/image-utils";

// Mock the debug functions
vi.mock("@/lib/debug-config", () => ({
  debugLog: vi.fn(),
  debugError: vi.fn(),
  debugWarn: vi.fn(),
}));

describe("Image Utils", () => {
  describe("getImageInfo", () => {
    const OriginalImage = globalThis.Image;
    const originalCreateObjectURL = globalThis.URL.createObjectURL;
    const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;

    beforeEach(() => {
      // Mock Image constructor
      globalThis.Image = class {
        naturalWidth = 1920;
        naturalHeight = 1080;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_: string) {
          setTimeout(() => this.onload?.(), 0);
        }
      } as unknown as typeof Image;

      // Mock URL methods
      vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue(
        "blob:mock-url"
      );
      vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
    });

    afterEach(() => {
      globalThis.Image = OriginalImage;
      globalThis.URL.createObjectURL = originalCreateObjectURL;
      globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
      vi.restoreAllMocks();
    });

    it("gets image information from file", async () => {
      const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

      const info = await getImageInfo(file);

      expect(info).toEqual({
        width: 1920,
        height: 1080,
        size: file.size,
        type: "image/jpeg",
        aspectRatio: 1920 / 1080,
      });
    });

    it("handles SVG files with data URL", async () => {
      const svgContent = '<svg width="100" height="100"></svg>';
      const file = new File([svgContent], "test.svg", {
        type: "image/svg+xml",
      });

      const info = await getImageInfo(file);

      expect(info.type).toBe("image/svg+xml");
      // SVG files are processed and dimensions come from the mock Image
      // The mock returns 1920x1080, so just verify the info was retrieved
      expect(info.width).toBeGreaterThan(0);
      expect(info.height).toBeGreaterThan(0);
      expect(info.aspectRatio).toBeDefined();
    });

    it("handles image load error", async () => {
      global.Image = class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_: string) {
          setTimeout(() => this.onerror?.(), 0);
        }
      } as any;

      const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

      await expect(getImageInfo(file)).rejects.toThrow("Failed to load image");
    });
  });

  describe("validateImageFile", () => {
    it("validates valid image files", () => {
      const jpegFile = new File(["test"], "test.jpg", { type: "image/jpeg" });
      const pngFile = new File(["test"], "test.png", { type: "image/png" });
      const webpFile = new File(["test"], "test.webp", { type: "image/webp" });

      expect(validateImageFile(jpegFile)).toEqual({ valid: true });
      expect(validateImageFile(pngFile)).toEqual({ valid: true });
      expect(validateImageFile(webpFile)).toEqual({ valid: true });
    });

    it("rejects unsupported file types", () => {
      const gifFile = new File(["test"], "test.gif", { type: "image/gif" });

      const result = validateImageFile(gifFile);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("rejects files over 50MB", () => {
      const largeData = new Uint8Array(51 * 1024 * 1024);
      const largeFile = new File([largeData], "large.jpg", {
        type: "image/jpeg",
      });

      const result = validateImageFile(largeFile);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("File too large");
    });
  });

  describe("resizeImage", () => {
    beforeEach(() => {
      // Mock canvas and context
      const mockCanvas = {
        width: 0,
        height: 0,
        toBlob: (callback: BlobCallback) => {
          callback(new Blob(["resized"], { type: "image/jpeg" }));
        },
      };

      const mockContext = {
        drawImage: vi.fn(),
      };

      const realCreateElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        if (tag === "canvas") {
          return {
            ...mockCanvas,
            getContext: () => mockContext,
          } as unknown as HTMLCanvasElement;
        }
        return realCreateElement(tag);
      });

      // Mock Image
      global.Image = class {
        width = 2000;
        height = 1500;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_: string) {
          setTimeout(() => this.onload?.(), 0);
        }
      } as any;

      global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    });

    it("resizes image to fit within max dimensions", async () => {
      const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

      const resized = await resizeImage(file, 1000, 1000, 0.8);

      expect(resized).toBeInstanceOf(File);
      expect(resized.name).toBe("test.jpg");
      expect(resized.type).toBe("image/jpeg");
    });
  });

  describe("imageToDataUrl", () => {
    it("converts file to data URL", async () => {
      const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
      const expectedDataUrl = "data:image/jpeg;base64,dGVzdA==";

      // Mock FileReader
      global.FileReader = class {
        result = expectedDataUrl;
        onload: ((e: any) => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL() {
          setTimeout(
            () => this.onload?.({ target: { result: this.result } }),
            0
          );
        }
      } as any;

      const dataUrl = await imageToDataUrl(file);
      expect(dataUrl).toBe(expectedDataUrl);
    });
  });

  describe("formatFileSize", () => {
    it("formats bytes correctly", () => {
      expect(formatFileSize(0)).toBe("0 Bytes");
      expect(formatFileSize(512)).toBe("512 Bytes");
      expect(formatFileSize(1024)).toBe("1 KB");
      expect(formatFileSize(1536)).toBe("1.5 KB");
      expect(formatFileSize(1_048_576)).toBe("1 MB");
      expect(formatFileSize(1_572_864)).toBe("1.5 MB");
      expect(formatFileSize(1_073_741_824)).toBe("1 GB");
    });
  });

  describe("getDisplayDimensions", () => {
    it("fits wider image to container width", () => {
      const dimensions = getDisplayDimensions(2000, 1000, 800, 600);
      expect(dimensions.width).toBe(800);
      expect(dimensions.height).toBe(400);
    });

    it("fits taller image to container height", () => {
      const dimensions = getDisplayDimensions(1000, 2000, 800, 600);
      expect(dimensions.width).toBe(300);
      expect(dimensions.height).toBe(600);
    });

    it("maintains aspect ratio", () => {
      const dimensions = getDisplayDimensions(1920, 1080, 640, 480);
      const aspectRatio = dimensions.width / dimensions.height;
      expect(aspectRatio).toBeCloseTo(1920 / 1080, 5);
    });
  });

  describe("needsBlobConversion", () => {
    it("identifies URLs that need conversion", () => {
      expect(needsBlobConversion("https://fal.media/image.jpg")).toBe(true);
      expect(needsBlobConversion("https://v3.fal.media/image.jpg")).toBe(true);
      expect(needsBlobConversion("https://example.com/image.jpg")).toBe(false);
      expect(needsBlobConversion("blob:http://localhost:3000/uuid")).toBe(
        false
      );
    });
  });

  describe("convertToBlob and cache management", () => {
    beforeEach(() => {
      // Clear cache by getting a new map
      const cache = getCachedBlobUrls();
      cache.forEach((_, key) => revokeBlobUrl(key));
      cache.clear();

      // Mock fetch
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          blob: () =>
            Promise.resolve(new Blob(["test"], { type: "image/jpeg" })),
        } as Response)
      ) as any;

      global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
      global.URL.revokeObjectURL = vi.fn();
    });

    it("converts URL to blob URL", async () => {
      const url = "https://fal.media/test.jpg";
      const blobUrl = await convertToBlob(url);

      expect(blobUrl).toBe("blob:mock-url");
      expect(fetch).toHaveBeenCalledWith(url, {
        mode: "cors",
        headers: { Accept: "image/*" },
      });
    });

    it("caches blob URLs", async () => {
      const url = "https://fal.media/test-cache.jpg";

      // Reset fetch mock call count
      vi.clearAllMocks();

      const blobUrl1 = await convertToBlob(url);
      const blobUrl2 = await convertToBlob(url);

      expect(blobUrl1).toBe(blobUrl2);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("returns blob URLs as-is", async () => {
      const blobUrl = "blob:http://localhost:3000/uuid";
      const result = await convertToBlob(blobUrl);

      expect(result).toBe(blobUrl);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("handles fetch errors gracefully", async () => {
      const url = "https://fal.media/test-error.jpg";
      global.fetch = vi.fn(() =>
        Promise.reject(new Error("Network error"))
      ) as any;

      const result = await convertToBlob(url);

      expect(result).toBe(url); // Returns original URL as fallback
    });

    it("revokes blob URLs", async () => {
      const url = "https://fal.media/test.jpg";
      await convertToBlob(url);

      revokeBlobUrl(url);

      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
      expect(getCachedBlobUrls().has(url)).toBe(false);
    });
  });
});
