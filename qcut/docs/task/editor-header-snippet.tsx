// Added import
import { PanelPresetSelector } from "./panel-preset-selector";

// Added in rightContent navigation
const rightContent = (
  <nav className="flex items-center gap-2">
    <PanelPresetSelector />
    <KeyboardShortcutsHelp />
    <Button
      size="sm"
      className="h-8 text-xs !bg-linear-to-r from-cyan-400 to-blue-500 text-white hover:opacity-85 transition-opacity"
      onClick={handleExport}
    >
      <Download className="h-4 w-4" />
      <span className="text-sm pr-1">Export</span>
    </Button>
    {/* ... rest of navigation */}
  </nav>
);