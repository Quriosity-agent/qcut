// Mock for Radix UI components to avoid getComputedStyle issues in tests
import React from "react";
import { vi } from "vitest";

// Mock the problematic Presence component from Radix UI
export const mockPresence = {
  Presence: ({ children, present = true }: any) => {
    return present ? children : null;
  },
};

// Mock CheckboxIndicator to avoid Presence issues
export const mockCheckboxIndicator = React.forwardRef<any, any>(
  ({ children, ...props }, ref) => {
    return React.createElement("span", { ...props, ref }, children);
  }
);

// Setup function to be called in test setup
export function setupRadixUIMocks() {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
    // Use Vitest's module mocker for proper ESM support
    vi.mock("@radix-ui/react-presence", () => mockPresence);
  }
}
