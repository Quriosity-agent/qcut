import { useEffect, useRef, useState } from "react";
import { debugLog, debugWarn } from "@/lib/debug/debug-config";

/**
 * Hook for monitoring memory usage in React components during development
 */
export function useMemoryMonitor(
	options: {
		componentName?: string;
		logOnMount?: boolean;
		logOnUnmount?: boolean;
		trackUpdates?: boolean;
	} = {}
) {
	const {
		componentName = "Component",
		logOnMount = true,
		logOnUnmount = true,
		trackUpdates = false,
	} = options;

	const [memoryInfo, setMemoryInfo] = useState<{
		heapUsed: string;
		heapTotal: string;
	} | null>(null);

	const renderCount = useRef(0);
	const mountTime = useRef<number>(0);

	// Get memory info
	const getMemoryInfo = () => {
		const memory = (performance as any).memory;
		if (!memory) return null;

		const formatBytes = (bytes: number) => {
			if (bytes === 0) return "0 B";
			const k = 1024;
			const sizes = ["B", "KB", "MB", "GB"];
			const i = Math.floor(Math.log(bytes) / Math.log(k));
			return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
		};

		return {
			heapUsed: formatBytes(memory.usedJSHeapSize),
			heapTotal: formatBytes(memory.totalJSHeapSize),
		};
	};

	// Track render count
	renderCount.current += 1;

	// Update memory info if tracking is enabled
	// biome-ignore lint/correctness/useExhaustiveDependencies: getMemoryInfo is intentionally omitted to avoid unnecessary re-renders
	useEffect(() => {
		if (!import.meta.env.DEV || !trackUpdates) return;

		// Set up polling interval for memory updates
		const intervalId = window.setInterval(() => {
			const info = getMemoryInfo();
			setMemoryInfo((prev) => {
				// Only update if memory info actually changed to prevent unnecessary re-renders
				if (!prev || !info) return info;
				const hasChanged =
					prev.heapUsed !== info.heapUsed || prev.heapTotal !== info.heapTotal;
				return hasChanged ? info : prev;
			});
		}, 1000); // Poll every second

		// Also set initial value
		const initialInfo = getMemoryInfo();
		setMemoryInfo(initialInfo);

		return () => clearInterval(intervalId);
	}, [trackUpdates]);

	// Mount/unmount logging
	// biome-ignore lint/correctness/useExhaustiveDependencies: getMemoryInfo is intentionally omitted to avoid unnecessary re-renders
	useEffect(() => {
		if (!import.meta.env.DEV) return;

		mountTime.current = Date.now();

		if (logOnMount) {
			const info = getMemoryInfo();
			debugLog(
				`🧠 [${componentName}] Mounted | Memory: ${info?.heapUsed}/${info?.heapTotal}`
			);
		}

		return () => {
			if (logOnUnmount) {
				const info = getMemoryInfo();
				const lifespan = Date.now() - mountTime.current;
				debugLog(
					`🧠 [${componentName}] Unmounted after ${lifespan}ms | Memory: ${info?.heapUsed}/${info?.heapTotal} | Renders: ${renderCount.current}`
				);
			}
		};
	}, [componentName, logOnMount, logOnUnmount]);

	// Force memory check function
	const checkMemory = () => {
		if (!import.meta.env.DEV) return null;

		const info = getMemoryInfo();
		debugLog(
			`🧠 [${componentName}] Memory check | Heap: ${info?.heapUsed}/${info?.heapTotal} | Renders: ${renderCount.current}`
		);
		return info;
	};

	// Trigger garbage collection if available
	const triggerGC = () => {
		if (import.meta.env.DEV && (window as any).gc) {
			debugLog(`🗑️ [${componentName}] Triggering GC`);
			(window as any).gc();

			// Check memory after GC
			setTimeout(() => {
				const info = getMemoryInfo();
				debugLog(
					`🧠 [${componentName}] Post-GC Memory: ${info?.heapUsed}/${info?.heapTotal}`
				);
			}, 100);
		} else {
			debugWarn(`🗑️ [${componentName}] GC not available`);
		}
	};

	return {
		memoryInfo,
		renderCount: renderCount.current,
		checkMemory,
		triggerGC,
	};
}

/**
 * Hook to track memory leaks in components with large data
 */
export function useMemoryLeakDetector(
	dataSize: number,
	threshold: number = 10 * 1024 * 1024, // 10MB default
	componentName = "Component"
) {
	const initialMemory = useRef<number>(0);

	useEffect(() => {
		if (!import.meta.env.DEV) return;

		const memory = (performance as any).memory;
		if (memory) {
			initialMemory.current = memory.usedJSHeapSize;
		}

		return () => {
			if (memory) {
				const currentMemory = memory.usedJSHeapSize;
				const memoryGrowth = currentMemory - initialMemory.current;

				if (memoryGrowth > threshold) {
					debugWarn(
						`🚨 [${componentName}] Potential memory leak detected!`,
						`Memory grew by ${(memoryGrowth / 1024 / 1024).toFixed(1)}MB`,
						`Data size: ${(dataSize / 1024 / 1024).toFixed(1)}MB`
					);
				}
			}
		};
	}, [dataSize, threshold, componentName]);
}
