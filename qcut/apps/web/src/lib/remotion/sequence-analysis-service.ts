/**
 * Sequence Analysis Service
 *
 * Provides caching and management for parsed sequence structures.
 * Analyzes Remotion component source code and caches results.
 *
 * @module lib/remotion/sequence-analysis-service
 */

import {
	extractSequencesFromSource,
	toSequenceStructure,
	hasDynamicValues,
	type ParsedStructure,
} from "./sequence-parser";
import type { SequenceStructure } from "./types";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of analyzing a component's source code.
 */
export interface AnalysisResult {
	/** Unique identifier for this analysis */
	componentId: string;
	/** Raw parsed structure from AST */
	parsed: ParsedStructure;
	/** Converted structure for visualization (may have estimated values) */
	structure: SequenceStructure | null;
	/** Whether any values are computed at runtime */
	hasDynamicValues: boolean;
	/** Timestamp when analysis was performed */
	analyzedAt: number;
	/** Hash of source code for cache invalidation */
	sourceHash: string;
}

/**
 * Options for the analysis service.
 */
export interface AnalysisServiceOptions {
	/** Maximum number of entries to cache (default: 100) */
	maxCacheSize?: number;
	/** Default duration for dynamic sequences (default: 30 frames) */
	defaultDuration?: number;
}

// ============================================================================
// Service Class
// ============================================================================

/**
 * Service for analyzing Remotion component source code and caching results.
 *
 * @example
 * ```typescript
 * const service = new SequenceAnalysisService();
 *
 * // Analyze a component
 * const result = await service.analyzeComponent("my-component", sourceCode);
 *
 * // Get cached result
 * const cached = service.getCached("my-component");
 *
 * // Invalidate cache when source changes
 * service.invalidateCache("my-component");
 * ```
 */
export class SequenceAnalysisService {
	private cache: Map<string, AnalysisResult> = new Map();
	private readonly maxCacheSize: number;
	private readonly defaultDuration: number;

	constructor(options: AnalysisServiceOptions = {}) {
		this.maxCacheSize = options.maxCacheSize ?? 100;
		this.defaultDuration = options.defaultDuration ?? 30;
	}

	/**
	 * Analyze a component's source code for sequences.
	 *
	 * @param componentId - Unique identifier for the component
	 * @param sourceCode - The TypeScript/JSX source code
	 * @returns Analysis result with parsed sequences
	 */
	async analyzeComponent(
		componentId: string,
		sourceCode: string
	): Promise<AnalysisResult> {
		const sourceHash = this.hashSource(sourceCode);

		// Check cache first
		const cached = this.cache.get(componentId);
		if (cached && cached.sourceHash === sourceHash) {
			return cached;
		}

		// Parse the source code
		const parsed = extractSequencesFromSource(sourceCode);

		// Convert to visualization structure
		const structure = toSequenceStructure(parsed, this.defaultDuration);

		const result: AnalysisResult = {
			componentId,
			parsed,
			structure,
			hasDynamicValues: hasDynamicValues(parsed),
			analyzedAt: Date.now(),
			sourceHash,
		};

		// Add to cache with LRU eviction
		this.addToCache(componentId, result);

		return result;
	}

	/**
	 * Get a cached analysis result if available.
	 *
	 * @param componentId - The component identifier
	 * @returns Cached result or undefined
	 */
	getCached(componentId: string): AnalysisResult | undefined {
		return this.cache.get(componentId);
	}

	/**
	 * Check if a component has been analyzed.
	 *
	 * @param componentId - The component identifier
	 * @returns True if cached
	 */
	hasAnalysis(componentId: string): boolean {
		return this.cache.has(componentId);
	}

	/**
	 * Invalidate the cache for a specific component.
	 *
	 * @param componentId - The component identifier
	 */
	invalidateCache(componentId: string): void {
		this.cache.delete(componentId);
	}

	/**
	 * Clear the entire cache.
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Get cache statistics.
	 */
	getCacheStats(): {
		size: number;
		maxSize: number;
		componentIds: string[];
	} {
		return {
			size: this.cache.size,
			maxSize: this.maxCacheSize,
			componentIds: Array.from(this.cache.keys()),
		};
	}

	/**
	 * Add a result to the cache with LRU eviction.
	 */
	private addToCache(componentId: string, result: AnalysisResult): void {
		// Evict oldest entries if at capacity
		if (this.cache.size >= this.maxCacheSize) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey) {
				this.cache.delete(oldestKey);
			}
		}

		// Delete existing entry to update order (LRU)
		this.cache.delete(componentId);
		this.cache.set(componentId, result);
	}

	/**
	 * Generate a simple hash of the source code for cache invalidation.
	 */
	private hashSource(source: string): string {
		let hash = 0;
		for (let i = 0; i < source.length; i++) {
			const char = source.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32bit integer
		}
		return Math.abs(hash).toString(36);
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default singleton instance of the analysis service.
 */
let defaultService: SequenceAnalysisService | null = null;

/**
 * Get the default singleton instance of the analysis service.
 */
export function getSequenceAnalysisService(): SequenceAnalysisService {
	if (!defaultService) {
		defaultService = new SequenceAnalysisService();
	}
	return defaultService;
}

/**
 * Reset the default service (useful for testing).
 */
export function resetSequenceAnalysisService(): void {
	defaultService = null;
}
