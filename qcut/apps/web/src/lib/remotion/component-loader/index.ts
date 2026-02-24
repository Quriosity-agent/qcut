/**
 * Component Loader — barrel re-exports.
 * @module lib/remotion/component-loader
 */

export type {
	LoadResult,
	LoadOptions,
	StoredComponent,
	FolderLoadResult,
	FolderCompositionInfo,
	FolderBundleResult,
	LoadStoredComponentsResult,
} from "./types";
export { DEFAULT_LOAD_OPTIONS } from "./types";

export {
	generateComponentId,
	loadComponentFromCode,
	loadComponentFromFile,
	loadStoredComponents,
	loadStoredComponentsWithAnalysis,
	removeStoredComponent,
	getComponentSourceCode,
	updateStoredComponent,
} from "./loader";

export {
	loadComponentsFromFolder,
	isFolderImportAvailable,
	importFromFolder,
} from "./folder-import";
