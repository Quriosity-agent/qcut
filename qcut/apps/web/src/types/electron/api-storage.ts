/**
 * Storage operations sub-interface for ElectronAPI.
 */

export interface ElectronStorageOps {
	storage: {
		save: <T = unknown>(key: string, data: T) => Promise<void>;
		load: <T = unknown>(key: string) => Promise<T | null>;
		remove: (key: string) => Promise<void>;
		list: () => Promise<string[]>;
		clear: () => Promise<void>;
	};
}
