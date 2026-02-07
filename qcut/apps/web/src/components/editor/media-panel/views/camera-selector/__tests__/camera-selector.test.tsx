import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CameraSelectorView } from "../camera-selector-view";
import { useCameraSelectorStore } from "@/stores/camera-selector-store";

describe("CameraSelectorView", () => {
  beforeEach(() => {
    useCameraSelectorStore.setState({
      cameraIndex: 0,
      lensIndex: 0,
      focalIndex: 3,
      apertureIndex: 0,
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
    // "50" appears in both the setup display and the focal track
    const matches = screen.getAllByText("50");
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
