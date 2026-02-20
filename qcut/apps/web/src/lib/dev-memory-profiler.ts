/**
 * Development Memory Profiler
 * Provides utilities for monitoring memory usage during development
 */

import { debugLog } from "@/lib/debug-config";

interface MemorySnapshot {
	timestamp: number;
	heapUsed: number;
	heapTotal: number;
	external: number;
	arrayBuffers: number;
}

interface ProfilerOptions {
	intervalMs?: number;
	logToConsole?: boolean;
	enableGC?: boolean;
}

class DevMemoryProfiler {
	private snapshots: MemorySnapshot[] = [];
	private intervalId: number | null = null;
	private isRunning = false;

	private options: Required<ProfilerOptions> = {
		intervalMs: 5000, // 5 seconds default
		logToConsole: true,
		enableGC: true,
	};

	constructor(options: ProfilerOptions = {}) {
		this.options = { ...this.options, ...options };

		// Add memory profiling to window for manual access
		if (typeof window !== "undefined" && import.meta.env.DEV) {
			(window as any).memoryProfiler = this;
		}
	}

	/**
	 * Take a memory snapshot
	 */
	takeSnapshot(): MemorySnapshot {
		const memory = (performance as any).memory;

		const snapshot: MemorySnapshot = {
			timestamp: Date.now(),
			heapUsed: memory?.usedJSHeapSize || 0,
			heapTotal: memory?.totalJSHeapSize || 0,
			external: memory?.external || 0,
			arrayBuffers: memory?.arrayBuffers || 0,
		};

		this.snapshots.push(snapshot);

		// Keep only last 100 snapshots to prevent memory leak
		if (this.snapshots.length > 100) {
			this.snapshots.shift();
		}

		return snapshot;
	}

	/**
	 * Start continuous memory monitoring
	 */
	start(): void {
		if (this.isRunning) {
			debugLog("[Memory Profiler] Already running");
			return;
		}

		this.isRunning = true;
		debugLog(
			`[Memory Profiler] Starting monitoring (${this.options.intervalMs}ms intervals)`
		);

		this.intervalId = window.setInterval(() => {
			const snapshot = this.takeSnapshot();

			if (this.options.logToConsole) {
				this.logSnapshot(snapshot);
			}

			// Trigger GC periodically if enabled
			if (this.options.enableGC && (window as any).gc) {
				(window as any).gc();
			}
		}, this.options.intervalMs);
	}

	/**
	 * Stop memory monitoring
	 */
	stop(): void {
		if (!this.isRunning) {
			debugLog("[Memory Profiler] Not currently running");
			return;
		}

		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		this.isRunning = false;
		debugLog("[Memory Profiler] Stopped monitoring");
	}

	/**
	 * Get memory usage statistics
	 */
	getStats() {
		if (this.snapshots.length === 0) {
			return null;
		}

		const latest = this.snapshots[this.snapshots.length - 1];
		const oldest = this.snapshots[0];
		const heapGrowth = latest.heapUsed - oldest.heapUsed;
		const timePeriod = latest.timestamp - oldest.timestamp;

		return {
			currentHeapUsed: this.formatBytes(latest.heapUsed),
			currentHeapTotal: this.formatBytes(latest.heapTotal),
			heapGrowth: this.formatBytes(heapGrowth),
			timePeriod: this.formatTime(timePeriod),
			snapshotCount: this.snapshots.length,
			avgHeapUsed: this.formatBytes(
				this.snapshots.reduce((sum, s) => sum + s.heapUsed, 0) /
					this.snapshots.length
			),
		};
	}

	/**
	 * Log memory snapshot to console
	 */
	private logSnapshot(snapshot: MemorySnapshot): void {
		const formatBytes = this.formatBytes;
		const time = new Date(snapshot.timestamp).toLocaleTimeString();

		debugLog(
			`[Memory] ${time} | Heap: ${formatBytes(snapshot.heapUsed)}/${formatBytes(snapshot.heapTotal)} | External: ${formatBytes(snapshot.external)}`
		);
	}

	/**
	 * Format bytes to human readable string
	 */
	private formatBytes(bytes: number): string {
		if (bytes === 0) return "0 B";

		const k = 1024;
		const sizes = ["B", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));

		return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
	}

	/**
	 * Format time to human readable string
	 */
	private formatTime(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);

		if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		}
		return `${seconds}s`;
	}

	/**
	 * Export snapshots as CSV for analysis
	 */
	exportCSV(): string {
		const headers = [
			"Timestamp",
			"HeapUsed",
			"HeapTotal",
			"External",
			"ArrayBuffers",
		];
		const rows = this.snapshots.map((s) => [
			new Date(s.timestamp).toISOString(),
			s.heapUsed,
			s.heapTotal,
			s.external,
			s.arrayBuffers,
		]);

		return [headers, ...rows].map((row) => row.join(",")).join("\n");
	}

	/**
	 * Clear all snapshots
	 */
	clear(): void {
		this.snapshots = [];
		debugLog("[Memory Profiler] Cleared all snapshots");
	}

	/**
	 * Get all snapshots for external analysis
	 */
	getSnapshots(): MemorySnapshot[] {
		return [...this.snapshots];
	}
}

// Global instance for development
export const devMemoryProfiler = new DevMemoryProfiler();

// Auto-start in development mode
if (import.meta.env.DEV && typeof window !== "undefined") {
	// Add helpful methods to window
	(window as any).startMemoryProfiling = () => devMemoryProfiler.start();
	(window as any).stopMemoryProfiling = () => devMemoryProfiler.stop();
	(window as any).getMemoryStats = () => devMemoryProfiler.getStats();
	(window as any).clearMemorySnapshots = () => devMemoryProfiler.clear();

	debugLog("🧠 Memory profiler available:");
	debugLog("- startMemoryProfiling()");
	debugLog("- stopMemoryProfiling()");
	debugLog("- getMemoryStats()");
	debugLog("- clearMemorySnapshots()");
}

export default DevMemoryProfiler;
