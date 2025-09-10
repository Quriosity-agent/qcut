import { TProject, Scene } from "@/types/project";
import { TimelineTrack } from "@/types/timeline";

export interface StorageAdapter<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
  clear(): Promise<void>;
}

export interface MediaFileData {
  id: string;
  name: string;
  type: "image" | "video" | "audio";
  size: number;
  lastModified: number;
  width?: number;
  height?: number;
  duration?: number;
  url?: string; // For generated images with blob URLs
  metadata?: Record<string, unknown>; // Additional metadata
  // File will be stored separately in OPFS
}

export interface TimelineData {
  tracks: TimelineTrack[];
  lastModified: string;
}

export interface StorageConfig {
  projectsDb: string;
  mediaDb: string;
  timelineDb: string;
  version: number;
}

// Serialized scene type
export interface SerializedScene {
  id: string;
  name: string;
  isMain: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Project payload for storage (Date -> string, scenes -> SerializedScene[]). */
export type SerializedProject = Omit<
  TProject,
  "createdAt" | "updatedAt" | "scenes"
> & {
  createdAt: string;
  updatedAt: string;
  scenes: SerializedScene[];
};

// Extend FileSystemDirectoryHandle with missing async iterator methods
declare global {
  interface FileSystemDirectoryHandle {
    keys(): AsyncIterableIterator<string>;
    values(): AsyncIterableIterator<FileSystemHandle>;
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}
