"use client";

import React from "react";
import {
	ResizablePanelGroup,
	ResizablePanel,
	ResizableHandle,
} from "../ui/resizable";
import { MediaPanel } from "./media-panel";
import { PropertiesPanel } from "./properties-panel";
import { Timeline } from "./timeline";
import { PreviewPanel } from "./preview-panel";
import { usePanelStore } from "@/stores/panel-store";

interface LayoutProps {
	resetCounter: number;
}

/** Convert a numeric size to a percentage string for react-resizable-panels v4+ */
const pct = (n: number) => `${n}%`;

export function DefaultLayout({ resetCounter }: LayoutProps) {
	const {
		toolsPanel,
		previewPanel,
		mainContent,
		timeline,
		propertiesPanel,
		setToolsPanel,
		setPreviewPanel,
		setMainContent,
		setTimeline,
		setPropertiesPanel,
	} = usePanelStore();

	const clamp = (value: number, min: number, max: number) =>
		Math.max(min, Math.min(max, value));

	// Normalize while respecting min/max constraints and keeping a strict 100% sum.
	const normalizePanels = (
		rawTools: number,
		rawPreview: number,
		rawProperties: number
	) => {
		const round2 = (v: number) => Math.round(v * 100) / 100;
		const minTools = 10;
		const maxTools = 50;
		const minPreview = 20;
		const maxPreview = 100;
		const minProps = 10;
		const maxProps = 50;

		const factor =
			rawTools + rawPreview + rawProperties !== 0
				? 100 / (rawTools + rawPreview + rawProperties)
				: 1;

		// Start from proportionally scaled values.
		let tools = round2(rawTools * factor);
		let preview = round2(rawPreview * factor);

		// Apply bounds, ensuring room for properties min.
		tools = clamp(tools, minTools, maxTools);
		const previewMaxWithRoom = Math.min(maxPreview, 100 - tools - minProps);
		preview = clamp(preview, minPreview, previewMaxWithRoom);

		let properties = round2(100 - tools - preview);

		// If properties drops below its minimum, borrow from preview then tools.
		if (properties < minProps) {
			const deficit = minProps - properties;
			const previewGive = Math.min(deficit, Math.max(0, preview - minPreview));
			preview -= previewGive;
			const remainingDeficit = deficit - previewGive;
			if (remainingDeficit > 0) {
				const toolsGive = Math.min(
					remainingDeficit,
					Math.max(0, tools - minTools)
				);
				tools -= toolsGive;
			}
			properties = minProps;
		}

		// If properties exceeds max, push excess into preview then tools.
		if (properties > maxProps) {
			const excess = properties - maxProps;
			properties = maxProps;
			const previewTake = Math.min(excess, Math.max(0, maxPreview - preview));
			preview += previewTake;
			const remainingExcess = excess - previewTake;
			if (remainingExcess > 0) {
				const toolsTake = Math.min(
					remainingExcess,
					Math.max(0, maxTools - tools)
				);
				tools += toolsTake;
			}
		}

		// Final reconciliation: let properties absorb rounding differences.
		properties = round2(100 - tools - preview);
		// Clamp properties last; if it pushes the total off 100%, we prioritize bounds.
		properties = clamp(properties, minProps, maxProps);

		return {
			normalizedTools: tools,
			normalizedPreview: preview,
			normalizedProperties: properties,
		};
	};

	const { normalizedTools, normalizedPreview, normalizedProperties } =
		normalizePanels(toolsPanel, previewPanel, propertiesPanel);

	return (
		<ResizablePanelGroup
			key={`default-${resetCounter}`}
			orientation="vertical"
			className="h-full w-full"
		>
			<ResizablePanel
				defaultSize={pct(mainContent)}
				minSize="30%"
				maxSize="85%"
				onResize={(size) => setMainContent(size.asPercentage)}
				className="min-h-0"
			>
				<ResizablePanelGroup
					orientation="horizontal"
					className="h-full w-full px-2"
				>
					<ResizablePanel
						defaultSize={pct(normalizedTools)}
						minSize="10%"
						maxSize="50%"
						onResize={(size) => setToolsPanel(size.asPercentage)}
						className="min-w-0"
					>
						<MediaPanel />
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel
						defaultSize={pct(normalizedPreview)}
						minSize="20%"
						onResize={(size) => setPreviewPanel(size.asPercentage)}
						className="min-w-0 min-h-0 flex-1"
					>
						<PreviewPanel />
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel
						defaultSize={pct(normalizedProperties)}
						minSize="10%"
						maxSize="50%"
						onResize={(size) => setPropertiesPanel(size.asPercentage)}
						className="min-w-0"
					>
						<PropertiesPanel />
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>

			<ResizableHandle withHandle />

			<ResizablePanel
				defaultSize={pct(timeline)}
				minSize="15%"
				maxSize="70%"
				onResize={(size) => setTimeline(size.asPercentage)}
				className="min-h-0 px-2 pb-2"
			>
				<Timeline />
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}

export function MediaLayout({ resetCounter }: LayoutProps) {
	const {
		toolsPanel,
		previewPanel,
		mainContent,
		timeline,
		propertiesPanel,
		setToolsPanel,
		setPreviewPanel,
		setMainContent,
		setTimeline,
		setPropertiesPanel,
	} = usePanelStore();

	// Calculate relative sizes for nested panels
	// The right group contains preview + properties and its total width is (100 - toolsPanel)
	const rightGroupTotal = Math.max(1, 100 - toolsPanel);

	// Convert from global percentages to right group percentages and ensure they sum to 100%
	const rawPreviewRelative = (previewPanel / rightGroupTotal) * 100;
	const rawPropertiesRelative = (propertiesPanel / rightGroupTotal) * 100;
	const totalRaw = rawPreviewRelative + rawPropertiesRelative;

	// Normalize to ensure total is 100%
	const previewPanelRelative =
		totalRaw > 0 ? (rawPreviewRelative / totalRaw) * 100 : 60;
	const propertiesPanelRelative =
		totalRaw > 0 ? (rawPropertiesRelative / totalRaw) * 100 : 40;

	// Debug: Verify layout normalization fix
	if (import.meta.env.DEV) {
		const total = previewPanelRelative + propertiesPanelRelative;
		if (Math.abs(total - 100) > 0.01) {
			console.warn(
				`MediaLayout: Panel sizes don't sum to 100%: ${total.toFixed(2)}%`
			);
		} else {
			console.log(
				`✅ MediaLayout: Panel sizes normalized correctly: ${total.toFixed(2)}%`
			);
		}
	}

	// Convert from right group percentage back to global percentage
	const toGlobalPreview = (rightGroupPct: number) =>
		(rightGroupPct * rightGroupTotal) / 100;
	const toGlobalProperties = (rightGroupPct: number) =>
		(rightGroupPct * rightGroupTotal) / 100;

	return (
		<ResizablePanelGroup
			key={`media-${resetCounter}`}
			orientation="horizontal"
			className="h-full w-full"
		>
			<ResizablePanel
				defaultSize={pct(toolsPanel)}
				minSize="10%"
				maxSize="50%"
				onResize={(size) => setToolsPanel(size.asPercentage)}
				className="min-w-0"
			>
				<MediaPanel />
			</ResizablePanel>

			<ResizableHandle withHandle />

			<ResizablePanel
				defaultSize={pct(100 - toolsPanel)}
				minSize="50%"
				className="min-w-0 min-h-0"
			>
				<ResizablePanelGroup
					orientation="vertical"
					className="h-full w-full"
				>
					<ResizablePanel
						defaultSize={pct(mainContent)}
						minSize="30%"
						maxSize="85%"
						onResize={(size) => setMainContent(size.asPercentage)}
						className="min-h-0"
					>
						<ResizablePanelGroup
							orientation="horizontal"
							className="h-full w-full px-2"
						>
							<ResizablePanel
								defaultSize={pct(previewPanelRelative)}
								minSize="20%"
								onResize={(size) =>
									setPreviewPanel(toGlobalPreview(size.asPercentage))
								}
								className="min-w-0 min-h-0 flex-1"
							>
								<PreviewPanel />
							</ResizablePanel>

							<ResizableHandle withHandle />

							<ResizablePanel
								defaultSize={pct(propertiesPanelRelative)}
								minSize="10%"
								maxSize="50%"
								onResize={(size) =>
									setPropertiesPanel(toGlobalProperties(size.asPercentage))
								}
								className="min-w-0"
							>
								<PropertiesPanel />
							</ResizablePanel>
						</ResizablePanelGroup>
					</ResizablePanel>

					<ResizableHandle withHandle />

					<ResizablePanel
						defaultSize={pct(timeline)}
						minSize="15%"
						maxSize="70%"
						onResize={(size) => setTimeline(size.asPercentage)}
						className="min-h-0 px-2 pb-2"
					>
						<Timeline />
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}

export function InspectorLayout({ resetCounter }: LayoutProps) {
	const {
		toolsPanel,
		previewPanel,
		mainContent,
		timeline,
		propertiesPanel,
		setToolsPanel,
		setPreviewPanel,
		setMainContent,
		setTimeline,
		setPropertiesPanel,
	} = usePanelStore();

	// Calculate relative sizes for nested panels
	// The left group contains tools + preview and its total width is (100 - propertiesPanel)
	const leftGroupTotal = Math.max(1, 100 - propertiesPanel);

	// Convert from global percentages to left group percentages and ensure they sum to 100%
	const rawToolsRelative = (toolsPanel / leftGroupTotal) * 100;
	const rawPreviewRelative = (previewPanel / leftGroupTotal) * 100;
	const totalRaw = rawToolsRelative + rawPreviewRelative;

	// Normalize to ensure total is 100%
	const toolsPanelRelative =
		totalRaw > 0 ? (rawToolsRelative / totalRaw) * 100 : 30;
	const previewPanelRelative =
		totalRaw > 0 ? (rawPreviewRelative / totalRaw) * 100 : 70;

	// Debug: Verify layout normalization fix
	if (import.meta.env.DEV) {
		const total = toolsPanelRelative + previewPanelRelative;
		if (Math.abs(total - 100) > 0.01) {
			console.warn(
				`InspectorLayout: Panel sizes don't sum to 100%: ${total.toFixed(2)}%`
			);
		} else {
			console.log(
				`✅ InspectorLayout: Panel sizes normalized correctly: ${total.toFixed(2)}%`
			);
		}
	}

	// Convert from left group percentage back to global percentage
	const toGlobalTools = (leftGroupPct: number) =>
		(leftGroupPct * leftGroupTotal) / 100;
	const toGlobalPreview = (leftGroupPct: number) =>
		(leftGroupPct * leftGroupTotal) / 100;

	return (
		<ResizablePanelGroup
			key={`inspector-${resetCounter}`}
			orientation="horizontal"
			className="h-full w-full px-3 pb-3"
		>
			<ResizablePanel
				defaultSize={pct(toolsPanel + previewPanel)}
				minSize="50%"
			>
				<ResizablePanelGroup
					orientation="vertical"
					className="h-full w-full"
				>
					<ResizablePanel
						defaultSize={pct(mainContent)}
						minSize="30%"
						onResize={(size) => setMainContent(size.asPercentage)}
					>
						<ResizablePanelGroup
							orientation="horizontal"
							className="h-full w-full"
						>
							<ResizablePanel
								defaultSize={pct(toolsPanelRelative)}
								minSize="10%"
								onResize={(size) =>
									setToolsPanel(toGlobalTools(size.asPercentage))
								}
							>
								<MediaPanel />
							</ResizablePanel>
							<ResizableHandle withHandle />
							<ResizablePanel
								defaultSize={pct(previewPanelRelative)}
								minSize="20%"
								onResize={(size) =>
									setPreviewPanel(toGlobalPreview(size.asPercentage))
								}
							>
								<PreviewPanel />
							</ResizablePanel>
						</ResizablePanelGroup>
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel
						defaultSize={pct(timeline)}
						minSize="15%"
						onResize={(size) => setTimeline(size.asPercentage)}
					>
						<Timeline />
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>
			<ResizableHandle withHandle />
			<ResizablePanel
				defaultSize={pct(propertiesPanel)}
				minSize="10%"
				maxSize="50%"
				onResize={(size) => setPropertiesPanel(size.asPercentage)}
			>
				<PropertiesPanel />
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}

export function VerticalPreviewLayout({ resetCounter }: LayoutProps) {
	const {
		toolsPanel,
		previewPanel,
		mainContent,
		timeline,
		propertiesPanel,
		setToolsPanel,
		setPreviewPanel,
		setMainContent,
		setTimeline,
		setPropertiesPanel,
	} = usePanelStore();

	// Calculate relative sizes for nested panels
	// The left group contains tools + properties and its total width is (100 - previewPanel)
	const leftGroupTotal = Math.max(1, 100 - previewPanel);

	// Convert from global percentages to left group percentages and ensure they sum to 100%
	const rawToolsRelative = (toolsPanel / leftGroupTotal) * 100;
	const rawPropertiesRelative = (propertiesPanel / leftGroupTotal) * 100;
	const totalRaw = rawToolsRelative + rawPropertiesRelative;

	// Normalize to ensure total is 100%
	const toolsPanelRelative =
		totalRaw > 0 ? (rawToolsRelative / totalRaw) * 100 : 50;
	const propertiesPanelRelative =
		totalRaw > 0 ? (rawPropertiesRelative / totalRaw) * 100 : 50;

	// Debug: Verify layout normalization fix
	if (import.meta.env.DEV) {
		const total = toolsPanelRelative + propertiesPanelRelative;
		if (Math.abs(total - 100) > 0.01) {
			console.warn(
				`VerticalPreviewLayout: Panel sizes don't sum to 100%: ${total.toFixed(2)}%`
			);
		} else {
			console.log(
				`✅ VerticalPreviewLayout: Panel sizes normalized correctly: ${total.toFixed(2)}%`
			);
		}
	}

	// Convert from left group percentage back to global percentage
	const toGlobalTools = (leftGroupPct: number) =>
		(leftGroupPct * leftGroupTotal) / 100;
	const toGlobalProperties = (leftGroupPct: number) =>
		(leftGroupPct * leftGroupTotal) / 100;

	return (
		<ResizablePanelGroup
			key={`vertical-preview-${resetCounter}`}
			orientation="horizontal"
			className="h-full w-full px-3 pb-3"
		>
			<ResizablePanel
				defaultSize={pct(toolsPanel + propertiesPanel)}
				minSize="50%"
			>
				<ResizablePanelGroup
					orientation="vertical"
					className="h-full w-full"
				>
					<ResizablePanel
						defaultSize={pct(mainContent)}
						minSize="30%"
						onResize={(size) => setMainContent(size.asPercentage)}
					>
						<ResizablePanelGroup
							orientation="horizontal"
							className="h-full w-full"
						>
							<ResizablePanel
								defaultSize={pct(toolsPanelRelative)}
								minSize="15%"
								onResize={(size) =>
									setToolsPanel(toGlobalTools(size.asPercentage))
								}
							>
								<MediaPanel />
							</ResizablePanel>
							<ResizableHandle withHandle />
							<ResizablePanel
								defaultSize={pct(propertiesPanelRelative)}
								minSize="15%"
								onResize={(size) =>
									setPropertiesPanel(toGlobalProperties(size.asPercentage))
								}
							>
								<PropertiesPanel />
							</ResizablePanel>
						</ResizablePanelGroup>
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel
						defaultSize={pct(timeline)}
						minSize="15%"
						onResize={(size) => setTimeline(size.asPercentage)}
					>
						<Timeline />
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>
			<ResizableHandle withHandle />
			<ResizablePanel
				defaultSize={pct(previewPanel)}
				minSize="20%"
				onResize={(size) => setPreviewPanel(size.asPercentage)}
			>
				<PreviewPanel />
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
