import React from "react";
import { ThumbnailGenerator } from "../components/ThumbnailGenerator";
import { TitleCardCreator } from "../components/TitleCardCreator";
import { LogoEnhancer } from "../components/LogoEnhancer";

export const ImageAssetsTab: React.FC = () => {
  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="border-b border-gray-700 pb-4">
        <h3 className="text-lg font-semibold text-white mb-2">
          📷 Image Assets
        </h3>
        <p className="text-sm text-gray-400">
          Generate thumbnails, title cards, and enhance logos for your project
        </p>
      </div>

      {/* Asset Generators */}
      <div className="space-y-6">
        <ThumbnailGenerator />
        <TitleCardCreator />
        <LogoEnhancer />
      </div>
    </div>
  );
};

export default ImageAssetsTab;
