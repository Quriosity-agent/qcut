import React, { useState } from "react";
import { AssetTemplate } from "../constants/templates";

interface TemplateSelectorProps {
  templates: AssetTemplate[];
  onTemplateSelect: (template: AssetTemplate) => void;
  disabled?: boolean;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  templates,
  onTemplateSelect,
  disabled = false,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Get unique categories
  const categories = [
    "all",
    ...Array.from(new Set(templates.map((t) => t.category))),
  ];

  // Filter templates by category
  const filteredTemplates =
    selectedCategory === "all"
      ? templates
      : templates.filter((t) => t.category === selectedCategory);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-medium text-gray-300">Quick Templates</h5>
        <span className="text-xs text-gray-500">
          {filteredTemplates.length} templates
        </span>
      </div>

      {/* Category Filter */}
      {categories.length > 2 && (
        <div className="flex gap-2 flex-wrap">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              disabled={disabled}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                selectedCategory === category
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Templates Grid */}
      <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto">
        {filteredTemplates.map((template) => (
          <button
            key={template.id}
            onClick={() => onTemplateSelect(template)}
            disabled={disabled}
            className="text-left p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate">
                  {template.name}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {template.description}
                </div>
              </div>
              <div className="ml-2 flex-shrink-0">
                <span className="text-xs text-gray-500 bg-gray-800 px-1 py-0.5 rounded">
                  {template.dimensions}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {filteredTemplates.length === 0 && (
        <div className="text-center py-4 text-gray-400 text-sm">
          No templates found for "{selectedCategory}" category
        </div>
      )}
    </div>
  );
};

export default TemplateSelector;
