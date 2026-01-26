/**
 * Component Import Dialog
 *
 * Dialog for importing custom Remotion components from .tsx files.
 * Handles file selection, validation, and import process.
 *
 * @module components/editor/media-panel/views/remotion/component-import-dialog
 */

"use client";

import { useCallback, useState, useRef } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  FileCode,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { loadComponentFromFile, type LoadResult } from "@/lib/remotion/component-loader";
import { validateComponent, type ValidationResult } from "@/lib/remotion/component-validator";
import { useRemotionStore } from "@/stores/remotion-store";

// ============================================================================
// Types
// ============================================================================

export interface ComponentImportDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog is closed */
  onOpenChange: (open: boolean) => void;
  /** Callback when import is successful */
  onImportSuccess?: (componentId: string) => void;
}

interface ImportState {
  /** Current import status */
  status: "idle" | "validating" | "importing" | "success" | "error";
  /** Selected file */
  file: File | null;
  /** Validation result */
  validation: ValidationResult | null;
  /** Load result */
  loadResult: LoadResult | null;
  /** Error message */
  error: string | null;
}

// ============================================================================
// Component
// ============================================================================

export function ComponentImportDialog({
  open,
  onOpenChange,
  onImportSuccess,
}: ComponentImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportState>({
    status: "idle",
    file: null,
    validation: null,
    loadResult: null,
    error: null,
  });
  const [isDragging, setIsDragging] = useState(false);

  const { registerComponent } = useRemotionStore();

  // Reset state when dialog opens/closes
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setState({
          status: "idle",
          file: null,
          validation: null,
          loadResult: null,
          error: null,
        });
      }
      onOpenChange(open);
    },
    [onOpenChange]
  );

  // Handle file selection
  const handleFileSelect = useCallback(async (file: File) => {
    // Check file type
    if (!file.name.endsWith(".tsx") && !file.name.endsWith(".ts")) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: "Only .tsx and .ts files are supported",
      }));
      return;
    }

    // Check file size (max 500KB)
    if (file.size > 500 * 1024) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: "File size exceeds 500KB limit",
      }));
      return;
    }

    setState({
      status: "validating",
      file,
      validation: null,
      loadResult: null,
      error: null,
    });

    try {
      // Read and validate file
      const code = await file.text();
      const validation = validateComponent(code);

      setState((prev) => ({
        ...prev,
        status: validation.valid ? "idle" : "error",
        validation,
        error: validation.valid ? null : validation.errors.join("; "),
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
      }));
    }
  }, []);

  // Handle file input change
  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  // Handle drag and drop
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);

      const file = event.dataTransfer.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  // Handle import
  const handleImport = useCallback(async () => {
    if (!state.file || !state.validation?.valid) {
      return;
    }

    setState((prev) => ({ ...prev, status: "importing" }));

    try {
      const result = await loadComponentFromFile(state.file, {
        sandbox: true,
        storeInDB: true,
      });

      if (result.success && result.component) {
        // Register the component
        registerComponent(result.component);

        setState((prev) => ({
          ...prev,
          status: "success",
          loadResult: result,
        }));

        toast.success(`Imported "${result.component.name}" successfully`);
        onImportSuccess?.(result.component.id);

        // Close dialog after a short delay
        setTimeout(() => {
          handleOpenChange(false);
        }, 1500);
      } else {
        setState((prev) => ({
          ...prev,
          status: "error",
          loadResult: result,
          error: result.error || "Failed to import component",
        }));
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: `Import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      }));
    }
  }, [state.file, state.validation, registerComponent, onImportSuccess, handleOpenChange]);

  // Render validation status
  const renderValidationStatus = () => {
    if (!state.validation) return null;

    const { valid, errors, warnings, metadata } = state.validation;

    return (
      <div className="space-y-3">
        {/* Status Badge */}
        <div className="flex items-center gap-2">
          {valid ? (
            <Badge variant="default" className="bg-green-600 gap-1">
              <CheckCircle className="h-3 w-3" />
              Valid
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              Invalid
            </Badge>
          )}
          {warnings.length > 0 && (
            <Badge variant="secondary" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {warnings.length} warning{warnings.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
            <p className="text-sm font-medium text-red-400 mb-2">Errors:</p>
            <ul className="text-sm text-red-300 space-y-1">
              {errors.map((error, i) => (
                <li key={i} className="flex items-start gap-2">
                  <X className="h-4 w-4 shrink-0 mt-0.5" />
                  {error}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3">
            <p className="text-sm font-medium text-yellow-400 mb-2">Warnings:</p>
            <ul className="text-sm text-yellow-300 space-y-1">
              {warnings.map((warning, i) => (
                <li key={i} className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Metadata */}
        {valid && metadata && (
          <div className="bg-muted/50 rounded-md p-3 space-y-2">
            <p className="text-sm font-medium">Detected Metadata:</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Name:</span>{" "}
                <span className="font-medium">{metadata.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Category:</span>{" "}
                <span className="font-medium capitalize">{metadata.category}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Duration:</span>{" "}
                <span className="font-medium">{metadata.durationInFrames} frames</span>
              </div>
              <div>
                <span className="text-muted-foreground">Size:</span>{" "}
                <span className="font-medium">
                  {metadata.width}×{metadata.height}
                </span>
              </div>
            </div>
            {metadata.description && (
              <p className="text-sm text-muted-foreground">{metadata.description}</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode className="h-5 w-5 text-violet-400" />
            Import Remotion Component
          </DialogTitle>
          <DialogDescription>
            Import a custom Remotion component from a .tsx or .ts file.
            Components will be validated for security before import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Drop Zone */}
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
              isDragging
                ? "border-violet-500 bg-violet-500/10"
                : "border-border hover:border-muted-foreground",
              state.status === "error" && "border-red-500/50 bg-red-500/5"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".tsx,.ts"
              onChange={handleFileInputChange}
              className="hidden"
            />

            {state.status === "validating" ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Validating component...</p>
              </div>
            ) : state.status === "importing" ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-10 w-10 animate-spin text-violet-400" />
                <p className="text-sm text-muted-foreground">Importing component...</p>
              </div>
            ) : state.status === "success" ? (
              <div className="flex flex-col items-center gap-2">
                <CheckCircle className="h-10 w-10 text-green-500" />
                <p className="text-sm text-green-400">Import successful!</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {state.file
                    ? state.file.name
                    : "Drop a .tsx file here or click to browse"}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Maximum file size: 500KB
                </p>
              </div>
            )}
          </div>

          {/* Validation Results */}
          {state.validation && (
            <ScrollArea className="max-h-[300px]">
              {renderValidationStatus()}
            </ScrollArea>
          )}

          {/* Error Display */}
          {state.status === "error" && state.error && !state.validation && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
              <p className="text-sm text-red-400">{state.error}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={state.status === "importing"}
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={
              !state.file ||
              !state.validation?.valid ||
              state.status === "importing" ||
              state.status === "success"
            }
            className="gap-1"
          >
            {state.status === "importing" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Import Component
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ComponentImportDialog;
