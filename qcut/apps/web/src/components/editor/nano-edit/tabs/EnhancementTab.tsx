import React from "react";
import { HistoryPanel } from "../components/HistoryPanel";
import { EffectGallery } from "../components/EffectGallery";
import { ResultDisplay } from "../components/ResultDisplay";

export const EnhancementTab: React.FC = () => {
  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="border-b border-gray-700 pb-4">
        <h3 className="text-lg font-semibold text-white mb-2">
          🔧 Enhancement Tools
        </h3>
        <p className="text-sm text-gray-400">
          Apply effects, view results, and track your editing history
        </p>
      </div>

      {/* Enhancement Tools Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          <EffectGallery />
          <HistoryPanel />
        </div>

        {/* Right Column */}
        <div>
          <ResultDisplay />
        </div>
      </div>
    </div>
  );
};

export default EnhancementTab;
