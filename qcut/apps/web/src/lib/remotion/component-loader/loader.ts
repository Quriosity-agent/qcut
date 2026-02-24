/**
 * Component loading logic.
 * @module lib/remotion/component-loader/loader
 */

import type { RemotionComponentDefinition } from "../types";
import {
	validateComponent,
	type ValidationResult,
} from "../component-validator";
import {
	getSequenceAnalysisService,
	type AnalysisResult,
} from "../sequence-analysis-service";
import type {
	LoadResult,
	LoadOptions,
	StoredComponent,
	LoadStoredComponentsResult,
} from "./types";
import { DEFAULT_LOAD_OPTIONS } from "./types";
import {
	storeComponent,
	getStoredComponent,
	getAllStoredComponents,
	deleteStoredComponent,
} from "./indexeddb";

/**
 * Generate a unique component ID
 */
export function generateComponentId(fileName: string): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 8);
	const sanitizedName = fileName
		.replace(/\.tsx?$/, "")
		.replace(/[^a-zA-Z0-9-]/g, "-")
		.toLowerCase();
	return `imported-${sanitizedName}-${timestamp}-${random}`;
}

/**
 * Load a component from source code
 */
export async function loadComponentFromCode(
	sourceCode: string,
	fileName: string,
	options: LoadOptions = DEFAULT_LOAD_OPTIONS
): Promise<LoadResult> {
	const opts = { ...DEFAULT_LOAD_OPTIONS, ...options };

	const validation = validateComponent(sourceCode);

	if (!validation.valid) {
		return {
			success: false,
			error: validation.errors.join("; "),
			validation,
		};
	}

	const metadata = validation.metadata;
	if (!metadata) {
		return {
			success: false,
			error: "Validation passed but metadata is missing",
			validation,
		};
	}

	const componentId = opts.customId || generateComponentId(fileName);

	const PlaceholderComponent = () => {
		return null;
	};

	const componentDef: RemotionComponentDefinition = {
		id: componentId,
		name: metadata.name,
		description: metadata.description,
		category: metadata.category,
		durationInFrames: metadata.durationInFrames,
		fps: metadata.fps,
		width: metadata.width,
		height: metadata.height,
		schema: { safeParse: () => ({ success: true }) } as never,
		defaultProps: {},
		component: PlaceholderComponent,
		source: "imported",
		tags: metadata.tags,
		version: metadata.version,
		author: metadata.author,
	};

	let analysisResult: AnalysisResult | undefined;
	try {
		const analysisService = getSequenceAnalysisService();
		analysisResult = await analysisService.analyzeComponent(
			componentId,
			sourceCode
		);

		if (analysisResult.structure) {
			componentDef.sequenceStructure = analysisResult.structure;
		}
	} catch {
		// Analysis failure is non-blocking
	}

	if (opts.storeInDB) {
		try {
			const storedComponent: StoredComponent = {
				id: componentId,
				fileName,
				sourceCode,
				metadata,
				importedAt: Date.now(),
				updatedAt: Date.now(),
			};

			await storeComponent(storedComponent);
		} catch {
			// Storage failure is non-blocking
		}
	}

	return {
		success: true,
		component: componentDef,
		validation,
		analysisResult,
	};
}

/**
 * Load a component from a file
 */
