import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClaudeElement,
  ClaudeTimeline,
} from "../../../../../electron/types/claude-api";
import { setupClaudeTimelineBridge } from "@/lib/claude-timeline-bridge";
import type { MediaItem } from "@/stores/media-store";

const storeMocks = vi.hoisted(() => {
  const timelineStoreState = {
    tracks: [],
    findOrCreateTrack: vi.fn(),
    addElementToTrack: vi.fn(),
    removeElementFromTrack: vi.fn(),
  };

  const mediaStoreState: { mediaItems: MediaItem[] } = {
    mediaItems: [],
  };

  const projectStoreState: {
    activeProject: { id: string } | null;
  } = {
    activeProject: null,
  };

  return {
    timelineStoreState,
    mediaStoreState,
    projectStoreState,
    timelineGetState: vi.fn(() => timelineStoreState),
    mediaGetState: vi.fn(() => mediaStoreState),
    projectGetState: vi.fn(() => projectStoreState),
  };
});

const syncProjectFolderMock = vi.hoisted(() => vi.fn());

vi.mock("@/stores/timeline-store", () => ({
  useTimelineStore: {
    getState: storeMocks.timelineGetState,
  },
}));

vi.mock("@/stores/media-store", () => ({
  useMediaStore: {
    getState: storeMocks.mediaGetState,
  },
}));

vi.mock("@/stores/project-store", () => ({
  useProjectStore: {
    getState: storeMocks.projectGetState,
  },
}));

vi.mock("@/lib/project-folder-sync", () => ({
  syncProjectFolder: syncProjectFolderMock,
}));

type AddElementHandler = (
  element: Partial<ClaudeElement>
) => void | Promise<void>;

function setupTimelineBridgeWithHandlers({
  withProjectFolder = false,
}: {
  withProjectFolder?: boolean;
} = {}): {
  addElementHandler: AddElementHandler;
  timelineApi: {
    onRequest: ReturnType<typeof vi.fn>;
    onApply: ReturnType<typeof vi.fn>;
    onAddElement: ReturnType<typeof vi.fn>;
    onUpdateElement: ReturnType<typeof vi.fn>;
    onRemoveElement: ReturnType<typeof vi.fn>;
    sendResponse: ReturnType<typeof vi.fn>;
    removeListeners: ReturnType<typeof vi.fn>;
  };
} {
  let addElementHandler: AddElementHandler | null = null;

  const timelineApi = {
    onRequest: vi.fn((_callback: () => void) => {}),
    onApply: vi.fn((_callback: (timeline: ClaudeTimeline) => void) => {}),
    onAddElement: vi.fn(
      (callback: (element: Partial<ClaudeElement>) => void) => {
        addElementHandler = callback;
      }
    ),
    onUpdateElement: vi.fn(
      (
        _callback: (data: {
          elementId: string;
          changes: Partial<ClaudeElement>;
        }) => void
      ) => {}
    ),
    onRemoveElement: vi.fn((_callback: (elementId: string) => void) => {}),
    sendResponse: vi.fn(),
    removeListeners: vi.fn(),
  };

  const electronAPI: {
    claude: {
      timeline: typeof timelineApi;
    };
    projectFolder?: object;
  } = {
    claude: {
      timeline: timelineApi,
    },
  };
  if (withProjectFolder) {
    electronAPI.projectFolder = {};
  }

  (
    window as unknown as {
      electronAPI?: {
        claude?: {
          timeline?: typeof timelineApi;
        };
        projectFolder?: object;
      };
    }
  ).electronAPI = electronAPI;

  setupClaudeTimelineBridge();

  if (!addElementHandler) {
    throw new Error("addElement handler was not registered");
  }
  const registeredAddElementHandler: AddElementHandler = addElementHandler;

  return {
    addElementHandler: registeredAddElementHandler,
    timelineApi,
  };
}

