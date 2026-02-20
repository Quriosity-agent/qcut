import { describe, it, expect, vi, beforeEach } from "vitest";

import {
	handleError,
	handleNetworkError,
	handleAIServiceError,
	ErrorCategory,
	ErrorSeverity,
} from "../../lib/error-handler";

// Hoist mock fns so they're available when vi.mock factory runs (hoisted to top)
const { mockToast, mockToastError, mockToastWarning } = vi.hoisted(() => ({
	mockToast: vi.fn(
		(_msg: string, _opts?: Record<string, unknown>) => "toast-id"
	),
	mockToastError: vi.fn(
		(_msg: string, _opts?: Record<string, unknown>) => "toast-id"
	),
	mockToastWarning: vi.fn(
		(_msg: string, _opts?: Record<string, unknown>) => "toast-id"
	),
}));

vi.mock("sonner", () => ({
	toast: Object.assign(mockToast, {
		success: vi.fn(),
		error: mockToastError,
		info: vi.fn(),
		warning: mockToastWarning,
		message: vi.fn(),
		loading: vi.fn(),
		promise: vi.fn(),
		custom: vi.fn(),
		dismiss: vi.fn(),
	}),
	Toaster: vi.fn(() => null),
}));

// Mock clipboard API
Object.assign(navigator, {
	clipboard: {
		writeText: vi.fn(() => Promise.resolve()),
	},
});

describe("Error Handler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Suppress console logs during tests
		vi.spyOn(console, "group").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "groupEnd").mockImplementation(() => {});
	});

	it("should handle basic errors with proper structure", () => {
		const error = new Error("Test error message");
		const context = {
			operation: "Test Operation",
			category: ErrorCategory.SYSTEM,
			severity: ErrorSeverity.MEDIUM,
		};

		const result = handleError(error, context);

		expect(result).toMatchObject({
			message: "Test error message",
			originalError: error,
			context,
			stack: expect.any(String),
		});

		expect(result.id).toMatch(/^ERR-\d+-[A-Z0-9]{6}$/);
		expect(result.timestamp).toBeDefined();
	});

	it("should show appropriate toast for different severities", () => {
		const error = new Error("Test error");

		// Test LOW severity
		handleError(error, {
			operation: "Low Test",
			category: ErrorCategory.VALIDATION,
			severity: ErrorSeverity.LOW,
		});
		expect(mockToast).toHaveBeenCalledWith(
			"Test error",
			expect.objectContaining({
				description: expect.stringContaining("Low Test"),
				duration: 4000,
			})
		);

		// Test HIGH severity
		handleError(error, {
			operation: "High Test",
			category: ErrorCategory.STORAGE,
			severity: ErrorSeverity.HIGH,
		});
		expect(mockToastError).toHaveBeenCalledWith(
			"Test error",
			expect.objectContaining({
				description: expect.stringContaining("High Test"),
				duration: 8000,
			})
		);

		// Test CRITICAL severity
		handleError(error, {
			operation: "Critical Test",
			category: ErrorCategory.EXPORT,
			severity: ErrorSeverity.CRITICAL,
		});
		expect(mockToastError).toHaveBeenCalledWith(
			"Test error",
			expect.objectContaining({
				description: expect.stringContaining("Critical error"),
				duration: 15_000,
			})
		);
	});

	it("should provide user-friendly messages for network errors", () => {
		const fetchError = new Error("Failed to fetch");

		const result = handleNetworkError(fetchError, "API Call");

		expect(result.message).toBe(
			"Network connection failed. Please check your internet connection."
		);
	});

	it("should handle AI service errors with metadata", () => {
		const apiError = new Error("API key missing");

		const result = handleAIServiceError(apiError, "Video Generation", {
			model: "test-model",
			requestId: "req-123",
		});

		expect(result.context.category).toBe(ErrorCategory.AI_SERVICE);
		expect(result.context.metadata).toEqual({
			model: "test-model",
			requestId: "req-123",
		});
	});

	it("should suppress toast when showToast is false", () => {
		const error = new Error("Silent error");

		handleError(error, {
			operation: "Silent Operation",
			category: ErrorCategory.SYSTEM,
			severity: ErrorSeverity.HIGH,
			showToast: false,
		});

		expect(mockToast).not.toHaveBeenCalled();
		expect(mockToastError).not.toHaveBeenCalled();
		expect(mockToastWarning).not.toHaveBeenCalled();
	});

	it("should handle non-Error objects", () => {
		const errorString = "Something went wrong";

		const result = handleError(errorString, {
			operation: "String Error",
			category: ErrorCategory.UNKNOWN,
			severity: ErrorSeverity.MEDIUM,
		});

		expect(result.originalError).toBe(errorString);
		expect(result.message).toBe("An unexpected error occurred");
		expect(result.stack).toBeUndefined();
	});

	it("should generate unique error IDs", () => {
		const error = new Error("Test");
		const context = {
			operation: "Test",
			category: ErrorCategory.SYSTEM,
			severity: ErrorSeverity.LOW,
		};

		const result1 = handleError(error, context);
		const result2 = handleError(error, context);

		expect(result1.id).not.toBe(result2.id);
		expect(result1.id).toMatch(/^ERR-\d+-[A-Z0-9]{6}$/);
		expect(result2.id).toMatch(/^ERR-\d+-[A-Z0-9]{6}$/);
	});
});
