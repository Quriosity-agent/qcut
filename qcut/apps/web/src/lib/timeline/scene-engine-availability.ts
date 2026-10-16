import { platform } from "@qcut/platform-core";
import { useEffect, useState } from "react";
import type { ShotSplitEngine } from "./smart-shot-split";

export interface SceneEngineAvailability {
	engine: ShotSplitEngine;
	available: boolean;
	message: string;
}

const CACHE_MS = 30_000;
let cached: { at: number; engines: SceneEngineAvailability[] } | null = null;

/** Which shot-detection engines this machine can run; answers are cached briefly. */
export async function loadSceneEngineAvailability(): Promise<
	SceneEngineAvailability[]
> {
	if (cached && Date.now() - cached.at < CACHE_MS) return cached.engines;
	const engines = platform().claude?.analyze.engines;
	if (!engines) return [];
	const status = await engines();
	cached = { at: Date.now(), engines: status.engines };
	return status.engines;
}

/** For a menu that opens later than the app starts: resolves once mounted. */
export function useSceneEngineAvailability(): SceneEngineAvailability[] | null {
	const [engines, setEngines] = useState<SceneEngineAvailability[] | null>(
		cached?.engines ?? null
	);
	useEffect(() => {
		let active = true;
		loadSceneEngineAvailability()
			.then((next) => {
				if (active) setEngines(next);
			})
			.catch(() => {
				if (active) setEngines([]);
			});
		return () => {
			active = false;
		};
	}, []);
	return engines;
}
