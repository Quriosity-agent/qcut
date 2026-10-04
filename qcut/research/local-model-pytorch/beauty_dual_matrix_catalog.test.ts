import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_ADJUSTMENT_CATALOG,
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	jianyingPortraitControl,
	jianyingPortraitRuntimePackageForControl,
} from "../../electron/jianying-portrait-adjustment-runtime/catalog.js";
import {
	buildJianyingDynamicMakeupParameters,
	buildJianyingStandaloneMakeupParameters,
	JIANYING_PORTRAIT_MAKEUP_CARDS,
} from "../../electron/jianying-portrait-adjustment-runtime/makeup-catalog.js";
import { JIANYING_PORTRAIT_SKIN_TONES } from "../../electron/jianying-portrait-adjustment-runtime/skin-tone-catalog.js";
import faceShapeReference from "../../scripts/fixtures/portrait-face-shape-reference.json";
import {
	BEAUTY_DUAL_MATRIX_CONTROL_KEYS,
	beautyDualMatrixCatalog,
	type BeautyDualMatrixCase,
} from "./beauty_dual_matrix_catalog.js";

let directory: string;
let runtime: string;
let effectCacheRoot: string;

beforeEach(() => {
	directory = mkdtempSync(join(realpathSync(tmpdir()), "beauty-dual-catalog-"));
	runtime = join(directory, "pinned-runtime");
	effectCacheRoot = join(directory, "explicit-effect-cache");
	mkdirSync(runtime);
	mkdirSync(effectCacheRoot);
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

function installDirectory({
	identity,
	root = join(runtime, "Cache/effect"),
}: {
	identity: { resourceId: string; version: string };
	root?: string;
}) {
	const path = join(root, identity.resourceId, identity.version);
	mkdirSync(path, { recursive: true });
	return path;
}

function findCase({
	cases,
	id,
}: {
	cases: BeautyDualMatrixCase[];
	id: string;
}) {
	const sample = cases.find((candidate) => candidate.id === id);
	if (!sample) throw new Error(`Missing test case ${id}`);
	return sample;
}

describe("beauty dual matrix product coverage", () => {
	it("contains exactly the 13 main face controls and representative fine controls", () => {
		const cases = beautyDualMatrixCatalog({ runtime });
		expect(BEAUTY_DUAL_MATRIX_CONTROL_KEYS["face-shape"]).toEqual(
			faceShapeReference.faceControls.map(({ key }) => key)
		);
		expect(BEAUTY_DUAL_MATRIX_CONTROL_KEYS["face-shape"]).toHaveLength(13);
		for (const [category, keys] of Object.entries(
			BEAUTY_DUAL_MATRIX_CONTROL_KEYS
		)) {
			expect(
				new Set(
					cases
						.filter((sample) => sample.category === category)
						.map(({ key }) => key)
				)
			).toEqual(new Set(keys));
			for (const key of keys) {
				const control = jianyingPortraitControl({ key });
				expect(control).toBeDefined();
				if (!control) throw new Error(`Missing control: ${key}`);
				for (const value of new Set(
					[40, 80].map((level) =>
						Math.min(control.max, Math.max(control.min, level))
					)
				)) {
					expect(findCase({ cases, id: `${key}-p${value}` })).toMatchObject({
						key,
						value,
						category,
						expectedChange: true,
					});
				}
			}
		}
		expect(BEAUTY_DUAL_MATRIX_CONTROL_KEYS.skin).toEqual(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
				({ section }) => section === "skin"
			).map(({ key }) => key)
		);
	});

	it("emits the official payload and one adjustment for every numeric case", () => {
		const cases = beautyDualMatrixCatalog({ runtime });
		for (const sample of cases.filter(
			({ category }) => category !== "makeup"
		)) {
			const control = jianyingPortraitControl({ key: sample.key });
			if (!control) throw new Error(`Unknown product control: ${sample.key}`);
			expect(sample.runtimePackage).toBe(
				jianyingPortraitRuntimePackageForControl({ control })
			);
			expect(sample.parameters).toEqual(
				JSON.parse(
					buildJianyingPortraitFeatureParameters({
						runtimePackage: sample.runtimePackage,
						values: sample.adjustments.values,
						targetFaceId: -1,
					})
				)
			);
			expect(sample.adjustments.values).toEqual({ [sample.key]: sample.value });
			expect(sample.dependencies).toEqual([sample.package]);
			expect(sample.packageBindings).toHaveLength(1);
			expect(sample.adjustments.makeup).toBeUndefined();
		}
	});

	it.each(
		JIANYING_PORTRAIT_MAKEUP_CARDS
	)("uses the official builder for $id", (card) => {
		const cases = beautyDualMatrixCatalog({ runtime });
		const sample = findCase({ cases, id: `makeup-${card.id}-p80` });
		const cardPath = join(
			runtime,
			"Cache/effect",
			card.resourceId,
			card.version
		);
		const expected =
			card.kind === "dynamic"
				? buildJianyingDynamicMakeupParameters({
						selections: [{ card, intensity: 80, packagePath: cardPath }],
						targetFaceId: -1,
					})
				: buildJianyingStandaloneMakeupParameters({
						card,
						intensity: 80,
						targetFaceId: -1,
					});
		expect(sample.parameters).toEqual(JSON.parse(expected));
		expect(sample.adjustments).toEqual({
			enabled: true,
			values: {},
			makeup: { [card.category]: { cardId: card.id, intensity: 80 } },
		});
		expect(sample.legacyOnly).toBe(card.legacyOnly === true);
		expect(sample.dependencies).toEqual(
			card.kind === "dynamic" ? [sample.package, cardPath] : [cardPath]
		);
		expect(sample.packageBindings.map(({ path }) => path)).toEqual(
			sample.dependencies
		);
		expect(sample.available).toBe(false);
		expect(sample.unavailableReasons).toHaveLength(sample.dependencies.length);
	});

	it("truthfully covers 28 selectable cards and preserves the 29th legacy card", () => {
		const cases = beautyDualMatrixCatalog({ runtime });
		const cards = cases.filter(
			({ category, value }) => category === "makeup" && value === 40
		);
		expect(cards).toHaveLength(JIANYING_PORTRAIT_MAKEUP_CARDS.length);
		expect(cards.filter(({ legacyOnly }) => !legacyOnly)).toHaveLength(28);
		expect(
			cards.filter(({ legacyOnly }) => legacyOnly).map(({ cardId }) => cardId)
		).toEqual(["brows-flow"]);
		const selectable = beautyDualMatrixCatalog({
			runtime,
			includeLegacyMakeup: false,
		});
		expect(selectable.some(({ legacyOnly }) => legacyOnly)).toBe(false);
		expect(
			new Set(
				selectable.filter(({ cardId }) => cardId).map(({ cardId }) => cardId)
			).size
		).toBe(28);
	});

	it("clamps signed magnitudes to product bounds and deduplicates actual levels", () => {
		const cases = beautyDualMatrixCatalog({ runtime });
		for (const sample of cases.filter(
			({ category }) => category !== "makeup"
		)) {
			const control = jianyingPortraitControl({ key: sample.key });
			if (!control) throw new Error(`Missing control: ${sample.key}`);
			expect(sample.outOfProductRange).toBe(false);
			expect(sample.value).toBeGreaterThanOrEqual(control.min);
			expect(sample.value).toBeLessThanOrEqual(control.max);
			if (control.min >= 0) expect(sample.value).toBeGreaterThanOrEqual(0);
		}
		expect(findCase({ cases, id: "face_adjust_Chin-n50" })).toMatchObject({
			value: -50,
			outOfProductRange: false,
			parameters: { face_adjust_Chin: [{ id: -1, intensity: -0.5 }] },
		});
		expect(
			findCase({ cases, id: "face_adjust_Chin-p40" }).outOfProductRange
		).toBe(false);
		expect(
			findCase({ cases, id: "face_adjust_EyeTilted-n80" }).outOfProductRange
		).toBe(false);
		expect(
			beautyDualMatrixCatalog({ runtime, includeNegative: false }).every(
				({ value }) => value >= 0
			)
		).toBe(true);
		const clamped = beautyDualMatrixCatalog({
			runtime,
			levels: [80, 100],
		}).filter(({ key }) => key === "face_adjust_Chin");
		expect(clamped.map(({ value }) => value)).toEqual([50, -50]);
	});

	it("keeps scalar skin, aliased teeth/smile, and case-sensitive nose builders intact", () => {
		const cases = beautyDualMatrixCatalog({ runtime });
		expect(
			findCase({ cases, id: "face_adjust_Whiten-p40" }).parameters
		).toEqual({ intensity: 0.4 });
		expect(
			findCase({ cases, id: "face_adjust_WhiteTeeth-p40" }).parameters
		).toEqual({ face_adjust: [{ id: -1, intensity: 0.4 }] });
		expect(findCase({ cases, id: "face_adjust_Smile-p40" }).parameters).toEqual(
			{ face_adjust_SmallFace: [{ id: -1, intensity: 0.4 }] }
		);
		const classic = findCase({ cases, id: "face_adjust_Nose-p40" });
		const detail = findCase({ cases, id: "face_adjust_nose-p40" });
		expect(classic.runtimePackage).toBe("face");
		expect(detail.runtimePackage).toBe("features");
		expect(classic.parameters).not.toHaveProperty("face_adjust_nose");
		expect(detail.parameters).not.toHaveProperty("face_adjust_Nose");
	});

	it("deduplicates levels, emits zero expectations, and has stable unique JSON ids", () => {
		const options = { runtime, levels: [0, 40, 40] };
		const cases = beautyDualMatrixCatalog(options);
		expect(new Set(cases.map(({ id }) => id)).size).toBe(cases.length);
		expect(
			cases.every(
				({ value, expectedChange }) => expectedChange === (value !== 0)
			)
		).toBe(true);
		expect(cases.some(({ value }) => Object.is(value, -0))).toBe(false);
		expect(JSON.parse(JSON.stringify(cases))).toEqual(cases);
		expect(beautyDualMatrixCatalog(options)).toEqual(cases);
	});

	it.each(
		[[], [-1], [101], [Number.NaN], [Number.POSITIVE_INFINITY]].map(
			(levels) => ({ levels })
		)
	)("rejects malformed magnitudes $levels", ({ levels }) => {
		expect(() => beautyDualMatrixCatalog({ runtime, levels })).toThrow(
			"Probe levels"
		);
	});
});

describe("pinned package bindings", () => {
	it("marks missing packages unavailable without dropping any cases or discovering other roots", () => {
		installDirectory({
			identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.smooth,
			root: effectCacheRoot,
		});
		const cases = beautyDualMatrixCatalog({ runtime });
		expect(cases.length).toBeGreaterThan(100);
		expect(cases.every(({ available }) => !available)).toBe(true);
		expect(
			cases.every(({ unavailableReasons }) => unavailableReasons.length > 0)
		).toBe(true);
		const missingRuntime = beautyDualMatrixCatalog({
			runtime: join(directory, "not-installed"),
		});
		expect(missingRuntime.map(({ id }) => id)).toEqual(
			cases.map(({ id }) => id)
		);
		expect(missingRuntime.every(({ available }) => !available)).toBe(true);
	});

	it("prefers the exact private identity and only falls back to the explicitly supplied cache", () => {
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES.smooth;
		installDirectory({ identity, root: effectCacheRoot });
		const fallback = findCase({
			cases: beautyDualMatrixCatalog({ runtime, effectCacheRoot }),
			id: "face_adjust_Smooth-p40",
		});
		expect(fallback.packageBindings[0]).toMatchObject({
			source: "effect-cache",
			available: true,
			resourceId: identity.resourceId,
			version: identity.version,
		});
		const privatePath = installDirectory({ identity });
		const preferred = findCase({
			cases: beautyDualMatrixCatalog({ runtime, effectCacheRoot }),
			id: fallback.id,
		});
		expect(preferred.package).toBe(privatePath);
		expect(preferred.packageBindings[0].source).toBe("private");
		expect(preferred.available).toBe(true);
		expect(preferred.unavailableReasons).toEqual([]);
	});

	it.each([
		{ hostRoot: "private", cardRoot: "cache" },
		{ hostRoot: "cache", cardRoot: "private" },
	])("binds a dynamic host in $hostRoot and card in $cardRoot independently", ({
		hostRoot,
		cardRoot,
	}) => {
		const card = JIANYING_PORTRAIT_MAKEUP_CARDS.find(
			({ id }) => id === "lip-soft-pink"
		);
		if (!card) throw new Error("Missing lip card");
		const privateRoot = join(runtime, "Cache/effect");
		const host = installDirectory({
			identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.makeup,
			root: hostRoot === "private" ? privateRoot : effectCacheRoot,
		});
		const cardPath = installDirectory({
			identity: card,
			root: cardRoot === "private" ? privateRoot : effectCacheRoot,
		});
		const sample = findCase({
			cases: beautyDualMatrixCatalog({ runtime, effectCacheRoot }),
			id: "makeup-lip-soft-pink-p80",
		});
		expect(sample.package).toBe(host);
		expect(sample.dependencies).toEqual([host, cardPath]);
		expect(sample.parameters[card.parameterKey]).toEqual([
			{ id: -1, intensity: 0.8, path: cardPath },
		]);
		expect(sample.available).toBe(true);
	});

	it.each([
		{ missing: "host" },
		{ missing: "card" },
	])("keeps a dynamic case unavailable when its $missing is missing", ({
		missing,
	}) => {
		const card = JIANYING_PORTRAIT_MAKEUP_CARDS.find(
			({ id }) => id === "lip-soft-pink"
		);
		if (!card) throw new Error("Missing lip card");
		installDirectory({
			identity:
				missing === "host" ? card : JIANYING_PORTRAIT_PACKAGE_IDENTITIES.makeup,
		});
		const sample = findCase({
			cases: beautyDualMatrixCatalog({ runtime }),
			id: "makeup-lip-soft-pink-p80",
		});
		expect(sample.available).toBe(false);
		expect(sample.unavailableReasons).toHaveLength(1);
		expect(sample.packageBindings.map(({ available }) => available)).toEqual(
			missing === "host" ? [false, true] : [true, false]
		);
	});

	it("uses a standalone card as the only host, without requiring the dynamic host", () => {
		const card = JIANYING_PORTRAIT_MAKEUP_CARDS.find(
			({ id }) => id === "look-oxygen"
		);
		if (!card) throw new Error("Missing standalone card");
		const path = installDirectory({ identity: card });
		const sample = findCase({
			cases: beautyDualMatrixCatalog({ runtime }),
			id: "makeup-look-oxygen-p80",
		});
		expect(sample.package).toBe(path);
		expect(sample.dependencies).toEqual([path]);
		expect(sample.available).toBe(true);
		expect(sample.parameters[card.parameterKey]).toEqual([
			{ id: -1, intensity: 0.8, disable_part: [] },
		]);
	});

	it("never picks a different cached version", () => {
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES.smooth;
		installDirectory({
			identity: { ...identity, version: "different-version" },
		});
		const sample = findCase({
			cases: beautyDualMatrixCatalog({ runtime }),
			id: "face_adjust_Smooth-p40",
		});
		expect(sample.available).toBe(false);
		expect(sample.package).toBe(
			join(runtime, "Cache/effect", identity.resourceId, identity.version)
		);
	});

	it("emits every skin swatch with its exact identity and preserves legacy default semantics", () => {
		for (const tone of JIANYING_PORTRAIT_SKIN_TONES)
			installDirectory({ identity: tone });
		const cases = beautyDualMatrixCatalog({ runtime });
		for (const tone of JIANYING_PORTRAIT_SKIN_TONES) {
			const sample = findCase({
				cases,
				id: `skin-tone-${tone.resourceId}-p40`,
			});
			expect(sample.package).toBe(
				join(runtime, "Cache/effect", tone.resourceId, tone.version)
			);
			expect(sample.adjustments.skinToneResourceId).toBe(tone.resourceId);
			expect(sample.available).toBe(true);
		}
		const legacy = findCase({ cases, id: "face_adjust_skin_Intensity-p40" });
		expect(legacy.adjustments.skinToneResourceId).toBeUndefined();
		expect(legacy.available).toBe(false);
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES["skin-tone"];
		const legacyPath = installDirectory({ identity, root: effectCacheRoot });
		const selected = findCase({
			cases: beautyDualMatrixCatalog({ runtime, effectCacheRoot }),
			id: `skin-tone-${identity.resourceId}-p40`,
		});
		expect(selected.package).toBe(legacyPath);
	});
});

describe("local path safety and JSON CLI", () => {
	it.each([
		"relative/runtime",
		"/tmp/../runtime",
		"/tmp/runtime/",
		"/tmp//runtime",
		"/tmp/runtime\n",
		"/tmp/runtime\t",
		"/tmp/runtime\0",
	])("rejects noncanonical path %j", (path) => {
		expect(() => beautyDualMatrixCatalog({ runtime: path })).toThrow(
			"Canonical absolute"
		);
		expect(() =>
			beautyDualMatrixCatalog({ runtime, effectCacheRoot: path })
		).toThrow("Canonical absolute");
	});

	it("rejects an empty or missing explicit cache root", () => {
		expect(() =>
			beautyDualMatrixCatalog({ runtime, effectCacheRoot: "" })
		).toThrow("Canonical absolute");
		expect(() =>
			beautyDualMatrixCatalog({
				runtime,
				effectCacheRoot: join(directory, "missing"),
			})
		).toThrow("existing directory");
	});

	it.each([
		{ target: "runtime" },
		{ target: "cache" },
	])("rejects symlinked $target roots, even with missing package leaves", ({
		target,
	}) => {
		const link = join(directory, "root-link");
		symlinkSync(target === "runtime" ? runtime : effectCacheRoot, link);
		expect(() =>
			beautyDualMatrixCatalog({
				runtime: target === "runtime" ? link : runtime,
				effectCacheRoot: target === "cache" ? link : undefined,
			})
		).toThrow("without symlinks");
	});

	it.each([
		{ component: "Cache" },
		{ component: "resource" },
		{ component: "version" },
	])("rejects a symlinked $component before fallback", ({ component }) => {
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES.smooth;
		const root = join(runtime, "Cache/effect");
		let link = join(runtime, "Cache");
		if (component === "resource") link = join(root, identity.resourceId);
		if (component === "version")
			link = join(root, identity.resourceId, identity.version);
		mkdirSync(join(link, ".."), { recursive: true });
		symlinkSync(effectCacheRoot, link);
		installDirectory({ identity, root: effectCacheRoot });
		expect(() => beautyDualMatrixCatalog({ runtime, effectCacheRoot })).toThrow(
			"without symlinks"
		);
	});

	it("rejects a dangling dynamic-card symlink and regular-file packages", () => {
		const card = JIANYING_PORTRAIT_MAKEUP_CARDS.find(
			({ id }) => id === "lip-soft-pink"
		);
		if (!card) throw new Error("Missing card");
		const root = join(runtime, "Cache/effect");
		const parent = join(root, card.resourceId);
		mkdirSync(parent, { recursive: true });
		symlinkSync(join(directory, "missing-target"), join(parent, card.version));
		expect(() => beautyDualMatrixCatalog({ runtime })).toThrow(
			"without symlinks"
		);
		rmSync(join(parent, card.version));
		writeFileSync(join(parent, card.version), "not a package directory");
		expect(() => beautyDualMatrixCatalog({ runtime })).toThrow(
			"real directory"
		);
	});

	it("prints only the deterministic array, performs no asset writes, and checks CLI arguments", () => {
		const script = fileURLToPath(
			new URL("./beauty_dual_matrix_catalog.ts", import.meta.url)
		);
		const before = readdirSync(directory, { recursive: true });
		const result = spawnSync(
			process.execPath,
			[script, runtime, effectCacheRoot],
			{ encoding: "utf8" }
		);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual(
			beautyDualMatrixCatalog({ runtime, effectCacheRoot })
		);
		expect(readdirSync(directory, { recursive: true })).toEqual(before);
		const invalid = spawnSync(process.execPath, [script], { encoding: "utf8" });
		expect(invalid.status).not.toBe(0);
		expect(invalid.stdout).toBe("");
		expect(invalid.stderr).toContain("Usage:");
	});
});