describe("setupClaudeTimelineBridge - add element", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    syncProjectFolderMock.mockReset();

    storeMocks.timelineStoreState.findOrCreateTrack.mockReset();
    storeMocks.timelineStoreState.addElementToTrack.mockReset();
    storeMocks.timelineStoreState.removeElementFromTrack.mockReset();

    storeMocks.timelineStoreState.findOrCreateTrack.mockImplementation(
      (trackType: string) => `${trackType}-track`
    );
    storeMocks.timelineStoreState.tracks = [];

    storeMocks.mediaStoreState.mediaItems = [];
    storeMocks.projectStoreState.activeProject = null;

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("adds a media element when sourceName matches imported media", async () => {
    storeMocks.mediaStoreState.mediaItems = [
      {
        id: "media-1",
        name: "clip-a.mp4",
        type: "video",
        file: new File([""], "clip-a.mp4"),
        duration: 12,
      },
    ];

    const { addElementHandler } = setupTimelineBridgeWithHandlers();

    await addElementHandler({
      type: "video",
      sourceName: "clip-a.mp4",
      startTime: 2,
      endTime: 6,
    });

    expect(
      storeMocks.timelineStoreState.findOrCreateTrack
    ).toHaveBeenCalledWith("media");
    expect(
      storeMocks.timelineStoreState.addElementToTrack
    ).toHaveBeenCalledWith("media-track", {
      type: "media",
      name: "clip-a.mp4",
      mediaId: "media-1",
      startTime: 2,
      duration: 4,
      trimStart: 0,
      trimEnd: 0,
    });
  });

  it("adds a media element by sourceId and falls back to media duration", async () => {
    storeMocks.mediaStoreState.mediaItems = [
      {
        id: "media-2",
        name: "clip-b.mp4",
        type: "video",
        file: new File([""], "clip-b.mp4"),
        duration: 9,
      },
    ];

    const { addElementHandler } = setupTimelineBridgeWithHandlers();

    await addElementHandler({
      type: "media",
      sourceId: "media-2",
      startTime: 3,
    });

    expect(
      storeMocks.timelineStoreState.addElementToTrack
    ).toHaveBeenCalledWith("media-track", {
      type: "media",
      name: "clip-b.mp4",
      mediaId: "media-2",
      startTime: 3,
      duration: 9,
      trimStart: 0,
      trimEnd: 0,
    });
  });

  it("adds a media element using deterministic Claude sourceId", async () => {
    const filename = "clip-c.mp4";
    const bytes = new TextEncoder().encode(filename);
    const binary = Array.from(bytes, (value) =>
      String.fromCharCode(value)
    ).join("");
    const sourceId = `media_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;

    storeMocks.mediaStoreState.mediaItems = [
      {
        id: "renderer-media-3",
        name: filename,
        type: "video",
        file: new File([""], filename),
        duration: 8,
      },
    ];

    const { addElementHandler } = setupTimelineBridgeWithHandlers();

    await addElementHandler({
      type: "video",
      sourceId,
      startTime: 0,
      endTime: 4,
    });

    expect(
      storeMocks.timelineStoreState.addElementToTrack
    ).toHaveBeenCalledWith("media-track", {
      type: "media",
      name: filename,
      mediaId: "renderer-media-3",
      startTime: 0,
      duration: 4,
      trimStart: 0,
      trimEnd: 0,
    });
  });

  it("adds a text element with defaults when content is missing", async () => {
    const { addElementHandler } = setupTimelineBridgeWithHandlers();

    await addElementHandler({
      type: "text",
      startTime: 1,
      endTime: 4,
    });

    expect(
      storeMocks.timelineStoreState.findOrCreateTrack
    ).toHaveBeenCalledWith("text");
    expect(
      storeMocks.timelineStoreState.addElementToTrack
    ).toHaveBeenCalledWith("text-track", {
      type: "text",
      name: "Text",
      content: "Text",
      startTime: 1,
      duration: 3,
      trimStart: 0,
      trimEnd: 0,
      fontSize: 48,
      fontFamily: "Inter",
      color: "#ffffff",
      backgroundColor: "transparent",
      textAlign: "center",
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      x: 0.5,
      y: 0.5,
      rotation: 0,
      opacity: 1,
    });
  });

  it("syncs project folder once and retries media resolution", async () => {
    storeMocks.projectStoreState.activeProject = { id: "proj-1" };
    syncProjectFolderMock.mockImplementation(async () => {
      storeMocks.mediaStoreState.mediaItems = [
        {
          id: "synced-image-1",
          name: "missing-image.png",
          type: "image",
          file: new File([""], "missing-image.png"),
          duration: 3,
        },
      ];
      return {
        imported: 1,
        skipped: 0,
        errors: [],
        scanTime: 5,
        totalDiskFiles: 1,
      };
    });

    const { addElementHandler } = setupTimelineBridgeWithHandlers({
      withProjectFolder: true,
    });

    await addElementHandler({
      type: "image",
      sourceName: "missing-image.png",
      startTime: 0,
      endTime: 3,
    });

    expect(syncProjectFolderMock).toHaveBeenCalledTimes(1);
    expect(syncProjectFolderMock).toHaveBeenCalledWith("proj-1");
    expect(
      storeMocks.timelineStoreState.addElementToTrack
    ).toHaveBeenCalledWith("media-track", {
      type: "media",
      name: "missing-image.png",
      mediaId: "synced-image-1",
      startTime: 0,
      duration: 3,
      trimStart: 0,
      trimEnd: 0,
    });
  });

  it("does not add media when referenced source does not exist", async () => {
    const warningSpy = vi.spyOn(console, "warn");
    const { addElementHandler } = setupTimelineBridgeWithHandlers();

    await addElementHandler({
      type: "image",
      sourceName: "missing-image.png",
      startTime: 0,
      endTime: 3,
    });

    expect(
      storeMocks.timelineStoreState.addElementToTrack
    ).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenCalledWith(
      "[ClaudeTimelineBridge] Media not found:",
      "missing-image.png"
    );
  });
});
