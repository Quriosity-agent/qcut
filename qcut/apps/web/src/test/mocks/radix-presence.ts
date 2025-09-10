// Mock for @radix-ui/react-presence to avoid getComputedStyle issues in tests
import { vi } from "vitest";

// Create a mock Presence component that doesn't use getComputedStyle
export const mockPresence = () => {
  vi.mock("@radix-ui/react-presence", () => ({
    Presence: ({ children, present }: any) => {
      // Simply render children when present
      return present !== false ? children : null;
    },
  }));
};
