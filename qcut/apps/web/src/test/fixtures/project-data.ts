import type { TProject } from "@/types/project";
import { DEFAULT_CANVAS_SIZE, createMainScene } from "@/stores/project-store";

/**
 * Mock project matching types/project.ts interface
 */
const mainScene = createMainScene();
export const mockProject: TProject = {
  id: "project-test-001",
  name: "Test Project",
  thumbnail: "blob:http://localhost:3000/thumb-project",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-02T00:00:00Z"),
  mediaItems: ["media-001", "media-002", "media-003"],
  backgroundColor: "#1a1a1a",
  backgroundType: "color",
  blurIntensity: 8,
  fps: 30,
  bookmarks: [0, 5.5, 10.2, 15.7], // Bookmark times in seconds
  scenes: [mainScene],
  currentSceneId: mainScene.id,
  canvasSize: DEFAULT_CANVAS_SIZE,
  canvasMode: "preset",
};

export const mockProjectBlur: TProject = {
  ...mockProject,
  id: "project-blur-001",
  name: "Blur Background Project",
  backgroundType: "blur",
  backgroundColor: undefined,
  blurIntensity: 18,
};

const emptyProjectMainScene = createMainScene();
export const mockEmptyProject: TProject = {
  id: "project-empty-001",
  name: "Empty Project",
  thumbnail: "",
  createdAt: new Date(),
  updatedAt: new Date(),
  mediaItems: [],
  backgroundColor: "#000000",
  backgroundType: "color",
  fps: 24,
  bookmarks: [],
  scenes: [emptyProjectMainScene],
  currentSceneId: emptyProjectMainScene.id,
  canvasSize: DEFAULT_CANVAS_SIZE,
  canvasMode: "preset",
};

/**
 * Create multiple mock projects
 */
export function createMockProjects(count: number): TProject[] {
  return Array.from({ length: count }, (_, i) => ({
    ...mockProject,
    id: `project-${Date.now()}-${i}`,
    name: `Project ${i + 1}`,
    createdAt: new Date(Date.now() - i * 86_400_000), // Each day older
    updatedAt: new Date(Date.now() - i * 43_200_000), // Half day older
  }));
}

/**
 * Create custom project
 */
export function createMockProject(overrides: Partial<TProject> = {}): TProject {
  return {
    ...mockProject,
    id: `project-${Date.now()}-${Math.random().toString(36).substring(2)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
