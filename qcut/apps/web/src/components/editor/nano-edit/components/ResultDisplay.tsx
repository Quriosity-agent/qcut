import React, { useState } from "react";
import { useNanoEditStore } from "@/stores/nano-edit-store";
import { downloadImage } from "@/lib/utils/nano-edit-utils";
import {
  DownloadIcon,
  EyeIcon,
  TrashIcon,
  CopyIcon,
  ShareIcon,
  ImageIcon,
  VideoIcon,
  StarIcon,
} from "lucide-react";

export const ResultDisplay: React.FC = () => {
  const { assets, removeAsset } = useNanoEditStore();
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filterType, setFilterType] = useState<string>("all");

  const assetTypes = ["all", ...Array.from(new Set(assets.map((a) => a.type)))];

  const filteredAssets =
    filterType === "all" ? assets : assets.filter((a) => a.type === filterType);

  const sortedAssets = [...filteredAssets].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  const handleDownload = (asset: any) => {
    const filename = `${asset.type}-${asset.id.slice(0, 8)}.png`;
    downloadImage(asset.url, filename);
  };

  const handleCopyUrl = async (asset: any) => {
    try {
      await navigator.clipboard.writeText(asset.url);
      // In a real implementation, you'd show a toast notification here
      console.log("URL copied to clipboard");
    } catch (error) {
      console.error("Failed to copy URL:", error);
    }
  };

  const handleShare = (asset: any) => {
    if (navigator.share) {
      navigator.share({
        title: `${asset.type} - Nano Edit`,
        text: `Check out this ${asset.type} I created with AI`,
        url: asset.url,
      });
    } else {
      handleCopyUrl(asset);
    }
  };

  const getAssetIcon = (type: string) => {
    switch (type) {
      case "thumbnail":
        return "🖼️";
      case "title-card":
        return "🎬";
      case "logo":
        return "✨";
      case "overlay":
        return "🎭";
      default:
        return "🎯";
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const AssetCard: React.FC<{ asset: any; isSelected: boolean }> = ({
    asset,
    isSelected,
  }) => (
    <div
      className={`relative group bg-gray-700 rounded-lg overflow-hidden transition-all cursor-pointer ${
        isSelected ? "ring-2 ring-blue-500" : "hover:bg-gray-600"
      }`}
      onClick={() => setSelectedAsset(isSelected ? null : asset.id)}
    >
      {/* Image */}
      <div className="aspect-video bg-gray-800 flex items-center justify-center relative">
        <img
          src={asset.url}
          alt={asset.prompt || asset.type}
          className="w-full h-full object-cover"
          loading="lazy"
        />

        {/* Overlay Controls */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.open(asset.url, "_blank");
            }}
            className="p-2 bg-black/70 text-white rounded-full hover:bg-black/90 transition-colors"
            title="View Full Size"
          >
            <EyeIcon className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDownload(asset);
            }}
            className="p-2 bg-black/70 text-white rounded-full hover:bg-black/90 transition-colors"
            title="Download"
          >
            <DownloadIcon className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleShare(asset);
            }}
            className="p-2 bg-black/70 text-white rounded-full hover:bg-black/90 transition-colors"
            title="Share"
          >
            <ShareIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Asset Type Badge */}
        <div className="absolute top-2 left-2 px-2 py-1 bg-black/70 text-white text-xs rounded flex items-center gap-1">
          <span>{getAssetIcon(asset.type)}</span>
          <span className="capitalize">{asset.type.replace("-", " ")}</span>
        </div>

        {/* Dimensions Badge */}
        <div className="absolute top-2 right-2 px-2 py-1 bg-black/70 text-white text-xs rounded">
          {asset.dimensions}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium truncate">
              {asset.prompt || `${asset.type} ${asset.id.slice(0, 8)}`}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {formatDate(asset.createdAt)}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeAsset?.(asset.id);
            }}
            className="p-1 text-gray-400 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
            title="Delete"
          >
            <TrashIcon className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-2xl">🖼️</div>
          <div>
            <h4 className="font-semibold text-white">Generated Assets</h4>
            <p className="text-sm text-gray-400">
              {assets.length} total assets
            </p>
          </div>
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2 rounded transition-colors ${
              viewMode === "grid"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            <div className="w-4 h-4 grid grid-cols-2 gap-0.5">
              <div className="bg-current rounded-sm"></div>
              <div className="bg-current rounded-sm"></div>
              <div className="bg-current rounded-sm"></div>
              <div className="bg-current rounded-sm"></div>
            </div>
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 rounded transition-colors ${
              viewMode === "list"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            <div className="w-4 h-4 space-y-1">
              <div className="h-1 bg-current rounded"></div>
              <div className="h-1 bg-current rounded"></div>
              <div className="h-1 bg-current rounded"></div>
            </div>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {assetTypes.map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              filterType === type
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {type === "all" ? "🌟" : getAssetIcon(type)}{" "}
            {type.charAt(0).toUpperCase() + type.slice(1).replace("-", " ")}
          </button>
        ))}
      </div>

      {/* Assets Display */}
      <div className="max-h-96 overflow-y-auto">
        {sortedAssets.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <div className="text-6xl mb-4">🎨</div>
            <div className="text-lg font-medium">No assets yet</div>
            <div className="text-sm mt-2">
              Generate your first {filterType === "all" ? "asset" : filterType}{" "}
              to see it here
            </div>
          </div>
        ) : (
          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-2 lg:grid-cols-3 gap-3"
                : "space-y-2"
            }
          >
            {sortedAssets.map((asset) =>
              viewMode === "grid" ? (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  isSelected={selectedAsset === asset.id}
                />
              ) : (
                <div
                  key={asset.id}
                  className="flex items-center gap-3 p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors cursor-pointer group"
                  onClick={() =>
                    setSelectedAsset(
                      selectedAsset === asset.id ? null : asset.id
                    )
                  }
                >
                  <img
                    src={asset.url}
                    alt={asset.prompt || asset.type}
                    className="w-12 h-12 object-cover rounded"
                    loading="lazy"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">
                      {asset.prompt || `${asset.type} ${asset.id.slice(0, 8)}`}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                      <span>
                        {getAssetIcon(asset.type)} {asset.type}
                      </span>
                      <span>•</span>
                      <span>{asset.dimensions}</span>
                      <span>•</span>
                      <span>{formatDate(asset.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(asset);
                      }}
                      className="p-1 text-gray-400 hover:text-white transition-colors"
                    >
                      <DownloadIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAsset?.(asset.id);
                      }}
                      className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {assets.length > 0 && (
        <div className="border-t border-gray-700 pt-3">
          <div className="grid grid-cols-4 gap-4 text-center">
            {assetTypes.slice(1).map((type) => {
              const count = assets.filter((a) => a.type === type).length;
              return (
                <div key={type} className="text-xs text-gray-400">
                  <div className="text-lg">{getAssetIcon(type)}</div>
                  <div className="font-medium text-white">{count}</div>
                  <div className="capitalize">{type.replace("-", " ")}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultDisplay;
