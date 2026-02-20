/**
 * Shared browser API mocks for test environment
 * Provides consistent implementations across all test files
 */

// Type definitions for observer constructors
type MutationObserverCtor = new (
	callback: MutationCallback
) => MutationObserver;
type ResizeObserverCtor = new (
	callback: ResizeObserverCallback
) => ResizeObserver;
type IntersectionObserverCtor = new (
	callback: IntersectionObserverCallback,
	options?: IntersectionObserverInit
) => IntersectionObserver;

// Host context for installing observers
type ObserverHost = Partial<{
	MutationObserver: MutationObserverCtor;
	ResizeObserver: ResizeObserverCtor;
	IntersectionObserver: IntersectionObserverCtor;
}> &
	object;

// MutationObserver mock implementation
export class MockMutationObserver implements MutationObserver {
	observe(_target: Node, _options?: MutationObserverInit) {}
	disconnect() {}
	takeRecords(): MutationRecord[] {
		return [];
	}
}

// ResizeObserver mock implementation
export class MockResizeObserver implements ResizeObserver {
	observe(_target: Element, _options?: ResizeObserverOptions) {}
	unobserve(_target: Element) {}
	disconnect() {}
}

// IntersectionObserver mock implementation
export class MockIntersectionObserver implements IntersectionObserver {
	readonly root: Element | Document | null = null;
	readonly rootMargin = "0px";
	readonly thresholds: ReadonlyArray<number> = [0];

	observe(_target: Element) {}
	unobserve(_target: Element) {}
	disconnect() {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

// Helper function to install all mocks on a global context
export function installBrowserMocks(
	context: ObserverHost | null | undefined
): void {
	if (!context) return;

	// Force override using Object.defineProperty for better compatibility
	// This ensures we override JSDOM's native implementation
	try {
		// Clear existing property first to ensure clean override
		if ("MutationObserver" in context) {
			(context as any).MutationObserver = undefined;
		}

		Object.defineProperty(context, "MutationObserver", {
			value: MockMutationObserver,
			writable: true,
			configurable: true,
			enumerable: true,
		});

		// Verify the mock is properly installed
		if ((context as any).MutationObserver !== MockMutationObserver) {
			console.warn(
				"Failed to install MutationObserver mock via defineProperty, falling back"
			);
			(context as any).MutationObserver = MockMutationObserver;
		}
	} catch (e) {
		// Fallback to direct assignment if defineProperty fails
		console.warn(
			"defineProperty failed for MutationObserver, using direct assignment:",
			e
		);
		context.MutationObserver = MockMutationObserver;
	}

	try {
		Object.defineProperty(context, "ResizeObserver", {
			value: MockResizeObserver,
			writable: true,
			configurable: true,
			enumerable: true,
		});
	} catch (e) {
		context.ResizeObserver = MockResizeObserver;
	}

	try {
		Object.defineProperty(context, "IntersectionObserver", {
			value: MockIntersectionObserver,
			writable: true,
			configurable: true,
			enumerable: true,
		});
	} catch (e) {
		context.IntersectionObserver = MockIntersectionObserver;
	}
}

// Install mocks on all available global contexts
// Force-installs on each context to ensure consistent mock implementations
export function installAllBrowserMocks(): void {
	// Install on globalThis first (the modern standard)
	if (typeof globalThis !== "undefined") {
		installBrowserMocks(globalThis);

		// Ensure the same overrides exist on window/global as separate realms
		if (typeof window !== "undefined" && window !== globalThis) {
			installBrowserMocks(window as unknown as ObserverHost);
		}
		if (typeof global !== "undefined" && global !== globalThis) {
			installBrowserMocks(global as unknown as ObserverHost);
		}
	} else {
		// Fallback: Install on whatever contexts are available
		const contexts = [
			typeof global !== "undefined" ? global : null,
			typeof window !== "undefined" ? window : null,
			typeof self !== "undefined" ? self : null,
		].filter(Boolean);

		contexts.forEach((ctx) => {
			installBrowserMocks(ctx);
		});
	}
}
