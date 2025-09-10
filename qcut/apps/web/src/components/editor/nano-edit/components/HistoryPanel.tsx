import React from "react";
import { useNanoEditStore } from "@/stores/nano-edit-store";
import { TrashIcon, RotateCcwIcon } from "lucide-react";

export interface HistoryEntry {
  id: string;
  timestamp: Date;
  action: string;
  assetId?: string;
  assetType?: "thumbnail" | "title-card" | "logo" | "overlay";
  description: string;
}

export const HistoryPanel: React.FC = () => {
  const { assets } = useNanoEditStore();

  // Generate history from assets (simplified approach)
  // In a full implementation, this would be stored separately
  const history: HistoryEntry[] = assets
    .map((asset) => ({
      id: asset.id,
      timestamp: asset.createdAt,
      action: "generate",
      assetId: asset.id,
      assetType: asset.type,
      description: `Generated ${asset.type}: ${asset.prompt?.slice(0, 50) || "No description"}${asset.prompt && asset.prompt.length > 50 ? "..." : ""}`,
    }))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const clearHistory = () => {
    // In a full implementation, this would clear history while keeping assets
    // For now, we'll just show the action is available
    console.log("Clear history action");
  };

  const revertToAction = (historyEntry: HistoryEntry) => {
    // In a full implementation, this would revert to a specific state
    console.log("Revert to action:", historyEntry.id);
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const getActionIcon = (assetType?: string) => {
    switch (assetType) {
      case "thumbnail":
        return "🖼️";
      case "title-card":
        return "🎬";
      case "logo":
        return "✨";
      default:
        return "🎯";
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-2xl">📜</div>
          <div>
            <h4 className="font-semibold text-white">History</h4>
            <p className="text-sm text-gray-400">
              Recent actions and generations
            </p>
          </div>
        </div>
        {history.length > 0 && (
          <button
            onClick={clearHistory}
            className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
            title="Clear History"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* History List */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {history.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <div className="text-4xl mb-2">📝</div>
            <div className="text-sm">No history yet</div>
            <div className="text-xs text-gray-500 mt-1">
              Actions will appear here as you use nano-edit
            </div>
          </div>
        ) : (
          history.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-3 p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors group"
            >
              {/* Action Icon */}
              <div className="text-lg flex-shrink-0 mt-0.5">
                {getActionIcon(entry.assetType)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">
                      {entry.action === "generate" ? "Generated" : entry.action}{" "}
                      {entry.assetType}
                    </p>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                      {entry.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-xs text-gray-500">
                      {formatTime(entry.timestamp)}
                    </span>
                    <button
                      onClick={() => revertToAction(entry)}
                      className="p-1 text-gray-400 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all"
                      title="Revert to this state"
                    >
                      <RotateCcwIcon className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* History Stats */}
      {history.length > 0 && (
        <div className="border-t border-gray-700 pt-3">
          <div className="flex justify-between text-xs text-gray-400">
            <span>Total actions: {history.length}</span>
            <span>Assets created: {assets.length}</span>
          </div>
        </div>
      )}

      {/* Future Enhancement Notice */}
      {history.length > 0 && (
        <div className="text-xs text-gray-500 bg-gray-900 p-2 rounded">
          <strong>💡 Coming Soon:</strong> Full undo/redo functionality and
          detailed action tracking
        </div>
      )}
    </div>
  );
};

export default HistoryPanel;