export async function loadComponentFromFile(
	file: File,
	options: LoadOptions = DEFAULT_LOAD_OPTIONS
): Promise<LoadResult> {
	if (!file.name.endsWith(".tsx") && !file.name.endsWith(".ts")) {
		return {
			success: false,
			error: "Only .tsx and .ts files are supported",
		};
	}

	try {
		const sourceCode = await file.text();
		return loadComponentFromCode(sourceCode, file.name, options);
	} catch (error) {
		return {
			success: false,
			error: `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}

/**
 * Load all stored components from IndexedDB
 */
export async function loadStoredComponents(): Promise<
	RemotionComponentDefinition[]
> {
	try {
		const storedComponents = await getAllStoredComponents();

		return storedComponents.map((stored) => ({
			id: stored.id,
			name: stored.metadata.name,
			description: stored.metadata.description,
			category: stored.metadata.category,
			durationInFrames: stored.metadata.durationInFrames,
			fps: stored.metadata.fps,
			width: stored.metadata.width,
			height: stored.metadata.height,
			schema: { safeParse: () => ({ success: true }) } as never,
			defaultProps: {},
			component: () => null,
			source: "imported" as const,
			tags: stored.metadata.tags,
			version: stored.metadata.version,
			author: stored.metadata.author,
			thumbnail: stored.thumbnail,
		}));
	} catch {
		return [];
	}
}

/**
 * Load all stored components with analysis
 */
export async function loadStoredComponentsWithAnalysis(): Promise<
	LoadStoredComponentsResult[]
> {
	try {
		const storedComponents = await getAllStoredComponents();
		const analysisService = getSequenceAnalysisService();
		const results: LoadStoredComponentsResult[] = [];

		for (const stored of storedComponents) {
			let analysisResult: AnalysisResult | undefined;
			try {
				analysisResult = await analysisService.analyzeComponent(
					stored.id,
					stored.sourceCode
				);
			} catch {
				// Analysis failure is non-blocking
			}

			const definition: RemotionComponentDefinition = {
				id: stored.id,
				name: stored.metadata.name,
				description: stored.metadata.description,
				category: stored.metadata.category,
				durationInFrames: stored.metadata.durationInFrames,
				fps: stored.metadata.fps,
				width: stored.metadata.width,
				height: stored.metadata.height,
				schema: { safeParse: () => ({ success: true }) } as never,
				defaultProps: {},
				component: () => null,
				source: "imported" as const,
				tags: stored.metadata.tags,
				version: stored.metadata.version,
				author: stored.metadata.author,
				thumbnail: stored.thumbnail,
				sequenceStructure: analysisResult?.structure ?? undefined,
			};

			results.push({
				definition,
				sourceCode: stored.sourceCode,
				analysisResult,
			});
		}

		return results;
	} catch {
		return [];
	}
}

/**
 * Remove a stored component
 */
export async function removeStoredComponent(
	componentId: string
): Promise<void> {
	await deleteStoredComponent(componentId);
}

/**
 * Get a stored component's source code
 */
export async function getComponentSourceCode(
	componentId: string
): Promise<string | null> {
	try {
		const stored = await getStoredComponent(componentId);
		return stored?.sourceCode || null;
	} catch (_error) {
		return null;
	}
}

/**
 * Update a stored component's source code
 */
export async function updateStoredComponent(
	componentId: string,
	newSourceCode: string
): Promise<LoadResult> {
	try {
		const existing = await getStoredComponent(componentId);
		if (!existing) {
			return {
				success: false,
				error: "Component not found",
			};
		}

		const validation = validateComponent(newSourceCode);
		if (!validation.valid) {
			return {
				success: false,
				error: validation.errors.join("; "),
				validation,
			};
		}

		const metadata = validation.metadata;
		if (!metadata) {
			return {
				success: false,
				error: "Validation passed but metadata is missing",
				validation,
			};
		}

		const updated: StoredComponent = {
			...existing,
			sourceCode: newSourceCode,
			metadata,
			updatedAt: Date.now(),
		};

		await storeComponent(updated);

		let analysisResult: AnalysisResult | undefined;
		try {
			const analysisService = getSequenceAnalysisService();
			analysisService.invalidateCache(componentId);
			analysisResult = await analysisService.analyzeComponent(
				componentId,
				newSourceCode
			);
		} catch {
			// Analysis failure is non-blocking
		}

		const componentDef: RemotionComponentDefinition = {
			id: componentId,
			name: metadata.name,
			description: metadata.description,
			category: metadata.category,
			durationInFrames: metadata.durationInFrames,
			fps: metadata.fps,
			width: metadata.width,
			height: metadata.height,
			schema: { safeParse: () => ({ success: true }) } as never,
			defaultProps: {},
			component: () => null,
			source: "imported",
			tags: metadata.tags,
			version: metadata.version,
			author: metadata.author,
			sequenceStructure: analysisResult?.structure ?? undefined,
		};

		return {
			success: true,
			component: componentDef,
			validation,
			analysisResult,
		};
	} catch (error) {
		return {
			success: false,
			error: `Failed to update component: ${error instanceof Error ? error.message : "Unknown error"}`,
		};
	}
}
