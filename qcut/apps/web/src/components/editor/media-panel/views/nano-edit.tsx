import React from "react";
import {
  useNanoEditStore,
  selectIsProcessing,
  selectActiveTab,
} from "../../../../stores/nano-edit-store";
import LoadingSpinner from "../../../ui/LoadingSpinner";
import ImageAssetsTab from "../../nano-edit/tabs/ImageAssetsTab";
import EnhancementTab from "../../nano-edit/tabs/EnhancementTab";

const NanoEditView: React.FC = () => {
  const isProcessing = useNanoEditStore(selectIsProcessing);
  const activeTab = useNanoEditStore(selectActiveTab);
  const setActiveTab = useNanoEditStore((state) => state.setActiveTab);
  const assets = useNanoEditStore((state) => state.assets);

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
          onClick={() => setActiveTab("enhancement")}
          className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === "enhancement"
              ? "bg-orange-500 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          🔧 Enhancement
        </button>
        <button
          onClick={() => setActiveTab("templates")}
          className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === "templates"
              ? "bg-orange-500 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          📋 Templates
        </button>
        <button
          onClick={() => setActiveTab("style-transfer")}
          className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === "style-transfer"
              ? "bg-orange-500 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          🎨 Style Transfer
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "image-assets" && <ImageAssetsTab />}
        {activeTab === "enhancement" && <EnhancementTab />}

        {activeTab === "templates" && (
          <div className="text-center space-y-4 max-w-md mx-auto pt-16">
            <div className="text-6xl mb-4">📋</div>
            <h3 className="text-xl font-semibold text-white">
              Template Gallery
            </h3>
            <p className="text-gray-400 leading-relaxed">
              Pre-designed templates and layouts coming soon
            </p>
          </div>
        )}

        {activeTab === "style-transfer" && (
          <div className="text-center space-y-4 max-w-md mx-auto pt-16">
            <div className="text-6xl mb-4">🎨</div>
            <h3 className="text-xl font-semibold text-white">Style Transfer</h3>
            <p className="text-gray-400 leading-relaxed">
              AI-powered style transfer and artistic effects coming soon
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default NanoEditView;
