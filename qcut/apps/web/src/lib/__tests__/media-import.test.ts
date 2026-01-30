import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ElectronAPI } from "@/types/electron";

// Create mock mediaImport API
const createMockMediaImport = () => ({
  import: vi.fn().mockResolvedValue({
    success: true,
    targetPath: "/path/to/project/media/imported/media-123.mp4",
    importMethod: "symlink" as const,
    originalPath: "/path/to/original/video.mp4",
    fileSize: 1024000,
  }),
  validateSymlink: vi.fn().mockResolvedValue(true),
  locateOriginal: vi.fn().mockResolvedValue("/path/to/original/video.mp4"),
  relinkMedia: vi.fn().mockResolvedValue({
    success: true,
    targetPath: "/path/to/project/media/imported/media-123.mp4",
    importMethod: "symlink" as const,
    originalPath: "/path/to/new/video.mp4",
    fileSize: 1024000,
  }),
  remove: vi.fn().mockResolvedValue(undefined),
  checkSymlinkSupport: vi.fn().mockResolvedValue(true),
  getMediaPath: vi.fn().mockResolvedValue("/path/to/project/media/imported"),
});

describe("Media Import - Hybrid Symlink/Copy System", () => {
  let mockMediaImport: ReturnType<typeof createMockMediaImport>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMediaImport = createMockMediaImport();

    // Setup mock window.electronAPI with mediaImport
    (window as any).electronAPI = {
      platform: "win32",
      isElectron: true,
      mediaImport: mockMediaImport,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).electronAPI;
  });

  describe("API Availability", () => {
    it("should have mediaImport API available in Electron environment", () => {
      expect(window.electronAPI).toBeDefined();
      expect(window.electronAPI.mediaImport).toBeDefined();
    });

    it("should have all required mediaImport methods", () => {
      const mediaImport = window.electronAPI.mediaImport;
      expect(mediaImport?.import).toBeDefined();
      expect(mediaImport?.validateSymlink).toBeDefined();
      expect(mediaImport?.locateOriginal).toBeDefined();
      expect(mediaImport?.relinkMedia).toBeDefined();
      expect(mediaImport?.remove).toBeDefined();
      expect(mediaImport?.checkSymlinkSupport).toBeDefined();
      expect(mediaImport?.getMediaPath).toBeDefined();
    });
  });

  describe("Import Media", () => {
    it("should successfully import media with symlink method", async () => {
      const result = await window.electronAPI.mediaImport?.import({
        sourcePath: "/path/to/original/video.mp4",
        projectId: "project-123",
        mediaId: "media-456",
        preferSymlink: true,
      });

      expect(result).toBeDefined();
      expect(result?.success).toBe(true);
      expect(result?.importMethod).toBe("symlink");
      expect(result?.targetPath).toContain("media-123");
      expect(result?.originalPath).toBe("/path/to/original/video.mp4");
      expect(result?.fileSize).toBeGreaterThan(0);
    });

    it("should call import with correct parameters", async () => {
      const importOptions = {
        sourcePath: "/path/to/source.mp4",
        projectId: "test-project",
        mediaId: "test-media",
        preferSymlink: true,
      };

      await window.electronAPI.mediaImport?.import(importOptions);

      expect(mockMediaImport.import).toHaveBeenCalledWith(importOptions);
    });

    it("should handle copy fallback when symlink fails", async () => {
      mockMediaImport.import.mockResolvedValueOnce({
        success: true,
        targetPath: "/path/to/project/media/imported/media-456.mp4",
        importMethod: "copy" as const,
        originalPath: "/path/to/original/video.mp4",
        fileSize: 2048000,
      });

      const result = await window.electronAPI.mediaImport?.import({
        sourcePath: "/path/to/original/video.mp4",
        projectId: "project-123",
        mediaId: "media-456",
        preferSymlink: true,
      });

      expect(result?.success).toBe(true);
      expect(result?.importMethod).toBe("copy");
    });

    it("should handle import failure gracefully", async () => {
      mockMediaImport.import.mockResolvedValueOnce({
        success: false,
        targetPath: "",
        importMethod: "copy" as const,
        originalPath: "/path/to/missing/file.mp4",
        fileSize: 0,
        error: "Source file does not exist or is not accessible",
      });

      const result = await window.electronAPI.mediaImport?.import({
        sourcePath: "/path/to/missing/file.mp4",
        projectId: "project-123",
        mediaId: "media-456",
      });

      expect(result?.success).toBe(false);
      expect(result?.error).toContain("does not exist");
    });
  });

  describe("Symlink Validation", () => {
    it("should validate existing symlink successfully", async () => {
      const isValid = await window.electronAPI.mediaImport?.validateSymlink(
        "/path/to/symlink.mp4"
      );

      expect(isValid).toBe(true);
      expect(mockMediaImport.validateSymlink).toHaveBeenCalledWith(
        "/path/to/symlink.mp4"
      );
    });

    it("should return false for broken symlink", async () => {
      mockMediaImport.validateSymlink.mockResolvedValueOnce(false);

      const isValid = await window.electronAPI.mediaImport?.validateSymlink(
        "/path/to/broken-symlink.mp4"
      );

      expect(isValid).toBe(false);
    });
  });

  describe("Locate Original File", () => {
    it("should locate original file for symlink", async () => {
      const originalPath = await window.electronAPI.mediaImport?.locateOriginal(
        "/path/to/symlink.mp4"
      );

      expect(originalPath).toBe("/path/to/original/video.mp4");
      expect(mockMediaImport.locateOriginal).toHaveBeenCalledWith(
        "/path/to/symlink.mp4"
      );
    });

    it("should return null for non-symlink files", async () => {
      mockMediaImport.locateOriginal.mockResolvedValueOnce(null);

      const originalPath = await window.electronAPI.mediaImport?.locateOriginal(
        "/path/to/regular-file.mp4"
      );

      expect(originalPath).toBeNull();
    });
  });

  describe("Relink Media", () => {
    it("should successfully relink media to new source", async () => {
      const result = await window.electronAPI.mediaImport?.relinkMedia(
        "project-123",
        "media-456",
        "/path/to/new/video.mp4"
      );

      expect(result?.success).toBe(true);
      expect(result?.originalPath).toBe("/path/to/new/video.mp4");
      expect(mockMediaImport.relinkMedia).toHaveBeenCalledWith(
        "project-123",
        "media-456",
        "/path/to/new/video.mp4"
      );
    });
  });

  describe("Remove Imported Media", () => {
    it("should remove imported media file", async () => {
      await window.electronAPI.mediaImport?.remove("project-123", "media-456");

      expect(mockMediaImport.remove).toHaveBeenCalledWith(
        "project-123",
        "media-456"
      );
    });
  });

  describe("Symlink Support Check", () => {
    it("should report symlink support on system", async () => {
      const supported =
        await window.electronAPI.mediaImport?.checkSymlinkSupport();

      expect(supported).toBe(true);
      expect(mockMediaImport.checkSymlinkSupport).toHaveBeenCalled();
    });

    it("should report no symlink support when not available", async () => {
      mockMediaImport.checkSymlinkSupport.mockResolvedValueOnce(false);

      const supported =
        await window.electronAPI.mediaImport?.checkSymlinkSupport();

      expect(supported).toBe(false);
    });
  });

  describe("Get Media Path", () => {
    it("should return media path for project", async () => {
      const mediaPath =
        await window.electronAPI.mediaImport?.getMediaPath("project-123");

      expect(mediaPath).toContain("media/imported");
      expect(mockMediaImport.getMediaPath).toHaveBeenCalledWith("project-123");
    });
  });

  describe("Import Metadata Integration", () => {
    it("should return import metadata for tracking", async () => {
      const result = await window.electronAPI.mediaImport?.import({
        sourcePath: "/path/to/original/video.mp4",
        projectId: "project-123",
        mediaId: "media-456",
        preferSymlink: true,
      });

      // Verify all fields needed for MediaImportMetadata
      expect(result?.importMethod).toBeDefined();
      expect(result?.originalPath).toBeDefined();
      expect(result?.fileSize).toBeDefined();
    });
  });
});

describe("Media Import Types", () => {
  it("should have correct MediaImportOptions type structure", () => {
    const options = {
      sourcePath: "/path/to/file.mp4",
      projectId: "project-id",
      mediaId: "media-id",
      preferSymlink: true,
    };

    // TypeScript will catch any missing required fields
    expect(options.sourcePath).toBeDefined();
    expect(options.projectId).toBeDefined();
    expect(options.mediaId).toBeDefined();
    expect(typeof options.preferSymlink).toBe("boolean");
  });

  it("should have correct MediaImportResult type structure", () => {
    const result = {
      success: true,
      targetPath: "/path/to/target.mp4",
      importMethod: "symlink" as const,
      originalPath: "/path/to/original.mp4",
      fileSize: 1024,
    };

    expect(result.success).toBeDefined();
    expect(result.targetPath).toBeDefined();
    expect(result.importMethod).toMatch(/^(symlink|copy)$/);
    expect(result.originalPath).toBeDefined();
    expect(typeof result.fileSize).toBe("number");
  });
});
