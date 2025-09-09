import React, { useState, useEffect } from "react";
import { useEffectsStore } from "@/stores/effects-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EFFECT_TEMPLATES,
  loadCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  applyTemplate,
  type EffectTemplate,
} from "@/lib/effects-templates";
import {
  Search,
  Plus,
  Download,
  Upload,
  Trash2,
  Save,
  Star,
  Film,
  Palette,
  Clock,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

interface EffectTemplatesPanelProps {
  elementId: string;
  onApply?: () => void;
}

export function EffectTemplatesPanel({
  elementId,
  onApply,
}: EffectTemplatesPanelProps) {
  const { applyEffect, getElementEffects } = useEffectsStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [customTemplates, setCustomTemplates] = useState<EffectTemplate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateDescription, setNewTemplateDescription] = useState("");

  useEffect(() => {
    setCustomTemplates(loadCustomTemplates());
  }, []);

  const allTemplates = [...EFFECT_TEMPLATES, ...customTemplates];

  const filteredTemplates = allTemplates.filter((template) => {
    const matchesSearch =
      !searchQuery ||
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === "all" || template.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const handleApplyTemplate = (template: EffectTemplate) => {
    const effects = applyTemplate(template);
    
    // Apply each effect from the template
    effects.forEach((effect) => {
      const preset = {
        id: effect.id,
        name: effect.name,
        description: `Part of ${template.name} template`,
        category: "basic" as const,
        icon: "✨",
        parameters: effect.parameters,
      };
      applyEffect(elementId, preset);
    });

    toast.success(`Applied template: ${template.name}`);
    onApply?.();
  };

  const handleSaveAsTemplate = () => {
    const currentEffects = getElementEffects(elementId);
    
    if (currentEffects.length === 0) {
      toast.error("No effects to save as template");
      return;
    }

    if (!newTemplateName.trim()) {
      toast.error("Please enter a template name");
      return;
    }

    const template = saveCustomTemplate(
      newTemplateName,
      newTemplateDescription || "Custom effect template",
      currentEffects
    );

    setCustomTemplates([...customTemplates, template]);
    setIsCreating(false);
    setNewTemplateName("");
    setNewTemplateDescription("");
    
    toast.success(`Saved template: ${template.name}`);
  };

  const handleDeleteTemplate = (templateId: string) => {
    deleteCustomTemplate(templateId);
    setCustomTemplates(customTemplates.filter((t) => t.id !== templateId));
    toast.info("Template deleted");
  };

  const handleExportTemplate = (template: EffectTemplate) => {
    const json = JSON.stringify(template, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${template.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Template exported");
  };

  const handleImportTemplate = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const template = JSON.parse(e.target?.result as string);
        if (template && template.name && template.effects) {
          template.id = crypto.randomUUID(); // Generate new ID
          template.category = "custom";
          const templates = [...customTemplates, template];
          localStorage.setItem("effect-templates-custom", JSON.stringify(templates));
          setCustomTemplates(templates);
          toast.success(`Imported template: ${template.name}`);
        } else {
          toast.error("Invalid template format");
        }
      } catch (error) {
        toast.error("Failed to import template");
      }
    };
    reader.readAsText(file);
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "professional":
        return <Film className="h-4 w-4" />;
      case "creative":
        return <Palette className="h-4 w-4" />;
      case "vintage":
        return <Clock className="h-4 w-4" />;
      case "modern":
        return <Sparkles className="h-4 w-4" />;
      case "custom":
        return <Star className="h-4 w-4" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Effect Templates</h3>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsCreating(!isCreating)}
          >
            <Save className="h-4 w-4 mr-1" />
            Save Current
          </Button>
          <label>
            <Button size="sm" variant="outline" asChild>
              <span>
                <Upload className="h-4 w-4 mr-1" />
                Import
              </span>
            </Button>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportTemplate}
            />
          </label>
        </div>
      </div>

      {/* Save Template Form */}
      {isCreating && (
        <Card className="p-4">
          <div className="space-y-3">
            <Input
              placeholder="Template name..."
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
            />
            <Input
              placeholder="Description (optional)..."
              value={newTemplateDescription}
              onChange={(e) => setNewTemplateDescription(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveAsTemplate}>
                Save Template
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setIsCreating(false);
                  setNewTemplateName("");
                  setNewTemplateDescription("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Categories */}
      <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="professional">Pro</TabsTrigger>
          <TabsTrigger value="creative">Creative</TabsTrigger>
          <TabsTrigger value="vintage">Vintage</TabsTrigger>
          <TabsTrigger value="modern">Modern</TabsTrigger>
          <TabsTrigger value="custom">Custom</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedCategory} className="mt-4">
          <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto">
            {filteredTemplates.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No templates found
              </p>
            ) : (
              filteredTemplates.map((template) => (
                <Card
                  key={template.id}
                  className="p-4 hover:bg-accent/50 transition-colors cursor-pointer"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {getCategoryIcon(template.category)}
                        <h4 className="font-medium">{template.name}</h4>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="text"
                          onClick={() => handleApplyTemplate(template)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="text"
                          onClick={() => handleExportTemplate(template)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {template.category === "custom" && (
                          <Button
                            size="icon"
                            variant="text"
                            onClick={() => handleDeleteTemplate(template.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground">
                      {template.description}
                    </p>

                    <div className="flex flex-wrap gap-1">
                      {template.effects.map((effect) => (
                        <span
                          key={`${template.id}-${effect.type}-${effect.order}`}
                          className="text-xs px-2 py-1 bg-muted rounded"
                        >
                          {effect.name}
                        </span>
                      ))}
                    </div>

                    {template.metadata && (
                      <div className="text-xs text-muted-foreground">
                        {template.metadata.author && (
                          <span>By {template.metadata.author}</span>
                        )}
                        {template.metadata.tags && (
                          <div className="flex gap-1 mt-1">
                            {template.metadata.tags.map((tag) => (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 bg-secondary rounded"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}