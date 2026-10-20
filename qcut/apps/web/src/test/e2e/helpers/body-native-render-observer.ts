import type { ElectronApplication } from "@playwright/test";

interface NativeRenderObservation {
	requestId?: string;
	sourceKey?: string;
	frameNumber?: number;
	timestampSeconds?: number;
	freshTracking: boolean;
	preRollFrames: number;
	enteredAt: number;
	completedAt?: number;
	elapsedMs?: number;
	status: "pending" | "completed" | "rejected";
	completed: boolean;
	sourceWindowCacheHit?: boolean;
	nativeRenderCount?: number;
	error?: string;
}

interface NativeRenderObserverState {
	requests: NativeRenderObservation[];
	finished: NativeRenderObservation[];
}

interface ObserverGlobal {
	__nativePortraitRenderObservation?: NativeRenderObserverState;
	__removeNativePortraitRenderObserver?: () => void;
}

/** Records native IPC receipts without changing requests, results, or queue ordering. */
export async function installNativeBodyRenderObserver({
	app,
}: {
	app: ElectronApplication;
}) {
	await app.evaluate(({ ipcMain }) => {
		const target = globalThis as unknown as ObserverGlobal;
		if (target.__nativePortraitRenderObservation)
			throw new Error("Native portrait render observer already installed");
		type InvokeHandler = (event: unknown, request: unknown) => unknown;
		const handlers = (
			ipcMain as unknown as { _invokeHandlers: Map<string, InvokeHandler> }
		)._invokeHandlers;
		const channel = "jianying-portrait-adjustment:render";
		const original = handlers?.get(channel);
		if (!original) throw new Error("Native portrait render IPC unavailable");
		const observation: NativeRenderObserverState = {
			requests: [],
			finished: [],
		};
		target.__nativePortraitRenderObservation = observation;
		const observed: InvokeHandler = (event, request) => {
			const input = request as {
				requestId?: string;
				sourceKey?: string;
				frameNumber?: number;
				timestampSeconds?: number;
				freshTracking?: boolean;
				sourcePreRoll?: { frames?: unknown[] };
			};
			const entry: NativeRenderObservation = {
				requestId: input.requestId,
				sourceKey: input.sourceKey,
				frameNumber: input.frameNumber,
				timestampSeconds: input.timestampSeconds,
				freshTracking: input.freshTracking === true,
				preRollFrames: input.sourcePreRoll?.frames?.length ?? 0,
				enteredAt: Date.now(),
				status: "pending",
				completed: false,
			};
			observation.requests.push(entry);
			const complete = () => {
				entry.completedAt = Date.now();
				entry.elapsedMs = entry.completedAt - entry.enteredAt;
			};
			const rejected = (error: unknown) => {
				complete();
				entry.status = "rejected";
				entry.error = error instanceof Error ? error.message : String(error);
				observation.finished.push(entry);
			};
			try {
				const result = original(event, request);
				void Promise.resolve(result).then((value: unknown) => {
					complete();
					entry.status = "completed";
					entry.completed = true;
					if (value && typeof value === "object") {
						const receipt = value as {
							sourceWindowCacheHit?: unknown;
							nativeRenderCount?: unknown;
						};
						if (typeof receipt.sourceWindowCacheHit === "boolean")
							entry.sourceWindowCacheHit = receipt.sourceWindowCacheHit;
						if (typeof receipt.nativeRenderCount === "number")
							entry.nativeRenderCount = receipt.nativeRenderCount;
					}
					observation.finished.push(entry);
				}, rejected);
				return result;
			} catch (error) {
				rejected(error);
				throw error;
			}
		};
		handlers.set(channel, observed);
		target.__removeNativePortraitRenderObserver = () => {
			if (handlers.get(channel) === observed) handlers.set(channel, original);
			target.__nativePortraitRenderObservation = undefined;
			target.__removeNativePortraitRenderObserver = undefined;
		};
	});
}

export async function readNativeBodyRenderObservation({
	app,
}: {
	app: ElectronApplication;
}) {
	return app.evaluate(() => {
		const observation = (globalThis as unknown as ObserverGlobal)
			.__nativePortraitRenderObservation;
		if (!observation) throw new Error("Native portrait observer not installed");
		return observation;
	});
}

export async function removeNativeBodyRenderObserver({
	app,
}: {
	app: ElectronApplication;
}) {
	await app.evaluate(() =>
		(
			globalThis as unknown as ObserverGlobal
		).__removeNativePortraitRenderObserver?.()
	);
}
