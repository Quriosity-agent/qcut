/**
 * Reusable AI Settings Panel Component
 *
 * A collapsible container for model-specific settings with optional
 * active settings badge and consistent styling.
 *
 * @see ai-tsx-refactoring.md - Subtask 3.1
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ============================================
// Types
// ============================================

export interface AISettingsPanelProps {
	/** Panel title displayed in the header */
	title: string;
	/** Optional description shown below the title */
	description?: string;
	/** Content to render inside the panel */
	children: React.ReactNode;
	/** Whether the panel can be collapsed (default: true) */
	isCollapsible?: boolean;
	/** Initial expanded state (default: false) */
	defaultExpanded?: boolean;
	/** Controlled expanded state */
	expanded?: boolean;
	/** Callback when expanded state changes */
	onExpandedChange?: (expanded: boolean) => void;
	/** Number of active settings to show in badge (when collapsed) */
	activeSettingsCount?: number;
	/** Additional CSS classes for the container */
	className?: string;
	/** Whether to show border on top (default: true) */
	showBorderTop?: boolean;
}

// ============================================
// Component
// ============================================

/**
 * A reusable collapsible settings panel for AI model configurations.
 *
 * @example
 * ```tsx
 * // Controlled usage
 * <AISettingsPanel
 *   title="Additional Settings"
 *   expanded={settingsExpanded}
 *   onExpandedChange={setSettingsExpanded}
 *   activeSettingsCount={3}
 * >
 *   <AspectRatioSelect ... />
 *   <ResolutionSelect ... />
 * </AISettingsPanel>
 *
 * // Uncontrolled usage
 * <AISettingsPanel title="Advanced Options" defaultExpanded>
 *   <SeedInput ... />
 * </AISettingsPanel>
 *
 * // Non-collapsible
 * <AISettingsPanel title="Required Settings" isCollapsible={false}>
 *   <DurationSelect ... />
 * </AISettingsPanel>
 * ```
 */
export function AISettingsPanel({
	title,
	description,
	children,
	isCollapsible = true,
	defaultExpanded = false,
	expanded,
	onExpandedChange,
	activeSettingsCount,
	className = "",
	showBorderTop = true,
}: AISettingsPanelProps) {
	// Use controlled state if provided, otherwise use internal state
	const isControlled = expanded !== undefined && onExpandedChange !== undefined;
	const [internalOpen, setInternalOpen] = useState(defaultExpanded);

	// Determine the actual open state
	const isOpen = isControlled ? expanded : internalOpen;
	const handleOpenChange = isControlled ? onExpandedChange : setInternalOpen;

	if (!isCollapsible) {
		// Non-collapsible: just render as a simple container
		return (
			<div
				className={`space-y-4 ${showBorderTop ? "border-t pt-3" : ""} ${className}`}
			>
				<div className="text-left">
					<Label className="text-sm font-semibold">{title}</Label>
					{description && (
						<p className="text-xs text-muted-foreground mt-1">{description}</p>
					)}
				</div>
				<div className="space-y-4">{children}</div>
			</div>
		);
	}

	return (
		<Collapsible open={isOpen} onOpenChange={handleOpenChange}>
			<div className={`${showBorderTop ? "border-t pt-3" : ""} ${className}`}>
				<div className="flex items-center justify-between">
					<CollapsibleTrigger asChild>
						<Button
							type="button"
							variant="link"
							size="sm"
							className="flex items-center gap-2 p-0 h-auto"
						>
							<Label className="text-sm font-semibold cursor-pointer">
								{title}
							</Label>
							<ChevronDown
								className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
							/>
						</Button>
					</CollapsibleTrigger>

					{!isOpen && activeSettingsCount !== undefined && (
						<Badge variant="secondary" className="text-xs">
							{activeSettingsCount} active
						</Badge>
					)}
				</div>

				{description && !isOpen && (
					<p className="text-xs text-muted-foreground mt-1">{description}</p>
				)}

				<CollapsibleContent className="space-y-4 mt-4">
					{description && (
						<p className="text-xs text-muted-foreground">{description}</p>
					)}
					{children}
				</CollapsibleContent>
			</div>
		</Collapsible>
	);
}

