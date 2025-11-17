import React from "react";
import ImageAssetsTab from "@/components/editor/nano-edit/tabs/ImageAssetsTab";

const NanoEditView: React.FC = () => {
  return (
    <div className="p-4 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">🍌 Nano Edit</h2>
        <p className="text-gray-400">AI-powered image and video enhancement</p>
      </div>

      {/* Single content area (tabs removed) */}
      <div className="flex-1 overflow-y-auto">
        <ImageAssetsTab />
      </div>
    </div>
  );
};

export default NanoEditView;