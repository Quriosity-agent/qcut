import { vi } from "vitest";

// Mock @radix-ui/react-focus-scope to avoid MutationObserver issues in tests
export const mockFocusScope = () => {
  vi.mock("@radix-ui/react-focus-scope", () => ({
    FocusScope: ({ children }: { children: React.ReactNode }) => children,
  }));
};
