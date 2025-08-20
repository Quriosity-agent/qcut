// PRESET_CONFIGS from panel-store.ts - shows the different panel size configurations
const PRESET_CONFIGS: Record<PanelPreset, PanelSizes> = {
  default: {
    toolsPanel: 25,      // 25% tools panel width
    previewPanel: 50,    // 50% preview panel width
    propertiesPanel: 25, // 25% properties panel width
    mainContent: 70,     // 70% main content height
    timeline: 30,        // 30% timeline height
  },
  media: {
    toolsPanel: 30,      // 30% tools panel width (larger for media focus)
    previewPanel: 45,    // 45% preview panel width
    propertiesPanel: 25, // 25% properties panel width
    mainContent: 100,    // 100% main content height (no timeline split)
    timeline: 25,        // 25% timeline height
  },
  inspector: {
    toolsPanel: 25,      // 25% tools panel width
    previewPanel: 50,    // 50% preview panel width
    propertiesPanel: 25, // 25% properties panel width (inspector on full height side)
    mainContent: 100,    // 100% main content height
    timeline: 25,        // 25% timeline height
  },
  "vertical-preview": {
    toolsPanel: 25,      // 25% tools panel width
    previewPanel: 40,    // 40% preview panel width (optimized for vertical videos)
    propertiesPanel: 35, // 35% properties panel width (larger)
    mainContent: 100,    // 100% main content height
    timeline: 25,        // 25% timeline height
  },
};