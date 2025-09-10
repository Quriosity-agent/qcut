import { TProject } from "@/types/project";
import { MediaItem } from "@/stores/media-store";
import { IndexedDBAdapter } from "./indexeddb-adapter";
import { LocalStorageAdapter } from "./localstorage-adapter";
import { ElectronStorageAdapter } from "./electron-adapter";
import { OPFSAdapter } from "./opfs-adapter";
import {
  MediaFileData,
  StorageConfig,
  SerializedProject,
  SerializedScene,
  TimelineData,
  StorageAdapter,
} from "./types";
import { TimelineTrack } from "@/types/timeline";
import { createObjectURL } from "@/lib/blob-manager";
import { debugLog, debugError } from "@/lib/debug-config";

class StorageService {
  private projectsAdapter!: StorageAdapter<SerializedProject>;
  private config: StorageConfig;
  private isInitialized = false;

  constructor() {
    this.config = {
      projectsDb: "video-editor-projects",
      mediaDb: "video-editor-media",
      timelineDb: "video-editor-timelines",
      version: 1,
    };

    // Initialize storage immediately
    this.initializeStorage();
  }

  private isElectronEnvironment(): boolean {
    return (
      typeof window !== "undefined" &&
      !!(window as any).electronAPI &&
      !!(window as any).electronAPI.storage
    );
  }

  private async initializeStorage() {
    if (this.isInitialized) {
      return; // Already initialized
    }

    // Try Electron IPC first if available
    if (this.isElectronEnvironment()) {
      try {
        this.projectsAdapter = new ElectronStorageAdapter<SerializedProject>(
          this.config.projectsDb,
          "projects"
        );
        // Test if Electron IPC works
        await this.projectsAdapter.list();
        this.isInitialized = true;
        return;
      } catch (error) {}
    }

    // Try IndexedDB second
    try {
      this.projectsAdapter = new IndexedDBAdapter<SerializedProject>(
        this.config.projectsDb,
        "projects",
        this.config.version
      );

      // Test if IndexedDB works by doing a simple operation
      await this.projectsAdapter.list();
      this.isInitialized = true;
    } catch (error) {
      this.projectsAdapter = new LocalStorageAdapter<SerializedProject>(
        this.config.projectsDb,
        "projects"
      );
      this.isInitialized = true;
    }
  }

  // Helper to get project-specific media adapters
  private getProjectMediaAdapters(projectId: string) {
    const mediaMetadataAdapter = new IndexedDBAdapter<MediaFileData>(
      `${this.config.mediaDb}-${projectId}`,
      "media-metadata",
      this.config.version
    );

    const mediaFilesAdapter = new OPFSAdapter(`media-files-${projectId}`);

    return { mediaMetadataAdapter, mediaFilesAdapter };
  }

  // Helper to get project-specific timeline adapter
  private getProjectTimelineAdapter({
    projectId,
    sceneId,
  }: {
    projectId: string;
    sceneId?: string;
  }) {
    const dbName = sceneId
      ? `${this.config.timelineDb}-${projectId}-${sceneId}`
      : `${this.config.timelineDb}-${projectId}`;

    return new IndexedDBAdapter<TimelineData>(
      dbName,
      "timeline",
      this.config.version
    );
  }

