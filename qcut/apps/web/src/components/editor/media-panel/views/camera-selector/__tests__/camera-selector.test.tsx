import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CameraSelectorView } from "../camera-selector-view";
import { useCameraSelectorStore } from "@/stores/editor/camera-selector-store";

// Mock router
vi.mock("@tanstack/react-router", () => ({
	useParams: () => ({ project_id: "test-project" }),
}));

// Mock media store actions
const mockAddMediaItem = vi.fn().mockResolvedValue("new-item-id");
vi.mock("@/hooks/use-async-media-store", () => ({
	useAsyncMediaStoreActions: () => ({
		addMediaItem: mockAddMediaItem,
	}),
}));

// Mock FalAiService
const mockGenerateImage = vi.fn();
vi.mock("@/services/ai/fal-ai-service", () => ({
	FalAiService: {
		generateImage: (...args: unknown[]) => mockGenerateImage(...args),
	},
}));

// Mock blob-manager
vi.mock("@/lib/media/blob-manager", () => ({
	createObjectURL: () => "blob:test-url",
}));

// Mock fetch for image download in addToMedia
const mockFetch = vi.fn().mockResolvedValue({
	blob: () => Promise.resolve(new Blob(["fake-image"], { type: "image/jpeg" })),
});
vi.stubGlobal("fetch", mockFetch);

describe("CameraSelectorView", () => {
	beforeEach(() => {
		useCameraSelectorStore.setState({
			cameraIndex: 0,
			lensIndex: 0,
			focalIndex: 3,
			apertureIndex: 0,
		});
		vi.clearAllMocks();
		mockFetch.mockResolvedValue({
			blob: () =>
				Promise.resolve(new Blob(["fake-image"], { type: "image/jpeg" })),
		});
	});

	it("should render the panel", () => {
		render(<CameraSelectorView />);
		expect(screen.getByTestId("camera-selector-panel")).toBeInTheDocument();
	});

	it("should render all 4 section labels", () => {
		render(<CameraSelectorView />);
		expect(screen.getByText("Camera")).toBeInTheDocument();
		expect(screen.getByText("Lens")).toBeInTheDocument();
		expect(screen.getByText("Focal Length")).toBeInTheDocument();
		expect(screen.getByText("Aperture")).toBeInTheDocument();
	});

	it("should render all 6 camera names", () => {
		render(<CameraSelectorView />);
		expect(screen.getByText("Red V-Raptor")).toBeInTheDocument();
		expect(screen.getByText("Sony Venice")).toBeInTheDocument();
		expect(screen.getByText("IMAX Film Camera")).toBeInTheDocument();
		expect(screen.getByText("Arri Alexa 35")).toBeInTheDocument();
		expect(screen.getByText("Arriflex 16SR")).toBeInTheDocument();
		expect(screen.getByText("Panavision Millennium DXL2")).toBeInTheDocument();
	});

	it("should render all 4 focal lengths", () => {
		render(<CameraSelectorView />);
		expect(screen.getByText("8")).toBeInTheDocument();
		expect(screen.getByText("14")).toBeInTheDocument();
		expect(screen.getByText("35")).toBeInTheDocument();
	});

	it("should render all 3 aperture options", () => {
		render(<CameraSelectorView />);
		expect(screen.getByText("f/1.4")).toBeInTheDocument();
		expect(screen.getByText("f/4")).toBeInTheDocument();
		expect(screen.getByText("f/11")).toBeInTheDocument();
	});

	it("should update store when a camera is clicked", () => {
		render(<CameraSelectorView />);
		fireEvent.click(screen.getByText("Sony Venice"));
		expect(useCameraSelectorStore.getState().cameraIndex).toBe(1);
	});

	it("should update store when a focal length is clicked", () => {
		render(<CameraSelectorView />);
		fireEvent.click(screen.getByText("14"));
		expect(useCameraSelectorStore.getState().focalIndex).toBe(1);
	});

	it("should display current setup with default focal length 50", () => {
		render(<CameraSelectorView />);
		const matches = screen.getAllByText("50");
		expect(matches.length).toBeGreaterThanOrEqual(2);
	});

	describe("generate section", () => {
		it("should render generate button", () => {
			render(<CameraSelectorView />);
			expect(screen.getByTestId("camera-generate-btn")).toBeInTheDocument();
			expect(screen.getByText("Generate with Camera")).toBeInTheDocument();
		});

		it("should render subject input", () => {
			render(<CameraSelectorView />);
			expect(screen.getByTestId("camera-subject-input")).toBeInTheDocument();
		});

		it("should accept text in subject input", () => {
			render(<CameraSelectorView />);
			const input = screen.getByTestId("camera-subject-input");
			fireEvent.change(input, { target: { value: "a sunset over mountains" } });
			expect(input).toHaveValue("a sunset over mountains");
		});

		it("should display prompt preview at the top of the panel", () => {
			render(<CameraSelectorView />);
			const preview = screen.getByTestId("camera-prompt-preview");
			expect(preview.textContent).toContain("Red V-Raptor");
			expect(preview.textContent).toContain("Cinematic shot on");
		});

		it("should call FalAiService.generateImage on generate click", async () => {
			mockGenerateImage.mockResolvedValueOnce(["https://example.com/img.jpg"]);
			render(<CameraSelectorView />);

			fireEvent.click(screen.getByTestId("camera-generate-btn"));

			await waitFor(() => {
				expect(mockGenerateImage).toHaveBeenCalledTimes(1);
			});

			const calledPrompt = mockGenerateImage.mock.calls[0][0] as string;
			expect(calledPrompt).toContain("Red V-Raptor");
			expect(calledPrompt).toContain("Helios");
		});

		it("should show loading state during generation", () => {
			mockGenerateImage.mockReturnValue(new Promise<string[]>(() => {}));

			render(<CameraSelectorView />);
			fireEvent.click(screen.getByTestId("camera-generate-btn"));

			expect(screen.getByText("Generating...")).toBeInTheDocument();
			expect(screen.getByTestId("camera-generate-btn")).toBeDisabled();
		});

		it("should display result image after generation", async () => {
			mockGenerateImage.mockResolvedValueOnce([
				"https://example.com/result.jpg",
			]);
			render(<CameraSelectorView />);

			fireEvent.click(screen.getByTestId("camera-generate-btn"));

			await waitFor(() => {
				expect(screen.getByTestId("camera-gen-result")).toBeInTheDocument();
			});

			const img = screen.getByAltText("Generated result");
			expect(img).toHaveAttribute("src", "https://example.com/result.jpg");
		});

		it("should show error on generation failure", async () => {
			mockGenerateImage.mockRejectedValueOnce(new Error("API failed"));
			render(<CameraSelectorView />);

			fireEvent.click(screen.getByTestId("camera-generate-btn"));

			await waitFor(() => {
				expect(screen.getByTestId("camera-gen-error")).toBeInTheDocument();
			});

			expect(screen.getByText("API failed")).toBeInTheDocument();
		});

		it("should auto-add to media library after generation", async () => {
			mockGenerateImage.mockResolvedValueOnce([
				"https://example.com/result.jpg",
			]);
			render(<CameraSelectorView />);

			fireEvent.click(screen.getByTestId("camera-generate-btn"));

			await waitFor(() => {
				expect(mockAddMediaItem).toHaveBeenCalledTimes(1);
			});

			expect(mockAddMediaItem).toHaveBeenCalledWith(
				"test-project",
				expect.objectContaining({
					type: "image",
					metadata: expect.objectContaining({ source: "camera_selector" }),
				})
			);
		});
	});
});
