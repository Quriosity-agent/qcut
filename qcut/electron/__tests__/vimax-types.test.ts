import { describe, expect, it } from "vitest";
import {
  ShotType,
  CameraMovement,
  createShotDescription,
  createScene,
  getSceneShotCount,
  getSceneTotalDuration,
  getStoryboardTotalShots,
  getStoryboardTotalDuration,
} from "../native-pipeline/vimax/types/shot.js";
import {
  createCharacterInNovel,
  createCharacterPortrait,
  CharacterPortraitRegistry,
  getPortraitViews,
  hasPortraitViews,
} from "../native-pipeline/vimax/types/character.js";
import {
  CameraType,
  createCameraPosition,
  createCameraConfig,
  getCameraFromHierarchy,
  getAllCameras,
} from "../native-pipeline/vimax/types/camera.js";
import {
  createImageOutput,
  createVideoOutput,
  createPipelineOutput,
  isPipelineSuccess,
  getPipelineDuration,
  addImageToOutput,
  addVideoToOutput,
} from "../native-pipeline/vimax/types/output.js";

describe("ViMax Types", () => {
  describe("Shot types", () => {
    it("ShotType enum has expected values", () => {
      expect(ShotType.WIDE).toBe("wide");
      expect(ShotType.CLOSE_UP).toBe("close_up");
      expect(ShotType.ESTABLISHING).toBe("establishing");
      expect(ShotType.POV).toBe("pov");
    });

    it("CameraMovement enum has expected values", () => {
      expect(CameraMovement.STATIC).toBe("static");
      expect(CameraMovement.PAN).toBe("pan");
      expect(CameraMovement.DOLLY).toBe("dolly");
      expect(CameraMovement.TRACKING).toBe("tracking");
    });

    it("createShotDescription fills defaults", () => {
      const shot = createShotDescription({
        shot_id: "s1_shot1",
        description: "A wide shot of the city",
      });
      expect(shot.shot_id).toBe("s1_shot1");
      expect(shot.shot_type).toBe(ShotType.MEDIUM);
      expect(shot.camera_movement).toBe(CameraMovement.STATIC);
      expect(shot.characters).toEqual([]);
      expect(shot.duration_seconds).toBe(5);
    });

    it("createScene fills defaults", () => {
      const scene = createScene({ scene_id: "scene_1" });
      expect(scene.scene_id).toBe("scene_1");
      expect(scene.shots).toEqual([]);
      expect(scene.title).toBe("");
    });

    it("getSceneShotCount returns correct count", () => {
      const scene = createScene({
        scene_id: "s1",
        shots: [
          createShotDescription({ shot_id: "s1_1", description: "shot 1" }),
          createShotDescription({ shot_id: "s1_2", description: "shot 2" }),
        ],
      });
      expect(getSceneShotCount(scene)).toBe(2);
    });

    it("getSceneTotalDuration sums shot durations", () => {
      const scene = createScene({
        scene_id: "s1",
        shots: [
          createShotDescription({
            shot_id: "s1_1",
            description: "a",
            duration_seconds: 3,
          }),
          createShotDescription({
            shot_id: "s1_2",
            description: "b",
            duration_seconds: 7,
          }),
        ],
      });
      expect(getSceneTotalDuration(scene)).toBe(10);
    });

    it("getStoryboardTotalShots sums across scenes", () => {
      const storyboard = {
        title: "Test",
        description: "Test storyboard",
        scenes: [
          createScene({
            scene_id: "s1",
            shots: [
              createShotDescription({ shot_id: "s1_1", description: "a" }),
            ],
          }),
          createScene({
            scene_id: "s2",
            shots: [
              createShotDescription({ shot_id: "s2_1", description: "b" }),
              createShotDescription({ shot_id: "s2_2", description: "c" }),
            ],
          }),
        ],
      };
      expect(getStoryboardTotalShots(storyboard)).toBe(3);
    });

    it("getStoryboardTotalDuration sums across scenes", () => {
      const storyboard = {
        title: "Test",
        description: "Test",
        scenes: [
          createScene({
            scene_id: "s1",
            shots: [
              createShotDescription({
                shot_id: "s1_1",
                description: "a",
                duration_seconds: 5,
              }),
            ],
          }),
          createScene({
            scene_id: "s2",
            shots: [
              createShotDescription({
                shot_id: "s2_1",
                description: "b",
                duration_seconds: 8,
              }),
            ],
          }),
        ],
      };
      expect(getStoryboardTotalDuration(storyboard)).toBe(13);
    });
  });

  describe("Character types", () => {
    it("createCharacterInNovel fills defaults", () => {
      const char = createCharacterInNovel({ name: "Alice" });
      expect(char.name).toBe("Alice");
      expect(char.description).toBe("");
      expect(char.role).toBe("");
    });

    it("createCharacterPortrait fills defaults", () => {
      const portrait = createCharacterPortrait({ character_name: "Bob" });
      expect(portrait.character_name).toBe("Bob");
      expect(portrait.front_view).toBeUndefined();
    });

    it("getPortraitViews returns only set views", () => {
      const portrait = createCharacterPortrait({
        character_name: "Alice",
        front_view: "/path/front.png",
        side_view: "/path/side.png",
      });
      const views = getPortraitViews(portrait);
      expect(views).toHaveProperty("front");
      expect(views).toHaveProperty("side");
      expect(views).not.toHaveProperty("back");
      expect(views).not.toHaveProperty("three_quarter");
    });

    it("hasPortraitViews returns false for empty portrait", () => {
      const portrait = createCharacterPortrait({ character_name: "Empty" });
      expect(hasPortraitViews(portrait)).toBe(false);
    });

    it("hasPortraitViews returns true when views exist", () => {
      const portrait = createCharacterPortrait({
        character_name: "Test",
        front_view: "/path/front.png",
      });
      expect(hasPortraitViews(portrait)).toBe(true);
    });
  });

  describe("CharacterPortraitRegistry", () => {
    it("adds and retrieves portraits", () => {
      const registry = new CharacterPortraitRegistry("proj-1");
      const portrait = createCharacterPortrait({
        character_name: "Alice",
        front_view: "/alice/front.png",
      });
      registry.addPortrait(portrait);
      expect(registry.getPortrait("Alice")).toBeDefined();
      expect(registry.hasCharacter("Alice")).toBe(true);
    });

    it("listCharacters returns all names", () => {
      const registry = new CharacterPortraitRegistry("proj-1");
      registry.addPortrait(
        createCharacterPortrait({ character_name: "Alice" })
      );
      registry.addPortrait(createCharacterPortrait({ character_name: "Bob" }));
      const names = registry.listCharacters();
      expect(names).toContain("Alice");
      expect(names).toContain("Bob");
      expect(names.length).toBe(2);
    });

    it("getBestView returns correct view for angle", () => {
      const registry = new CharacterPortraitRegistry("proj-1");
      registry.addPortrait(
        createCharacterPortrait({
          character_name: "Alice",
          front_view: "/front.png",
          side_view: "/side.png",
        })
      );
      expect(registry.getBestView("Alice", "front")).toBe("/front.png");
      expect(registry.getBestView("Alice", "profile")).toBe("/side.png");
    });

    it("serializes to JSON and back", () => {
      const registry = new CharacterPortraitRegistry("proj-1");
      registry.addPortrait(
        createCharacterPortrait({
          character_name: "Alice",
          front_view: "/front.png",
        })
      );
      const json = registry.toJSON();
      const restored = CharacterPortraitRegistry.fromJSON(json);
      expect(restored.hasCharacter("Alice")).toBe(true);
      expect(restored.getPortrait("Alice")?.front_view).toBe("/front.png");
    });
  });

  describe("Camera types", () => {
    it("CameraType enum has expected values", () => {
      expect(CameraType.MAIN).toBe("main");
      expect(CameraType.DIALOGUE).toBe("dialogue");
    });

    it("createCameraPosition fills defaults", () => {
      const pos = createCameraPosition();
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
      expect(pos.z).toBe(0);
    });

    it("createCameraConfig fills defaults", () => {
      const config = createCameraConfig({ camera_id: "cam1" });
      expect(config.camera_id).toBe("cam1");
      expect(config.camera_type).toBe(CameraType.MAIN);
    });

    it("getCameraFromHierarchy returns correct camera", () => {
      const primary = createCameraConfig({ camera_id: "primary" });
      const secondary = createCameraConfig({ camera_id: "secondary" });
      const hierarchy = {
        scene_id: "s1",
        primary_camera: primary,
        secondary_cameras: [secondary],
      };
      expect(getCameraFromHierarchy(hierarchy, "primary")?.camera_id).toBe(
        "primary"
      );
      expect(getCameraFromHierarchy(hierarchy, "secondary")?.camera_id).toBe(
        "secondary"
      );
      expect(getCameraFromHierarchy(hierarchy, "nonexistent")).toBeUndefined();
    });

    it("getAllCameras returns primary + secondary", () => {
      const hierarchy = {
        scene_id: "s1",
        primary_camera: createCameraConfig({ camera_id: "p" }),
        secondary_cameras: [
          createCameraConfig({ camera_id: "s1" }),
          createCameraConfig({ camera_id: "s2" }),
        ],
      };
      expect(getAllCameras(hierarchy).length).toBe(3);
    });
  });

  describe("Output types", () => {
    it("createImageOutput fills defaults", () => {
      const img = createImageOutput({ image_path: "/out/img.png" });
      expect(img.image_path).toBe("/out/img.png");
      expect(img.prompt).toBe("");
      expect(img.width).toBe(0);
    });

    it("createVideoOutput fills defaults", () => {
      const vid = createVideoOutput({ video_path: "/out/vid.mp4" });
      expect(vid.video_path).toBe("/out/vid.mp4");
      expect(vid.duration).toBe(0);
      expect(vid.fps).toBe(24);
    });

    it("createPipelineOutput fills defaults", () => {
      const out = createPipelineOutput({ pipeline_name: "test" });
      expect(out.pipeline_name).toBe("test");
      expect(out.images).toEqual([]);
      expect(out.videos).toEqual([]);
      expect(out.total_cost).toBe(0);
      expect(out.errors).toEqual([]);
    });

    it("isPipelineSuccess returns true when no errors and final_video set", () => {
      const out = createPipelineOutput({
        pipeline_name: "test",
        completed_at: new Date().toISOString(),
        final_video: "/output/final.mp4",
      });
      expect(isPipelineSuccess(out)).toBe(true);
    });

    it("isPipelineSuccess returns false with errors", () => {
      const out = createPipelineOutput({ pipeline_name: "test" });
      out.errors.push("Something failed");
      expect(isPipelineSuccess(out)).toBe(false);
    });

    it("getPipelineDuration returns null when not completed", () => {
      const out = createPipelineOutput({ pipeline_name: "test" });
      expect(getPipelineDuration(out)).toBeNull();
    });

    it("addImageToOutput appends image", () => {
      const out = createPipelineOutput({ pipeline_name: "test" });
      addImageToOutput(out, createImageOutput({ image_path: "/img.png" }));
      expect(out.images.length).toBe(1);
    });

    it("addVideoToOutput appends video", () => {
      const out = createPipelineOutput({ pipeline_name: "test" });
      addVideoToOutput(out, createVideoOutput({ video_path: "/vid.mp4" }));
      expect(out.videos.length).toBe(1);
    });
  });
});
