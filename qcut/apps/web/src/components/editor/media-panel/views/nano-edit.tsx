import React from "react";
import { useNanoEditStore, selectActiveTab } from "@/stores/nano-edit-store";
import ImageAssetsTab from "@/components/editor/nano-edit/tabs/ImageAssetsTab";
import EnhancementTab from "@/components/editor/nano-edit/tabs/EnhancementTab";

const NanoEditView: React.FC = () => {
  const activeTab = useNanoEditStore(selectActiveTab);
  const setActiveTab = useNanoEditStore((state) => state.setActiveTab);

  return (
    <div className="p-4 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">🍌 Nano Edit</h2>
        <p className="text-gray-400">AI-powered image and video enhancement</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 mb-6 bg-gray-800 p-1 rounded-lg">
        <button
          type="button"
          onClick={() => setActiveTab("image-assets")}
          className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === "image-assets"
              ? "bg-orange-500 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          📷 Image Assets
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("enhancement")}
          className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === "enhancement"
              ? "bg-orange-500 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          🔧 Enhancement
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "image-assets" && <ImageAssetsTab />}
        {activeTab === "enhancement" && <EnhancementTab />}
      </div>
    </div>
  );
};

export default NanoEditView;
