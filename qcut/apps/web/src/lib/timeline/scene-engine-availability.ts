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
let pending: Promise<SceneEngineAvailability[]> | null = null;

/**
 * Which shot-detection engines this machine can run. One inspection serves
 * every concurrent caller (each one probes the runtime and starts a Python
 * check in the main process), and the answer is kept briefly.
 */
export function loadSceneEngineAvailability(): Promise<
	SceneEngineAvailability[]
> {
	if (cached && Date.now() - cached.at < CACHE_MS) {
		return Promise.resolve(cached.engines);
	}
	if (pending) return pending;
	// Everything, including a missing platform bridge, surfaces as a rejection
	// the callers already handle, never as a throw out of a render effect.
	pending = (async () => {
		const engines = platform().claude?.analyze.engines;
		if (!engines) return [];
		const status = await engines();
		cached = { at: Date.now(), engines: status.engines };
		return status.engines;
	})().finally(() => {
		pending = null;
	});
	return pending;
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
