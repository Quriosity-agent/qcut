import { revokeObjectURL as revokeManagedObjectURL } from "@/lib/blob-manager";

/**
 * Debug utility to track blob URL creation and catch sources of blob URL errors
 * This helps identify where blob URLs are still being created after our fixes
 */

let originalCreateObjectURL: typeof URL.createObjectURL;
let originalRevokeObjectURL: typeof URL.revokeObjectURL;
const blobUrlTracker = new Map<string, { source: string; created: Date }>();

export function enableBlobUrlDebugging() {
	if (typeof originalCreateObjectURL !== "undefined") {
		console.log("[BlobUrlDebug] Already enabled");
		return;
	}

	// Store original functions
	originalCreateObjectURL = URL.createObjectURL;
	originalRevokeObjectURL = URL.revokeObjectURL;

	// Override createObjectURL to track creation
	URL.createObjectURL = function (object: File | Blob | MediaSource) {
		const url = originalCreateObjectURL.call(this, object);

		// Get stack trace to identify source
		const stack =
			new Error("Stack trace for blob URL creation").stack || "Unknown source";
		const source = stack.split("\n").slice(2, 4).join(" → ").trim();

		blobUrlTracker.set(url, {
			source,
			created: new Date(),
		});

		console.log(`[BlobUrlDebug] 🟢 Created: ${url}`);
		console.log(`  📍 Source: ${source}`);
		console.log(
			`  📦 Type: ${object.constructor.name}, Size: ${object instanceof File ? object.size + " bytes" : "unknown"}`
		);

		return url;
	};

	// Override revokeObjectURL to track cleanup
	URL.revokeObjectURL = (url: string) => {
		const tracked = blobUrlTracker.get(url);
		if (tracked) {
			blobUrlTracker.delete(url);

			// Get stack trace for revoke call to identify what's revoking it
			const revokeStack =
				new Error("Stack trace for blob URL revocation").stack ||
				"Unknown revoke source";
			const revokeSource = revokeStack
				.split("\n")
				.slice(2, 4)
				.join(" → ")
				.trim();

			console.log(`[BlobUrlDebug] 🔴 Revoked: ${url}`);
			console.log(`  📍 Created by: ${tracked.source}`);
			console.log(`  🗑️ Revoked by: ${revokeSource}`);
			console.log(`  ⏱️ Lifespan: ${Date.now() - tracked.created.getTime()}ms`);
		} else {
			console.log(`[BlobUrlDebug] Revoked untracked: ${url}`);
		}

		const result = revokeManagedObjectURL(url, "blob-url-debug override");
		console.log("[BlobUrlDebug] Routed revoke via BlobManager guard");
		return result;
	};

	// Also intercept fetch to catch usage of revoked blob URLs
	const originalFetch = window.fetch;
	const interceptFetch = async (
		input: RequestInfo | URL,
		init?: RequestInit
	) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input instanceof Request
						? input.url
						: String(input);
		if (url.startsWith("blob:") && !blobUrlTracker.has(url)) {
			console.warn(
				`[BlobUrlDebug] 🚨 Fetch attempt on revoked blob URL: ${url}`
			);
			const stack =
				new Error("Stack trace for revoked blob fetch attempt").stack ||
				"Unknown";
			console.warn(
				"[BlobUrlDebug] Fetch attempt from:",
				stack.split("\n").slice(2, 5)
			);
		}
		return originalFetch.call(window, input, init);
	};

	// Copy all properties from original fetch to maintain compatibility
	Object.setPrototypeOf(interceptFetch, originalFetch);
	Object.defineProperty(window, "fetch", {
		value: interceptFetch,
		writable: true,
		configurable: true,
	});

	console.log("[BlobUrlDebug] Blob URL debugging enabled");
}

export function disableBlobUrlDebugging() {
	if (originalCreateObjectURL) {
		URL.createObjectURL = originalCreateObjectURL;
		URL.revokeObjectURL = originalRevokeObjectURL;
		originalCreateObjectURL = undefined as any;
		originalRevokeObjectURL = undefined as any;
		console.log("[BlobUrlDebug] Blob URL debugging disabled");
	}
}

export function getBlobUrlReport() {
	console.log(`[BlobUrlDebug] Active blob URLs: ${blobUrlTracker.size}`);
	for (const [url, info] of blobUrlTracker.entries()) {
		console.log(
			`  ${url} - ${info.source} (${Date.now() - info.created.getTime()}ms ago)`
		);
	}
	return Array.from(blobUrlTracker.entries());
}

// Auto-enable in development
if (import.meta.env.DEV) {
	enableBlobUrlDebugging();

	// Add to global for easy access in console
	window.blobUrlDebug = {
		enable: enableBlobUrlDebugging,
		disable: disableBlobUrlDebugging,
		report: getBlobUrlReport,
	};
}

// Type augmentation for global window
declare global {
	interface Window {
		blobUrlDebug: {
			enable: typeof enableBlobUrlDebugging;
			disable: typeof disableBlobUrlDebugging;
			report: typeof getBlobUrlReport;
		};
	}
}
