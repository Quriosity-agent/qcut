import path from "node:path";

export const BEAUTY_LAB_RESEARCH_RUN_ENV = "QCUT_BEAUTY_LAB_RESEARCH_RUN";
export const BEAUTY_LAB_OWNED_RUN_ENV = "QCUT_BEAUTY_LAB_OWNED_RUN";

function runDirectory({
	value,
	fallback,
}: {
	value?: string;
	fallback: string;
}) {
	if (value === undefined) return fallback;
	if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(value)) {
		throw new Error("Beauty Lab research run must be a bounded directory name");
	}
	return value;
}

export function resolveBeautyLabResearchPaths({
	sourceRoot,
	isPackaged,
	environment,
}: {
	sourceRoot: string;
	isPackaged: boolean;
	environment: Record<string, string | undefined>;
}) {
	const privateRoot = path.join(sourceRoot, ".local/jianying-model-pytorch");
	// Only the launching process selects runs; renderer requests never select paths.
	const root = path.join(
		privateRoot,
		runDirectory({
			value: isPackaged ? undefined : environment[BEAUTY_LAB_RESEARCH_RUN_ENV],
			fallback: "face-temporal-campaign-20261003-r1",
		})
	);
	const ownedChainRoot = isPackaged
		? undefined
		: path.join(
				privateRoot,
				runDirectory({
					value: environment[BEAUTY_LAB_OWNED_RUN_ENV],
					fallback: "beauty-owned-chain-ui-20261003-r2",
				})
			);
	return {
		root,
		ownedChainRoot,
		currentSourceRoot: path.join(sourceRoot, "research"),
	};
}
