/**
 * IndexedDB helpers for component storage.
 * @module lib/remotion/component-loader/indexeddb
 */

import type { StoredComponent } from "./types";
import { DB_NAME, DB_VERSION, STORE_NAME } from "./constants";

/**
 * Open the IndexedDB database
 */
export function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => {
			reject(new Error("Failed to open IndexedDB"));
		};

		request.onsuccess = () => {
			resolve(request.result);
		};

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;

			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
				store.createIndex("fileName", "fileName", { unique: false });
				store.createIndex("importedAt", "importedAt", { unique: false });
			}
		};
	});
}

/**
 * Store a component in IndexedDB
 */
export async function storeComponent(
	component: StoredComponent
): Promise<void> {
	const db = await openDatabase();

	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], "readwrite");
		const store = transaction.objectStore(STORE_NAME);

		transaction.oncomplete = () => {
			db.close();
			resolve();
		};

		transaction.onerror = () => {
			db.close();
			reject(new Error("Failed to store component"));
		};

		transaction.onabort = () => {
			db.close();
			reject(new Error("Failed to store component"));
		};

		store.put(component);
	});
}

/**
 * Get a component from IndexedDB by ID
 */
export async function getStoredComponent(
	id: string
): Promise<StoredComponent | null> {
	const db = await openDatabase();

	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], "readonly");
		const store = transaction.objectStore(STORE_NAME);
		const request = store.get(id);

		transaction.oncomplete = () => {
			db.close();
			resolve(request.result || null);
		};

		transaction.onerror = () => {
			db.close();
			reject(new Error("Failed to get component"));
		};

		transaction.onabort = () => {
			db.close();
			reject(new Error("Failed to get component"));
		};
	});
}

/**
 * Get all stored components from IndexedDB
 */
export async function getAllStoredComponents(): Promise<StoredComponent[]> {
	const db = await openDatabase();

	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], "readonly");
		const store = transaction.objectStore(STORE_NAME);
		const request = store.getAll();

		transaction.oncomplete = () => {
			db.close();
			resolve(request.result || []);
		};

		transaction.onerror = () => {
			db.close();
			reject(new Error("Failed to get components"));
		};

		transaction.onabort = () => {
			db.close();
			reject(new Error("Failed to get components"));
		};
	});
}

/**
 * Delete a component from IndexedDB
 */
export async function deleteStoredComponent(id: string): Promise<void> {
	const db = await openDatabase();

	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], "readwrite");
		const store = transaction.objectStore(STORE_NAME);

		transaction.oncomplete = () => {
			db.close();
			resolve();
		};

		transaction.onerror = () => {
			db.close();
			reject(new Error("Failed to delete component"));
		};

		transaction.onabort = () => {
			db.close();
			reject(new Error("Failed to delete component"));
		};

		store.delete(id);
	});
}
