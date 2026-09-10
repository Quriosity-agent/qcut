import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { MotionAnalysis } from "./stabilization-protocol";

const DATABASE_NAME = "qcut-stabilization";
const DATABASE_VERSION = 1;
const STORE_NAME = "analyses";

interface StoredMotionAnalysis {
	key: string;
	analysis: MotionAnalysis;
	updatedAt: number;
}

interface StabilizationDatabase extends DBSchema {
	analyses: { key: string; value: StoredMotionAnalysis };
}

export interface MotionAnalysisStorage {
	get: ({ key }: { key: string }) => Promise<MotionAnalysis | null>;
	put: ({
		key,
		analysis,
	}: {
		key: string;
		analysis: MotionAnalysis;
	}) => Promise<void>;
}

export function motionAnalysisKey({
	version,
	contentSha256,
}: {
	version: string;
	contentSha256: string;
}): string {
	return `${version}:${contentSha256.toLowerCase()}`;
}

/** Content-addressed IndexedDB cache; a missing IndexedDB degrades to no cache. */
export class IndexedDbMotionAnalysisStorage implements MotionAnalysisStorage {
	private databasePromise?: Promise<IDBPDatabase<StabilizationDatabase>>;

	private database(): Promise<IDBPDatabase<StabilizationDatabase>> {
		if (typeof indexedDB === "undefined") {
			return Promise.reject(new Error("IndexedDB is unavailable."));
		}
		this.databasePromise ??= openDB<StabilizationDatabase>(
			DATABASE_NAME,
			DATABASE_VERSION,
			{
				upgrade(database) {
					database.createObjectStore(STORE_NAME, { keyPath: "key" });
				},
			}
		);
		return this.databasePromise;
	}

	async get({ key }: { key: string }): Promise<MotionAnalysis | null> {
		try {
			return (
				(await (await this.database()).get(STORE_NAME, key))?.analysis ?? null
			);
		} catch {
			return null;
		}
	}

	async put({
		key,
		analysis,
	}: {
		key: string;
		analysis: MotionAnalysis;
	}): Promise<void> {
		try {
			await (await this.database()).put(STORE_NAME, {
				key,
				analysis,
				updatedAt: Date.now(),
			});
		} catch {
			// A failed cache write only costs a re-analysis next session.
		}
	}
}