  // Project operations
  async saveProject({ project }: { project: TProject }): Promise<void> {
    // Ensure storage is initialized
    await this.initializeStorage();

    // Convert scenes to serializable format
    const serializedScenes: SerializedScene[] = project.scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      isMain: scene.isMain,
      createdAt: scene.createdAt.toISOString(),
      updatedAt: scene.updatedAt.toISOString(),
    }));

    // Convert TProject to serializable format
    const serializedProject: SerializedProject = {
      id: project.id,
      name: project.name,
      // Don't save blob URLs as they don't persist across sessions
      thumbnail: project.thumbnail?.startsWith("blob:")
        ? ""
        : project.thumbnail,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      scenes: serializedScenes,
      currentSceneId: project.currentSceneId,
      backgroundColor: project.backgroundColor,
      backgroundType: project.backgroundType,
      blurIntensity: project.blurIntensity,
      bookmarks: project.bookmarks,
      fps: project.fps,
      canvasSize: project.canvasSize,
      canvasMode: project.canvasMode,
    };

    await this.projectsAdapter.set(project.id, serializedProject);
  }

  async loadProject({ id }: { id: string }): Promise<TProject | null> {
    const serializedProject = await this.projectsAdapter.get(id);

    if (!serializedProject) return null;

    // Convert scenes back from serialized format
    const scenes =
      serializedProject.scenes?.map((scene) => ({
        id: scene.id,
        name: scene.name,
        isMain: scene.isMain,
        createdAt: new Date(scene.createdAt),
        updatedAt: new Date(scene.updatedAt),
      })) || [];

    // Convert back to TProject format
    return {
      id: serializedProject.id,
      name: serializedProject.name,
      thumbnail: serializedProject.thumbnail,
      createdAt: new Date(serializedProject.createdAt),
      updatedAt: new Date(serializedProject.updatedAt),
      scenes,
      currentSceneId: serializedProject.currentSceneId || scenes[0]?.id || "",
      backgroundColor: serializedProject.backgroundColor,
      backgroundType: serializedProject.backgroundType,
      blurIntensity: serializedProject.blurIntensity,
      bookmarks: serializedProject.bookmarks,
      fps: serializedProject.fps,
      canvasSize: serializedProject.canvasSize || { width: 1920, height: 1080 },
      canvasMode: serializedProject.canvasMode || "preset",
    };
  }

  async loadAllProjects(): Promise<TProject[]> {
    // Ensure storage is initialized
    await this.initializeStorage();

    const projectIds = await this.projectsAdapter.list();
    const projects: TProject[] = [];

    for (const id of projectIds) {
      const project = await this.loadProject({ id });
      if (project) {
        projects.push(project);
      } else {
      }
    }

    // Sort by last updated (most recent first)
    return projects.sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  }

  async deleteProject(id: string): Promise<void> {
    await this.projectsAdapter.remove(id);
  }

  // Media operations - now project-specific
  async saveMediaItem(projectId: string, mediaItem: MediaItem): Promise<void> {
    const { mediaMetadataAdapter, mediaFilesAdapter } =
      this.getProjectMediaAdapters(projectId);

    // Only save file if it has actual content
    if (mediaItem.file.size > 0) {
      // Save file to project-specific OPFS
      await mediaFilesAdapter.set(mediaItem.id, mediaItem.file);
    }

    // Save metadata to project-specific IndexedDB
    const metadata: MediaFileData = {
      id: mediaItem.id,
      name: mediaItem.name,
      type: mediaItem.type,
      size: mediaItem.file.size,
      lastModified: mediaItem.file.lastModified,
      width: mediaItem.width,
      height: mediaItem.height,
      duration: mediaItem.duration,
      // Only store non-blob URLs (e.g., data URLs, http URLs)
      // Blob URLs are temporary and don't persist across sessions
      url: mediaItem.url?.startsWith("blob:") ? undefined : mediaItem.url,
      metadata: mediaItem.metadata,
    };

    await mediaMetadataAdapter.set(mediaItem.id, metadata);
  }

  async loadMediaItem(
    projectId: string,
    id: string
  ): Promise<MediaItem | null> {
    const { mediaMetadataAdapter, mediaFilesAdapter } =
      this.getProjectMediaAdapters(projectId);

    const [file, metadata] = await Promise.all([
      mediaFilesAdapter.get(id),
      mediaMetadataAdapter.get(id),
    ]);

    if (!metadata) return null;

    let url: string;
    let actualFile: File;

    if (file && file.size > 0) {
      // File exists with content
      actualFile = file;

      // In Electron, convert to data URL for better compatibility
      if (this.isElectronEnvironment() && metadata.type === "image") {
        // For images in Electron, use data URL
        url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              resolve(reader.result);
            } else {
              reject(new Error("Failed to read file as data URL"));
            }
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        debugLog(
          `[StorageService] Created data URL for ${metadata.name} in Electron`
        );
      } else {
        // Use blob URL for web environment or non-image files
        // NOTE: Caller is responsible for revoking blob URLs via revokeObjectURL()
        url = createObjectURL(file, "storage-service");
        debugLog(
          `[StorageService] Created object URL for ${metadata.name}: ${url}`
        );
      }
    } else if (metadata.url) {
      // No file or empty file, but we have a URL (e.g., generated image fallback)
      // Skip invalid blob URLs from previous sessions
      if (metadata.url.startsWith("blob:")) {
        console.warn(
          `[StorageService] Skipping invalid blob URL for ${metadata.name}. Blob URLs don't persist across sessions.`
        );
        return null;
      }
      url = metadata.url;
      // Create empty file placeholder
      actualFile = new File([], metadata.name, {
        type: `${metadata.type}/jpeg`,
      });
      console.log(
        `[StorageService] Using stored URL for ${metadata.name}: ${url}`
      );
    } else {
      // No file and no URL, cannot load
      console.warn(
        `[StorageService] No file or URL found for media item: ${metadata.name}`
      );
      return null;
    }

    return {
      id: metadata.id,
      name: metadata.name,
      type: metadata.type,
      file: actualFile,
      url,
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
      metadata: metadata.metadata,
      // thumbnailUrl would need to be regenerated or cached separately
    };
  }

  async loadAllMediaItems(projectId: string): Promise<MediaItem[]> {
    const { mediaMetadataAdapter } = this.getProjectMediaAdapters(projectId);

    const mediaIds = await mediaMetadataAdapter.list();
    const mediaItems: MediaItem[] = [];

    for (const id of mediaIds) {
      const item = await this.loadMediaItem(projectId, id);
      if (item) {
        mediaItems.push(item);
      }
    }

    return mediaItems;
  }

  async deleteMediaItem(projectId: string, id: string): Promise<void> {
    const { mediaMetadataAdapter, mediaFilesAdapter } =
      this.getProjectMediaAdapters(projectId);

    await Promise.all([
      mediaFilesAdapter.remove(id),
      mediaMetadataAdapter.remove(id),
    ]);
  }

  async deleteProjectMedia(projectId: string): Promise<void> {
    const { mediaMetadataAdapter, mediaFilesAdapter } =
      this.getProjectMediaAdapters(projectId);

    await Promise.all([
      mediaMetadataAdapter.clear(),
      mediaFilesAdapter.clear(),
    ]);
  }

  // Legacy timeline operations (kept for backward compatibility)
  async saveProjectTimeline({
    projectId,
    tracks,
    sceneId,
  }: {
    projectId: string;
    tracks: TimelineTrack[];
    sceneId?: string;
  }): Promise<void> {
    return this.saveTimeline({ projectId, tracks, sceneId });
  }

  async loadProjectTimeline({
    projectId,
    sceneId,
  }: {
    projectId: string;
    sceneId?: string;
  }): Promise<TimelineTrack[] | null> {
    return this.loadTimeline({ projectId, sceneId });
  }

  async deleteProjectTimeline({
    projectId,
  }: {
    projectId: string;
  }): Promise<void> {
    const timelineAdapter = this.getProjectTimelineAdapter({ projectId });
    await timelineAdapter.remove("timeline");
  }

  // Scene-aware timeline operations
  async saveTimeline({
    projectId,
    tracks,
    sceneId,
  }: {
    projectId: string;
    tracks: TimelineTrack[];
    sceneId?: string;
  }): Promise<void> {
    const timelineAdapter = this.getProjectTimelineAdapter({
      projectId,
      sceneId,
    });
    const timelineData: TimelineData = {
      tracks,
      lastModified: new Date().toISOString(),
    };
    await timelineAdapter.set("timeline", timelineData);
  }

  async loadTimeline({
    projectId,
    sceneId,
  }: {
    projectId: string;
    sceneId?: string;
  }): Promise<TimelineTrack[] | null> {
    const timelineAdapter = this.getProjectTimelineAdapter({
      projectId,
      sceneId,
    });
    const timelineData = await timelineAdapter.get("timeline");
    return timelineData ? timelineData.tracks : null;
  }

  // Utility methods
  async clearAllData(): Promise<void> {
    // Clear all projects
    await this.projectsAdapter.clear();

    // Note: Project-specific media and timelines will be cleaned up when projects are deleted
  }

  async getStorageInfo(): Promise<{
    projects: number;
    isOPFSSupported: boolean;
    isIndexedDBSupported: boolean;
  }> {
    const projectIds = await this.projectsAdapter.list();

    return {
      projects: projectIds.length,
      isOPFSSupported: this.isOPFSSupported(),
      isIndexedDBSupported: this.isIndexedDBSupported(),
    };
  }

  async getProjectStorageInfo(projectId: string): Promise<{
    mediaItems: number;
    hasTimeline: boolean;
  }> {
    const { mediaMetadataAdapter } = this.getProjectMediaAdapters(projectId);
    const timelineAdapter = this.getProjectTimelineAdapter({ projectId });

    const [mediaIds, timelineData] = await Promise.all([
      mediaMetadataAdapter.list(),
      timelineAdapter.get("timeline"),
    ]);

    return {
      mediaItems: mediaIds.length,
      hasTimeline: !!timelineData,
    };
  }

  // Check browser support
  isOPFSSupported(): boolean {
    return OPFSAdapter.isSupported();
  }

  isIndexedDBSupported(): boolean {
    return "indexedDB" in window;
  }

  isFullySupported(): boolean {
    return this.isIndexedDBSupported() && this.isOPFSSupported();
  }

  /**
   * Check storage quota to prevent running out of space
   */
  async checkStorageQuota(): Promise<{
    available: boolean;
    usage: number;
    quota: number;
    usagePercent: number;
  }> {
    if (typeof navigator === "undefined" || !("storage" in navigator)) {
      // Storage API not supported - assume available but with unknown limits
      debugLog(
        "[StorageService] Storage API not supported, assuming available"
      );
      return { available: true, usage: 0, quota: Infinity, usagePercent: 0 };
    }

    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || Infinity;
      const usagePercent = quota === Infinity ? 0 : (usage / quota) * 100;

      debugLog(
        `[StorageService] Storage usage: ${(usage / 1024 / 1024).toFixed(2)}MB / ${quota === Infinity ? "∞" : (quota / 1024 / 1024).toFixed(2)}MB (${usagePercent.toFixed(1)}%`
      );

      return {
        available: usagePercent < 80, // Warn at 80% usage
        usage,
        quota,
        usagePercent,
      };
    } catch (error) {
      debugError("[StorageService] Failed to check storage quota:", error);
      // On error, assume available to not block operations
      return { available: true, usage: 0, quota: Infinity, usagePercent: 0 };
    }
  }
}

// Export singleton instance
export const storageService = new StorageService();
export { StorageService };
