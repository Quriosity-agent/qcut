import type {
	JianyingPortraitAdjustmentRenderRequest,
	JianyingPortraitAdjustmentRenderResult,
} from "./jianying-portrait-adjustment-contract.js";
import { createPortraitRenderDiskCache } from "./render-disk-cache.js";
import {
	createPortraitRenderIdentity,
	isCacheablePortraitSourceWindow,
	portraitSourceWindowCacheKey,
} from "./render-cache-identity.js";

export function createPortraitSourceWindowRenderCache({
	cache = createPortraitRenderDiskCache(),
	identity = createPortraitRenderIdentity(),
}: {
	cache?: ReturnType<typeof createPortraitRenderDiskCache>;
	identity?: ReturnType<typeof createPortraitRenderIdentity>;
} = {}) {
	let warned = false;
	function warn({ error }: { error: unknown }) {
		if (warned) return;
		warned = true;
		console.warn(
			"[native-portrait] Deterministic render cache unavailable:",
			error
		);
	}
	return {
		render: async ({
			request,
			signal,
			renderFresh,
			applyCachedResult,
		}: {
			request: JianyingPortraitAdjustmentRenderRequest;
			signal?: AbortSignal;
			renderFresh: () => Promise<JianyingPortraitAdjustmentRenderResult>;
			applyCachedResult: ({
				result,
				assertReplayIdentity,
			}: {
				result: JianyingPortraitAdjustmentRenderResult;
				assertReplayIdentity: () => Promise<void>;
			}) => Promise<void>;
		}) => {
			signal?.throwIfAborted();
			if (!isCacheablePortraitSourceWindow({ request })) return renderFresh();
			let runtimeIdentity: string | undefined;
			let key: string | undefined;
			try {
				runtimeIdentity = await identity.resolve({ request, signal });
				key = portraitSourceWindowCacheKey({ request, runtimeIdentity });
				const cached = await cache.read({
					key,
					width: request.width,
					height: request.height,
					signal,
				});
				signal?.throwIfAborted();
				if (
					cached &&
					(await identity.resolve({ request, signal })) === runtimeIdentity
				) {
					await applyCachedResult({
						result: cached,
						assertReplayIdentity: async () => {
							if ((await identity.resolve({ request })) !== runtimeIdentity)
								throw new Error(
									"Native runtime changed before restoring cached tracking state"
								);
						},
					});
					signal?.throwIfAborted();
					return {
						...cached,
						sourceWindowCacheHit: true,
						nativeRenderCount: 0,
					};
				}
			} catch (error) {
				if (signal?.aborted) throw error;
				warn({ error });
				key = undefined;
			}
			signal?.throwIfAborted();
			// Once native replay starts, finish its original command sequence even if the caller cancels.
			const result = await renderFresh();
			if (key && !result.needsSourcePreRoll) {
				try {
					if ((await identity.resolve({ request })) === runtimeIdentity)
						await cache.write({ key, result });
				} catch (error) {
					warn({ error });
				}
			}
			return { ...result, sourceWindowCacheHit: false };
		},
		close: async () => {
			await cache.close();
			identity.clear();
		},
	};
}