// ============================================
// Simpler Alternative Component
// ============================================

/**
 * A simpler version that doesn't require render props.
 * Uses internal state for expansion tracking.
 */
export function AISettingsPanelSimple({
	title,
	description,
	children,
	isCollapsible = true,
	defaultExpanded = false,
	expanded,
	onExpandedChange,
	activeSettingsCount,
	className = "",
	showBorderTop = true,
}: AISettingsPanelProps) {
	// Determine current open state for chevron rotation
	const isOpen = expanded ?? defaultExpanded;

	if (!isCollapsible) {
		return (
			<div
				className={`space-y-4 ${showBorderTop ? "border-t pt-3" : ""} ${className}`}
			>
				<div className="text-left">
					<Label className="text-sm font-semibold">{title}</Label>
					{description && (
						<p className="text-xs text-muted-foreground mt-1">{description}</p>
					)}
				</div>
				<div className="space-y-4">{children}</div>
			</div>
		);
	}

	const collapsibleProps =
		expanded !== undefined && onExpandedChange
			? { open: expanded, onOpenChange: onExpandedChange }
			: { defaultOpen: defaultExpanded };

	return (
		<Collapsible {...collapsibleProps}>
			<div className={`${showBorderTop ? "border-t pt-3" : ""} ${className}`}>
				<div className="flex items-center justify-between">
					<CollapsibleTrigger asChild>
						<Button
							variant="link"
							size="sm"
							className="flex items-center gap-2 p-0 h-auto"
						>
							<Label className="text-sm font-semibold cursor-pointer">
								{title}
							</Label>
							<ChevronDown
								className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
							/>
						</Button>
					</CollapsibleTrigger>

					{!isOpen && activeSettingsCount !== undefined && (
						<Badge variant="secondary" className="text-xs">
							{activeSettingsCount} active
						</Badge>
					)}
				</div>

				<CollapsibleContent className="space-y-4 mt-4">
					{description && (
						<p className="text-xs text-muted-foreground">{description}</p>
					)}
					{children}
				</CollapsibleContent>
			</div>
		</Collapsible>
	);
}

// ============================================
// Model Settings Card (for model-specific settings)
// ============================================

export interface ModelSettingsCardProps {
	/** Model name for the header */
	modelName: string;
	/** Estimated cost to display */
	estimatedCost?: string;
	/** Whether to show the card */
	show?: boolean;
	/** Content to render */
	children: React.ReactNode;
	/** Additional tip text */
	tip?: string;
	/** Additional CSS classes */
	className?: string;
}

/**
 * A card component for model-specific settings with cost display.
 *
 * @example
 * ```tsx
 * <ModelSettingsCard
 *   modelName="Kling v2.5 Turbo"
 *   estimatedCost="$0.35"
 *   show={klingI2VSelected}
 * >
 *   <DurationSelect ... />
 *   <AspectRatioSelect ... />
 * </ModelSettingsCard>
 * ```
 */
export function ModelSettingsCard({
	modelName,
	estimatedCost,
	show = true,
	children,
	tip,
	className = "",
}: ModelSettingsCardProps) {
	if (!show) return null;

	return (
		<div className={`space-y-3 border-t pt-3 text-left ${className}`}>
			<div className="flex items-center justify-between">
				<Label className="text-xs font-semibold">{modelName} Settings</Label>
				{estimatedCost && (
					<Badge variant="outline" className="text-xs">
						Est. {estimatedCost}
					</Badge>
				)}
			</div>
			{tip && <p className="text-xs text-muted-foreground">{tip}</p>}
			<div className="space-y-3">{children}</div>
		</div>
	);
}
