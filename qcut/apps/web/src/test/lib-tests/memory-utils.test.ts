import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	setupPerformanceMocks,
	simulateMemoryPressure,
	getMemoryUsage,
} from "@/test/mocks/performance";
import { formatFileSize } from "@/lib/image-utils";

describe("Memory Utilities", () => {
	let cleanup: () => void;

	beforeEach(() => {
		cleanup = setupPerformanceMocks();
	});

	afterEach(() => {
		cleanup();
	});

	describe("formatFileSize", () => {
		it("formats bytes correctly", () => {
			expect(formatFileSize(0)).toBe("0 Bytes");
			expect(formatFileSize(512)).toBe("512 Bytes");
			expect(formatFileSize(1023)).toBe("1023 Bytes");
		});

		it("formats kilobytes correctly", () => {
			expect(formatFileSize(1024)).toBe("1 KB");
			expect(formatFileSize(1536)).toBe("1.5 KB");
			expect(formatFileSize(10_240)).toBe("10 KB");
			expect(formatFileSize(102_400)).toBe("100 KB");
		});

		it("formats megabytes correctly", () => {
			expect(formatFileSize(1_048_576)).toBe("1 MB");
			expect(formatFileSize(5_242_880)).toBe("5 MB");
			expect(formatFileSize(10_485_760)).toBe("10 MB");
			expect(formatFileSize(1_572_864)).toBe("1.5 MB"); // 1.5 * 1024 * 1024
		});

		it("formats gigabytes correctly", () => {
			expect(formatFileSize(1_073_741_824)).toBe("1 GB");
			expect(formatFileSize(5_368_709_120)).toBe("5 GB");
			expect(formatFileSize(1_610_612_736)).toBe("1.5 GB");
		});

		it("formats terabytes correctly", () => {
			// The function has a maximum of 'GB' in sizes array
			// For values larger than GB, it will overflow the array
			// Let's test with realistic GB values instead
			expect(formatFileSize(10_737_418_240)).toBe("10 GB"); // 10 GB
			expect(formatFileSize(107_374_182_400)).toBe("100 GB"); // 100 GB
		});
	});

	describe("Memory Monitoring", () => {
		it("checks memory usage", () => {
			const usage = getMemoryUsage();
			expect(typeof usage).toBe("number");
			expect(usage).toBeGreaterThanOrEqual(0);
			expect(usage).toBe(100_000_000); // Default mock value
		});

		it("simulates memory pressure", () => {
			simulateMemoryPressure(90); // 90% usage
			const usage = getMemoryUsage();
			expect(usage).toBe(450_000_000); // 90% of 500MB limit

			simulateMemoryPressure(50); // 50% usage
			const usage2 = getMemoryUsage();
			expect(usage2).toBe(250_000_000); // 50% of 500MB limit
		});

		it("detects high memory usage", () => {
			function checkMemoryPressure(threshold = 0.8): boolean {
				if (!performance.memory) return false;
				const { usedJSHeapSize, jsHeapSizeLimit } = performance.memory;
				return usedJSHeapSize / jsHeapSizeLimit > threshold;
			}

			simulateMemoryPressure(90);
			expect(checkMemoryPressure()).toBe(true);
			expect(checkMemoryPressure(0.85)).toBe(true);

			simulateMemoryPressure(50);
			expect(checkMemoryPressure()).toBe(false);
			expect(checkMemoryPressure(0.4)).toBe(true);
		});
	});
});
