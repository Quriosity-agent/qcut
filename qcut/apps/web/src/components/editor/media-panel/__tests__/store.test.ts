import { describe, it, expect, beforeEach } from "vitest";
import {
  Tab,
  TabGroup,
  tabs,
  tabGroups,
  getGroupForTab,
  useMediaPanelStore,
} from "../store";

describe("media-panel store", () => {
  beforeEach(() => {
    // Reset store to defaults before each test
    useMediaPanelStore.setState({
      activeGroup: "media",
      activeTab: "media",
      lastTabPerGroup: {
        media: "media",
        "ai-create": "ai",
        agents: "remotion",
        edit: "text",
        effects: "filters",
      },
      aiActiveTab: "text",
    });
  });

  describe("tabGroups coverage", () => {
    it("every tab appears in exactly one group", () => {
      const allTabs = Object.keys(tabs) as Tab[];
      const groupedTabs: Tab[] = [];

      for (const group of Object.values(tabGroups)) {
        groupedTabs.push(...group.tabs);
      }

      // Every tab is grouped
      for (const tab of allTabs) {
        expect(groupedTabs).toContain(tab);
      }

      // No duplicates
      const unique = new Set(groupedTabs);
      expect(unique.size).toBe(groupedTabs.length);

      // Same count
      expect(groupedTabs.length).toBe(allTabs.length);
    });

    it("every group has at least one tab", () => {
      const groupKeys = Object.keys(tabGroups) as TabGroup[];
      for (const key of groupKeys) {
        expect(tabGroups[key].tabs.length).toBeGreaterThan(0);
      }
    });

    it("every group has an icon and label", () => {
      const groupKeys = Object.keys(tabGroups) as TabGroup[];
      for (const key of groupKeys) {
        expect(tabGroups[key].icon).toBeDefined();
        expect(tabGroups[key].label).toBeTruthy();
      }
    });
  });

  describe("getGroupForTab", () => {
    it("returns correct group for each tab", () => {
      expect(getGroupForTab("media")).toBe("media");
      expect(getGroupForTab("project-folder")).toBe("media");
      expect(getGroupForTab("sounds")).toBe("media");
      expect(getGroupForTab("audio")).toBe("media");

      expect(getGroupForTab("ai")).toBe("ai-create");
      expect(getGroupForTab("text2image")).toBe("ai-create");
      expect(getGroupForTab("adjustment")).toBe("ai-create");
      expect(getGroupForTab("nano-edit")).toBe("ai-create");
      expect(getGroupForTab("camera-selector")).toBe("ai-create");
      expect(getGroupForTab("segmentation")).toBe("ai-create");

      expect(getGroupForTab("text")).toBe("edit");
      expect(getGroupForTab("captions")).toBe("edit");
      expect(getGroupForTab("word-timeline")).toBe("edit");
      expect(getGroupForTab("video-edit")).toBe("edit");
      expect(getGroupForTab("draw")).toBe("edit");
      expect(getGroupForTab("stickers")).toBe("edit");

      expect(getGroupForTab("filters")).toBe("effects");
      expect(getGroupForTab("effects")).toBe("effects");
      expect(getGroupForTab("transitions")).toBe("effects");

      expect(getGroupForTab("remotion")).toBe("agents");
      expect(getGroupForTab("pty")).toBe("agents");
    });
  });

  describe("setActiveGroup", () => {
    it("sets activeGroup and restores last tab for that group", () => {
      const { setActiveGroup } = useMediaPanelStore.getState();

      setActiveGroup("ai-create");
      const state = useMediaPanelStore.getState();
      expect(state.activeGroup).toBe("ai-create");
      expect(state.activeTab).toBe("ai"); // default last tab for ai-create
    });

    it("restores previously used tab when switching back", () => {
      const store = useMediaPanelStore.getState();

      // Go to ai-create, pick text2image
      store.setActiveGroup("ai-create");
      store.setActiveTab("text2image");

      // Switch away to edit
      store.setActiveGroup("edit");
      expect(useMediaPanelStore.getState().activeTab).toBe("text");

      // Switch back to ai-create — should remember text2image
      store.setActiveGroup("ai-create");
      expect(useMediaPanelStore.getState().activeTab).toBe("text2image");
    });
  });

  describe("setActiveTab", () => {
    it("updates activeTab, activeGroup, and lastTabPerGroup", () => {
      const { setActiveTab } = useMediaPanelStore.getState();

      setActiveTab("pty");
      const state = useMediaPanelStore.getState();
      expect(state.activeTab).toBe("pty");
      expect(state.activeGroup).toBe("agents");
      expect(state.lastTabPerGroup.agents).toBe("pty");
    });

    it("does not affect other groups in lastTabPerGroup", () => {
      const { setActiveTab } = useMediaPanelStore.getState();

      setActiveTab("draw");
      const state = useMediaPanelStore.getState();
      expect(state.lastTabPerGroup.edit).toBe("draw");
      // Other groups unchanged
      expect(state.lastTabPerGroup.media).toBe("media");
      expect(state.lastTabPerGroup["ai-create"]).toBe("ai");
    });
  });
});
