/**
 * Component Loader — barrel re-export.
 * Split into component-loader/ directory for maintainability.
 *
 * @module lib/remotion/component-loader
 */

export {
	type LoadResult,
	type LoadOptions,
	type StoredComponent,
	type FolderLoadResult,
	type FolderCompositionInfo,
	type FolderBundleResult,
	type LoadStoredComponentsResult,
	DEFAULT_LOAD_OPTIONS,
	generateComponentId,
	loadComponentFromCode,
	loadComponentFromFile,
	loadStoredComponents,
	loadStoredComponentsWithAnalysis,
	removeStoredComponent,
	getComponentSourceCode,
	updateStoredComponent,
	loadComponentsFromFolder,
	isFolderImportAvailable,
	importFromFolder,
} from "./component-loader/index";
