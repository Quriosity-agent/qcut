import { describe, it, expect, afterEach, vi } from "vitest";
import { getAssetPath } from "@/lib/asset-path";

describe("Asset Path Utilities", () => {
  describe("getAssetPath", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns absolute path for web environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "http:" }
      });

      expect(getAssetPath("assets/image.png")).toBe("/assets/image.png");
      expect(getAssetPath("/assets/image.png")).toBe("/assets/image.png");
    });

    it("returns absolute path for https environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "https:" }
      });

      expect(getAssetPath("assets/video.mp4")).toBe("/assets/video.mp4");
      expect(getAssetPath("/assets/video.mp4")).toBe("/assets/video.mp4");
    });

    it("returns relative path for Electron environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "file:" }
      });

      expect(getAssetPath("assets/image.png")).toBe("./assets/image.png");
      expect(getAssetPath("/assets/image.png")).toBe("./assets/image.png");
    });

    it("handles paths without leading slash in Electron", () => {
      vi.stubGlobal("window", {
        location: { protocol: "file:" }
      });

      expect(getAssetPath("fonts/roboto.ttf")).toBe("./fonts/roboto.ttf");
      expect(getAssetPath("images/logo.svg")).toBe("./images/logo.svg");
    });

    it("handles paths with leading slash in Electron", () => {
      vi.stubGlobal("window", {
        location: { protocol: "file:" }
      });

      expect(getAssetPath("/fonts/roboto.ttf")).toBe("./fonts/roboto.ttf");
      expect(getAssetPath("/images/logo.svg")).toBe("./images/logo.svg");
    });

    it("handles empty path in web environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "http:" }
      });
      expect(getAssetPath("")).toBe("/");
    });

    it("handles empty path in Electron environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "file:" }
      });
      expect(getAssetPath("")).toBe("./");
    });

    it("handles paths with subdirectories in web environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "http:" }
      });
      expect(getAssetPath("assets/images/thumbnails/video1.jpg")).toBe(
        "/assets/images/thumbnails/video1.jpg"
      );
    });

    it("handles paths with subdirectories in Electron environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "file:" }
      });
      expect(getAssetPath("assets/images/thumbnails/video1.jpg")).toBe(
        "./assets/images/thumbnails/video1.jpg"
      );
    });

    it("handles paths with query parameters in web environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "http:" }
      });
      expect(getAssetPath("assets/font.woff2?v=1.2.3")).toBe(
        "/assets/font.woff2?v=1.2.3"
      );
    });

    it("handles paths with query parameters in Electron environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "file:" }
      });
      expect(getAssetPath("assets/font.woff2?v=1.2.3")).toBe(
        "./assets/font.woff2?v=1.2.3"
      );
    });

    it("handles paths with hashes in web environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "http:" }
      });
      expect(getAssetPath("assets/icons.svg#icon-play")).toBe(
        "/assets/icons.svg#icon-play"
      );
    });

    it("handles paths with hashes in Electron environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "file:" }
      });
      expect(getAssetPath("assets/icons.svg#icon-play")).toBe(
        "./assets/icons.svg#icon-play"
      );
    });

    it("handles localhost development environment", () => {
      vi.stubGlobal("window", {
        location: { protocol: "http:" }
      });
      expect(getAssetPath("assets/dev-asset.js")).toBe("/assets/dev-asset.js");
    });

    it("handles undefined window gracefully", () => {
      vi.stubGlobal("window", undefined);
      expect(getAssetPath("assets/test.png")).toBe("/assets/test.png");
    });
  });
});
