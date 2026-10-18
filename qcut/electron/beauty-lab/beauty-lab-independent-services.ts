import path from "node:path";
import { createBeautyLabIndependentProvider } from "./beauty-lab-independent.js";
import { createIndependentSequenceFrameRenderer } from "./beauty-lab-independent-body-video.js";
import { createIndependentFrameCache } from "./beauty-lab-independent-frame-cache.js";
import {
	createIndependentFrameRenderer,
	independentEngineSha256,
} from "./beauty-lab-independent-frames.js";
import { createIndependentRenderQueue } from "./beauty-lab-independent-queue.js";

/**
 * Builds the independent engine once for Beauty Lab and the timeline: both
 * share one render queue, and timeline frames also go through the disk cache.
 * Body-video frames share that cache and keep their session checkpoints
 * beside it.
 */
export function createIndependentBeautyServices({
	sourceRoot,
	isPackaged,
	resourcesPath,
	userDataPath,
	environment,
}: {
	sourceRoot: string;
	isPackaged: boolean;
	resourcesPath: string;
	userDataPath: string;
	environment: Record<string, string | undefined>;
}) {
	const engineRoot = isPackaged
		? path.join(resourcesPath, "independent-beauty")
		: path.join(sourceRoot, "research/independent-beauty");
	const installedRuntime = path.join(
		userDataPath,
		"PrivateRuntimes/IndependentBeauty/current"
	);
	const independentProvider = createIndependentRenderQueue({
		provider: createBeautyLabIndependentProvider({
			engineRoot,
			runtimeRoot:
				environment.QCUT_INDEPENDENT_BEAUTY_RUNTIME ??
				(isPackaged ? installedRuntime : path.join(engineRoot, "runtime")),
			python:
				environment.QCUT_INDEPENDENT_BEAUTY_PYTHON ??
				(isPackaged
					? path.join(installedRuntime, ".venv/bin/python")
					: path.join(engineRoot, "research/.venv/bin/python")),
		}),
	});
	const cache = createIndependentFrameCache({
		directory: path.join(userDataPath, "Cache", "independent-beauty-frames"),
	});
	const engineSha256 = () => independentEngineSha256({ engineRoot });
	const independentFrames = createIndependentFrameRenderer({
		provider: independentProvider,
		cache,
		engineSha256,
	});
	const independentSequenceFrames = createIndependentSequenceFrameRenderer({
		provider: independentProvider,
		cache,
		engineSha256,
		sessionsDirectory: path.join(
			userDataPath,
			"Cache",
			"independent-beauty-sessions"
		),
	});
	return { independentProvider, independentFrames, independentSequenceFrames };
}
