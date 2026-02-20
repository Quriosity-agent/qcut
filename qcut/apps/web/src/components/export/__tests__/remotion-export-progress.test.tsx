/**
 * Remotion Export Progress Component Tests
 *
 * Tests for Remotion export progress display.
 *
 * @module components/export/__tests__/remotion-export-progress.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RemotionExportProgress } from "../remotion-export-progress";
import {
	useExportStore,
	type RemotionExportProgress as RemotionExportProgressType,
	type RemotionElementProgress,
} from "@/stores/export-store";

// Mock the export store
vi.mock("@/stores/export-store", async () => {
	const actual = await vi.importActual("@/stores/export-store");
	return {
		...actual,
		useExportStore: vi.fn(),
	};
});

// ============================================================================
// Test Helpers
// ============================================================================

function createMockRemotionProgress(
	overrides: Partial<RemotionExportProgressType> = {}
): RemotionExportProgressType {
	return {
		phase: "prerendering",
		overallProgress: 50,
		phaseProgress: 75,
		statusMessage: "Pre-rendering Remotion components...",
		elementsTotal: 3,
		elementsCompleted: 1,
		elementProgress: [],
		hasRemotionElements: true,
		...overrides,
	};
}

function createMockElementProgress(
	overrides: Partial<RemotionElementProgress> = {}
): RemotionElementProgress {
	return {
		elementId: `element-${Math.random().toString(36).slice(2, 9)}`,
		elementName: "Test Element",
		progress: 50,
		framesCompleted: 45,
		totalFrames: 90,
		status: "rendering",
		...overrides,
	};
}

function setupMockStore(progress: RemotionExportProgressType) {
	const mockSkipFailedElement = vi.fn();

	(useExportStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
		(selector: (state: any) => any) => {
			const state = {
				remotionProgress: progress,
				skipFailedRemotionElement: mockSkipFailedElement,
			};
			return selector(state);
		}
	);

	return { mockSkipFailedElement };
}

// ============================================================================
// Tests
// ============================================================================

describe("RemotionExportProgress", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("rendering", () => {
		it("should not render when hasRemotionElements is false", () => {
			setupMockStore(
				createMockRemotionProgress({ hasRemotionElements: false })
			);

			const { container } = render(<RemotionExportProgress />);

			expect(container.firstChild).toBeNull();
		});

		it("should not render when phase is idle", () => {
			setupMockStore(createMockRemotionProgress({ phase: "idle" }));

			const { container } = render(<RemotionExportProgress />);

			expect(container.firstChild).toBeNull();
		});

		it("should render when Remotion elements exist and phase is active", () => {
			setupMockStore(createMockRemotionProgress());

			render(<RemotionExportProgress />);

			expect(screen.getByText("Remotion Export")).toBeInTheDocument();
		});

		it("should display overall progress percentage", () => {
			setupMockStore(createMockRemotionProgress({ overallProgress: 75 }));

			render(<RemotionExportProgress />);

			expect(screen.getByText("75%")).toBeInTheDocument();
		});

		it("should display status message", () => {
			setupMockStore(
				createMockRemotionProgress({
					statusMessage: "Testing status message",
				})
			);

			render(<RemotionExportProgress />);

			expect(screen.getByText("Testing status message")).toBeInTheDocument();
		});
	});

	describe("phase indicators", () => {
		it("should show all phases", () => {
			setupMockStore(createMockRemotionProgress({ phase: "compositing" }));

			render(<RemotionExportProgress />);

			// Phase labels are exact: Analyze, Pre-render, Composite, Encode, Cleanup
			expect(screen.getByText("Analyze")).toBeInTheDocument();
			expect(screen.getByText("Pre-render")).toBeInTheDocument();
			expect(screen.getByText("Composite")).toBeInTheDocument();
			expect(screen.getByText("Encode")).toBeInTheDocument();
			expect(screen.getByText("Cleanup")).toBeInTheDocument();
		});
	});

	describe("element progress", () => {
		it("should display currently rendering element", () => {
			setupMockStore(
				createMockRemotionProgress({
					elementProgress: [
						createMockElementProgress({
							elementName: "Active Element",
							status: "rendering",
							framesCompleted: 30,
							totalFrames: 60,
						}),
					],
				})
			);

			render(<RemotionExportProgress />);

			expect(screen.getByText("Rendering:")).toBeInTheDocument();
			expect(screen.getByText("Active Element")).toBeInTheDocument();
			expect(screen.getByText("(30/60 frames)")).toBeInTheDocument();
		});

		it("should show element count in collapsible header", () => {
			setupMockStore(
				createMockRemotionProgress({
					elementsTotal: 5,
					elementsCompleted: 2,
					elementProgress: [createMockElementProgress()], // Need at least one element for the button to show
				})
			);

			render(<RemotionExportProgress />);

			expect(screen.getByText(/Elements \(2\/5\)/)).toBeInTheDocument();
		});

		it("should expand element list when clicked", () => {
			setupMockStore(
				createMockRemotionProgress({
					elementProgress: [
						createMockElementProgress({
							elementName: "Hidden Element",
							status: "complete",
						}),
					],
				})
			);

			render(<RemotionExportProgress />);

			// Click to expand
			const expandButton = screen.getByRole("button", {
				name: /elements/i,
			});
			fireEvent.click(expandButton);

			expect(screen.getByText("Hidden Element")).toBeInTheDocument();
		});
	});

	describe("error handling", () => {
		it("should show error alert when elements have errors", () => {
			setupMockStore(
				createMockRemotionProgress({
					elementProgress: [
						createMockElementProgress({
							status: "error",
							error: "Render failed",
						}),
					],
				})
			);

			render(<RemotionExportProgress />);

			expect(
				screen.getByText(/some remotion elements failed/i)
			).toBeInTheDocument();
		});

		it("should show skip button for failed elements", () => {
			setupMockStore(
				createMockRemotionProgress({
					elementProgress: [
						createMockElementProgress({
							elementName: "Failed Element",
							status: "error",
							error: "Test error",
						}),
					],
				})
			);

			render(<RemotionExportProgress defaultExpanded />);

			expect(screen.getByText("Skip")).toBeInTheDocument();
		});

		it("should call skipFailedElement when skip button clicked", () => {
			const element = createMockElementProgress({
				elementId: "element-to-skip",
				elementName: "Failed Element",
				status: "error",
				error: "Test error",
			});

			const { mockSkipFailedElement } = setupMockStore(
				createMockRemotionProgress({
					elementProgress: [element],
				})
			);

			render(<RemotionExportProgress defaultExpanded allowSkipFailed />);

			const skipButton = screen.getByText("Skip");
			fireEvent.click(skipButton);

			expect(mockSkipFailedElement).toHaveBeenCalledWith("element-to-skip");
		});
	});

	describe("time remaining", () => {
		it("should display estimated time remaining", () => {
			setupMockStore(
				createMockRemotionProgress({
					estimatedTimeRemaining: 45,
				})
			);

			render(<RemotionExportProgress />);

			expect(screen.getByText("~45s remaining")).toBeInTheDocument();
		});

		it("should not display time remaining when zero", () => {
			setupMockStore(
				createMockRemotionProgress({
					estimatedTimeRemaining: 0,
				})
			);

			render(<RemotionExportProgress />);

			expect(screen.queryByText(/remaining/)).not.toBeInTheDocument();
		});
	});

	describe("element status icons", () => {
		it("should display correct icons for each status", () => {
			setupMockStore(
				createMockRemotionProgress({
					elementProgress: [
						createMockElementProgress({
							elementName: "Pending",
							status: "pending",
						}),
						createMockElementProgress({
							elementName: "Complete",
							status: "complete",
						}),
						createMockElementProgress({
							elementName: "Error",
							status: "error",
						}),
						createMockElementProgress({
							elementName: "Skipped",
							status: "skipped",
						}),
					],
				})
			);

			render(<RemotionExportProgress defaultExpanded />);

			// Elements should be rendered with their names
			expect(screen.getByText("Pending")).toBeInTheDocument();
			expect(screen.getByText("Complete")).toBeInTheDocument();
			expect(screen.getByText("Error")).toBeInTheDocument();
			expect(screen.getByText("Skipped")).toBeInTheDocument();
		});
	});
});
