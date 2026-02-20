// Simplified test setup - consolidates all setup logic in correct order
import { vi, beforeAll, afterEach, afterAll } from "vitest";
import "@testing-library/jest-dom/vitest";
import { installAllBrowserMocks } from "./mocks/browser-mocks";

console.log("🔧 Starting comprehensive test setup...");

// 0. VERIFY DOM ENVIRONMENT
console.log("DOM Check - document exists:", typeof document !== "undefined");
console.log("DOM Check - window exists:", typeof window !== "undefined");

// If DOM doesn't exist, this is a fundamental environment issue
if (typeof document === "undefined") {
	console.error(
		"❌ CRITICAL: document is undefined - DOM environment not initialized"
	);
	console.log("Environment details:", {
		nodeEnv: process.env.NODE_ENV,
		testEnv: process.env.VITEST_ENVIRONMENT,
		userAgent:
			typeof navigator !== "undefined" ? navigator.userAgent : "undefined",
	});
} else {
	console.log("✅ DOM environment available");
}

// 1. FIRST: Install browser APIs using shared mocks
console.log("🔧 Installing browser APIs...");
installAllBrowserMocks();
console.log("✅ Browser APIs installed");

// 2. SECOND: Import Radix UI patches (this will also set up the vi.mock calls)
console.log("🔧 Importing Radix UI patches...");
await import("./setup-radix-patches");

console.log("✅ Radix UI modules mocked");

// 3. THIRD: Setup additional DOM and window mocks
console.log("🔧 Setting up additional DOM mocks...");

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// Mock localStorage
const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn(),
	key: vi.fn(),
	length: 0,
};
Object.defineProperty(window, "localStorage", {
	value: localStorageMock,
	writable: true,
});

// Mock URL methods
Object.defineProperty(URL, "createObjectURL", {
	writable: true,
	value: vi.fn(() => "blob:mock-url"),
});
Object.defineProperty(URL, "revokeObjectURL", {
	writable: true,
	value: vi.fn(),
});

console.log("✅ DOM mocks configured");

// 4. FOURTH: Test lifecycle hooks
beforeAll(() => {
	// Suppress console errors in tests
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});

	console.log("✅ Test environment ready");
});

afterEach(() => {
	vi.clearAllMocks();
	if (typeof localStorage !== "undefined") {
		localStorage.clear();
	}
});

afterAll(() => {
	vi.restoreAllMocks();
});

console.log("🎯 Simplified setup complete");
