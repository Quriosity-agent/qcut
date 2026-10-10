// @vitest-environment node
import {
	mkdir,
	mkdtemp,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createBeautyLabLiveSelectionResolver,
	selectBeautyLabLiveRequest,
} from "../beauty-lab/beauty-lab-live-selection.js";
import { pinRoot } from "../beauty-lab-research-files.js";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_ADJUSTMENT_CATALOG,
	JIANYING_PORTRAIT_PACKAGE_IDENTITIES,
	jianyingPortraitRuntimePackageForControl,
} from "../jianying-portrait-adjustment-runtime/catalog.js";
import {
	buildJianyingDynamicMakeupParameters,
	buildJianyingStandaloneMakeupParameters,
	JIANYING_PORTRAIT_MAKEUP_CARDS,
} from "../jianying-portrait-adjustment-runtime/makeup-catalog.js";
import { resolveJianyingPortraitMakeupCard } from "../jianying-portrait-adjustment-runtime/makeup-resolver.js";
import { resolveJianyingPortraitPackage } from "../jianying-portrait-adjustment-runtime/package-resolver.js";
import { JIANYING_PORTRAIT_SKIN_TONES } from "../jianying-portrait-adjustment-runtime/skin-tone-catalog.js";

const mocks = vi.hoisted(() => ({
	current: vi.fn(),
	resolve: vi.fn(),
	makeup: vi.fn(),
}));
vi.mock("node:path", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:path")>();
	// Isolate native join spies from path.posix on POSIX hosts.
	return { ...actual, default: { ...actual.default } };
});
vi.mock("../jianying-filter-local-runtime/private-runtime.js", () => ({
	jianyingFilterPrivateRuntimeCurrent: mocks.current,
}));
vi.mock("../jianying-portrait-adjustment-runtime/package-resolver.js", () => ({
	resolveJianyingPortraitPackage: mocks.resolve,
}));
vi.mock("../jianying-portrait-adjustment-runtime/makeup-resolver.js", () => ({
	resolveJianyingPortraitMakeupCard: mocks.makeup,
}));

function select({
	values = { face_adjust_eye: 40 },
	patch = {},
}: {
	values?: Record<string, unknown>;
	patch?: Record<string, unknown>;
} = {}) {
	return selectBeautyLabLiveRequest({
		request: { adjustments: { enabled: true, values, ...patch } },
	});
}

describe("strict raw single-stage static selection", () => {
	it.each(
		JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(({ group }) => group === "face")
	)("uses product numeric parameters for $key", (control) => {
		const values = { [control.key]: control.max };
		const runtimePackage = jianyingPortraitRuntimePackageForControl({
			control,
		});
		expect(select({ values })).toEqual({
			kind: "numeric",
			runtimePackage,
			parameters: JSON.parse(
				buildJianyingPortraitFeatureParameters({ runtimePackage, values })
			),
		});
	});
	it("allows multiple controls in the same package and zero UI defaults", () => {
		expect(
			select({
				values: {
					face_adjust_eye: 40,
					face_adjust_eye_height: -20,
					body_adjust_SlimBody: 0,
				},
				patch: {
					faces: [],
					makeup: {},
					manualBody: {},
					manualRetouch: { strokes: [] },
					faceTarget: { mode: "all" },
				},
			})
		).toMatchObject({ kind: "numeric", runtimePackage: "features" });
	});
	it.each(
		JIANYING_PORTRAIT_MAKEUP_CARDS
	)("recognizes catalog card $id", (card) => {
		expect(
			select({
				values: {},
				patch: {
					makeup: { [card.category]: { cardId: card.id, intensity: 60 } },
				},
			})
		).toEqual({ kind: "makeup", card, intensity: 60 });
	});
	it.each([
		{ enabled: false },
		{ enabled: "true" },
		{ unknown: undefined },
		{ packagePath: "/tmp/forged" },
		{ values: null },
		{ values: [] },
		{ values: {} },
		{ values: { face_adjust_eye: 0 } },
		{ values: { unknown: 0, face_adjust_eye: 40 } },
		{ values: { face_adjust_eye: "40" } },
		{ values: { face_adjust_eye: Number.NaN } },
		{ values: { face_adjust_eye: Number.POSITIVE_INFINITY } },
		{ values: { face_adjust_eye: 101 } },
		{ values: { face_adjust_eye: -101 } },
		{ values: { body_adjust_SlimBody: 40 } },
		{ values: { face_adjust_eye: 40, face_adjust_Smooth: 10 } },
		{ values: { face_adjust_Smooth: 30, face_adjust_Whiten: 30 } },
		{ faceTarget: { mode: "single", faceId: 0 } },
		{ faceTarget: { mode: "all", faceId: 0 } },
		{ faceTarget: null },
		{ faces: [{}] },
		{ faces: { length: 0 } },
		{ manualBody: { zoom: {} } },
		{ manualBody: [] },
		{ manualRetouch: {} },
		{ manualRetouch: { strokes: [{}] } },
		{ manualRetouch: { strokes: [], ignored: true } },
		{ skinToneResourceId: "forged" },
		{ skinToneResourceId: "7408757645705776384" },
		{ makeup: [] },
		{ makeup: { lip: { cardId: "lip-soft-pink", intensity: 40 } } },
	])("rejects unsupported raw adjustments before normalization: %j", (patch) => {
		expect(() => select({ patch })).toThrow();
	});
	it.each([
		"face_adjust_skin_Intensity",
		"face_adjust_skin_ColdWarm",
	])("rejects disabled skin tone with active %s instead of selecting the legacy package", (key) => {
		expect(() =>
			select({ values: { [key]: 40 }, patch: { skinToneResourceId: null } })
		).toThrow(/Explicitly disabled skin tone/);
		expect(mocks.resolve).not.toHaveBeenCalled();
	});
	it.each([
		{ lip: { cardId: "unknown", intensity: 40 } },
		{ wrongCategory: { cardId: "lip-soft-pink", intensity: 40 } },
		{ lip: { cardId: "lip-soft-pink", intensity: 0 } },
		{ lip: { cardId: "lip-soft-pink", intensity: -1 } },
		{ lip: { cardId: "lip-soft-pink", intensity: 101 } },
		{ lip: { cardId: "lip-soft-pink", intensity: Number.NaN } },
		{ lip: { cardId: "lip-soft-pink", intensity: "40" } },
		{ lip: { cardId: "lip-soft-pink", intensity: 40, path: "/tmp/forged" } },
		{ lip: { cardId: "lip-soft-pink", intensity: 40, ignored: undefined } },
		{
			lip: {
				cardId: "lip-soft-pink",
				intensity: 40,
				faceEntries: [{ id: 0, intensity: 40 }],
			},
		},
		{
			lip: { cardId: "lip-soft-pink", intensity: 40 },
			look: { cardId: "look-oxygen", intensity: 40 },
		},
		{
			lip: { cardId: "lip-soft-pink", intensity: 40 },
			look: { cardId: "look-oxygen", intensity: 0 },
		},
	])("rejects forged/zero/multiple raw makeup cards: %j", (makeup) => {
		expect(() => select({ values: {}, patch: { makeup } })).toThrow();
	});
	it.each([
		"sourcePreRoll",
		"packagePath",
		"additionalPackagePath",
		"parameters",
		"personBindings",
		"__proto__",
	])("rejects raw request key %s even when undefined", (key) => {
		expect(() =>
			selectBeautyLabLiveRequest({
				request: {
					adjustments: { enabled: true, values: { face_adjust_eye: 40 } },
					[key]: undefined,
				},
			})
		).toThrow();
	});
	it("rejects unknown dictionary keys before schema normalization can discard them", () => {
		expect(() =>
			select({ values: JSON.parse('{"face_adjust_eye":40,"__proto__":0}') })
		).toThrow();
		expect(() =>
			select({
				values: {},
				patch: {
					makeup: JSON.parse(
						'{"lip":{"cardId":"lip-soft-pink","intensity":40},"__proto__":{"cardId":"lip-soft-pink","intensity":40}}'
					),
				},
			})
		).toThrow();
	});
});

let root: string;
let runtime: string;
let effectRoot: string;
beforeEach(async () => {
	vi.clearAllMocks();
	root = await realpath(
		await mkdtemp(path.join(os.tmpdir(), "qcut-live-selection-"))
	);
	runtime = path.join(root, "private");
	effectRoot = path.join(root, "Movies/JianyingPro/User Data/Cache/effect");
	await mkdir(runtime);
	vi.spyOn(os, "homedir").mockReturnValue(root);
	mocks.current.mockReturnValue(runtime);
	vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "0");
	const numeric = await vi.importActual<
		typeof import("../jianying-portrait-adjustment-runtime/package-resolver.js")
	>("../jianying-portrait-adjustment-runtime/package-resolver.js");
	const makeup = await vi.importActual<
		typeof import("../jianying-portrait-adjustment-runtime/makeup-resolver.js")
	>("../jianying-portrait-adjustment-runtime/makeup-resolver.js");
	mocks.resolve.mockImplementation(numeric.resolveJianyingPortraitPackage);
	mocks.makeup.mockImplementation(makeup.resolveJianyingPortraitMakeupCard);
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

async function install({
	identity,
	cache = false,
}: {
	identity: { resourceId: string; version: string };
	cache?: boolean;
}) {
	const directory = path.join(
		cache ? effectRoot : path.join(runtime, "Cache/effect"),
		identity.resourceId,
		identity.version
	);
	const files = [
		"algorithmConfig.json",
		"config.json",
		"makeup.prefab",
		"AmazingFeature/main.scene",
		"AmazingFeature/lua/EffectFaceMakeup.lua",
		"AmazingFeature/material/skinSeg.material",
		...[
			"filter_skin",
			"filter_bg",
			"temperature_min",
			"temperature_max",
			"mask",
		].map((name) => `AmazingFeature/image/${name}.png`),
	];
	await Promise.all(
		files.map(async (file) => {
			const filename = path.join(directory, file);
			await mkdir(path.dirname(filename), { recursive: true });
			await writeFile(filename, "synthetic; never rendered");
		})
	);
	return directory;
}

async function resolver({ allowProductCache = false } = {}) {
	return createBeautyLabLiveSelectionResolver({
		runtimeRoot: await pinRoot({ root: runtime }),
		allowProductCache,
	});
}

const pathModes = [{ windows: false }, { windows: true }];
describe.each(pathModes)("catalog paths (Windows: $windows)", ({ windows }) => {
	beforeEach(() => {
		if (!windows) return;
		const nativeJoin = path.join;
		vi.spyOn(path, "join").mockImplementation((...parts) => {
			// Keep real filesystem checks while emulating Windows relative joins.
			if (path.isAbsolute(parts[0] ?? "")) {
				return nativeJoin(
					...parts.map((part) => part.replaceAll("\\", path.sep))
				);
			}
			return path.win32.join(...parts);
		});
	});
	it("prefers private runtime over the normal product cache", async () => {
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES.features;
		const expected = await install({ identity });
		await install({ identity, cache: true });
		const resolve = await resolver({ allowProductCache: true });
		expect((await resolve({ selection: select() })).packagePath).toBe(expected);
	});
	it("requires explicit cache opt-in and respects product cache disable", async () => {
		const expected = await install({
			identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.features,
			cache: true,
		});
		const denied = await resolver();
		await expect(denied({ selection: select() })).rejects.toThrow(/disabled/);
		const allowed = await resolver({ allowProductCache: true });
		expect((await allowed({ selection: select() })).packagePath).toBe(expected);
		vi.stubEnv("QCUT_JIANYING_DISABLE_USER_CACHE", "1");
		await expect(allowed({ selection: select() })).rejects.toThrow(
			/unavailable/
		);
	});
	it("retains private-only operation without any product cache directory", async () => {
		const expected = await install({
			identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.face,
		});
		const resolve = await resolver({ allowProductCache: true });
		expect(
			(
				await resolve({
					selection: select({ values: { face_adjust_TotalFace: 40 } }),
				})
			).packagePath
		).toBe(expected);
	});
	it.each(
		JIANYING_PORTRAIT_SKIN_TONES
	)("resolves the exact skin tone $resourceId", async (tone) => {
		const expected = await install({ identity: tone, cache: true });
		const resolve = await resolver({ allowProductCache: true });
		expect(
			(
				await resolve({
					selection: select({
						values: { face_adjust_skin_Intensity: 60 },
						patch: { skinToneResourceId: tone.resourceId },
					}),
				})
			).packagePath
		).toBe(expected);
	});
	it("preserves the legacy catalog identity for the matching pink skin tone", async () => {
		const identity = JIANYING_PORTRAIT_PACKAGE_IDENTITIES["skin-tone"];
		const expected = await install({ identity });
		const resolve = await resolver();
		expect(
			(
				await resolve({
					selection: select({
						values: { face_adjust_skin_Intensity: 60 },
						patch: { skinToneResourceId: identity.resourceId },
					}),
				})
			).packagePath
		).toBe(expected);
	});
	it.each(
		JIANYING_PORTRAIT_MAKEUP_CARDS
	)("builds the actual $kind makeup parameters for $id", async (card) => {
		const cardPath = await install({ identity: card });
		const basePath = await install({
			identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.makeup,
		});
		const resolve = await resolver();
		const result = await resolve({
			selection: select({
				values: {},
				patch: {
					makeup: { [card.category]: { cardId: card.id, intensity: 60 } },
				},
			}),
		});
		if (card.kind === "standalone") {
			expect(result).toEqual({
				packagePath: cardPath,
				parameters: JSON.parse(
					buildJianyingStandaloneMakeupParameters({
						card,
						intensity: 60,
						targetFaceId: -1,
					})
				),
			});
			return;
		}
		expect(result).toEqual({
			packagePath: basePath,
			additionalPackagePath: cardPath,
			parameters: JSON.parse(
				buildJianyingDynamicMakeupParameters({
					selections: [{ card, intensity: 60, packagePath: cardPath }],
					targetFaceId: -1,
				})
			),
		});
	});
	it.each([
		"wrong-version",
		"other-package",
		"sibling-prefix",
		"alias",
		"traversal",
		"backslash-traversal",
		"drive-absolute",
		"unc-absolute",
		"file",
		"wrong-group",
		"wrong-runtime",
		"wrong-source",
		"symlink",
		"parent-symlink",
		"missing",
	])("rejects forged numeric package: %s", async (kind) => {
		const packagePath = await install({
			identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.features,
		});
		const resolve = await resolver({ allowProductCache: true });
		const resolution = await resolveJianyingPortraitPackage({
			runtimePackage: "features",
		});
		if (kind === "wrong-version")
			resolution.packagePath = path.join(
				path.dirname(packagePath),
				"forged-version"
			);
		if (kind === "other-package")
			resolution.packagePath = await install({
				identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.face,
			});
		if (kind === "sibling-prefix")
			resolution.packagePath = `${runtime}-outside/package`;
		if (kind === "traversal")
			resolution.packagePath = `${packagePath}/../${path.basename(packagePath)}`;
		if (kind === "backslash-traversal")
			resolution.packagePath = `${packagePath}\\..\\${path.basename(packagePath)}`;
		if (kind === "drive-absolute")
			resolution.packagePath = path.win32.join("Z:\\outside", "package");
		if (kind === "unc-absolute")
			resolution.packagePath = path.win32.join("\\\\server\\share", "package");
		if (kind === "alias") {
			resolution.packagePath = path.join(root, "alias");
			await symlink(packagePath, resolution.packagePath);
		}
		if (kind === "symlink" || kind === "file") {
			await rm(packagePath, { recursive: true });
			if (kind === "file") await writeFile(packagePath, "not a directory");
			if (kind === "symlink") await symlink(root, packagePath);
		}
		if (kind === "parent-symlink") {
			const parent = path.dirname(packagePath);
			await rename(parent, `${parent}-moved`);
			await symlink(`${parent}-moved`, parent);
		}
		if (kind === "wrong-group") resolution.group = "body";
		if (kind === "wrong-runtime") resolution.runtimePackage = "face";
		if (kind === "wrong-source") resolution.source = "jianying-installation";
		if (kind === "missing") resolution.packagePath = null;
		mocks.resolve.mockResolvedValue(resolution);
		await expect(resolve({ selection: select() })).rejects.toThrow();
	});
	it.each([
		"package",
		"effect-root",
		"replace-root",
		"wrong-version",
		"outside",
	])("rejects product cache %s changes", async (kind) => {
		const packagePath = await install({
			identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.features,
			cache: true,
		});
		const resolve = await resolver({ allowProductCache: true });
		const resolution = await resolveJianyingPortraitPackage({
			runtimePackage: "features",
		});
		if (kind === "replace-root") {
			await resolve({ selection: select() });
			await rename(effectRoot, `${effectRoot}-moved`);
			await install({
				identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.features,
				cache: true,
			});
		}
		if (kind === "package" || kind === "effect-root") {
			const target = kind === "package" ? packagePath : effectRoot;
			await rename(target, `${target}-moved`);
			await symlink(`${target}-moved`, target);
		}
		if (kind === "wrong-version")
			resolution.packagePath = path.join(path.dirname(packagePath), "forged");
		if (kind === "outside") resolution.packagePath = root;
		mocks.resolve.mockResolvedValue(resolution);
		await expect(resolve({ selection: select() })).rejects.toThrow();
	});
	it.each([
		"card-identity",
		"path",
		"symlink",
		"missing-card",
		"missing-base",
	])("rejects dynamic makeup %s", async (kind) => {
		const card = JIANYING_PORTRAIT_MAKEUP_CARDS.find(
			({ id }) => id === "lip-soft-pink"
		);
		if (!card) throw new Error("Missing catalog fixture");
		const cardPath = await install({ identity: card });
		if (kind !== "missing-base")
			await install({ identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.makeup });
		const resolution = await resolveJianyingPortraitMakeupCard({ card });
		if (kind === "card-identity")
			resolution.card = { ...card, version: "forged" };
		if (kind === "path") resolution.packagePath = root;
		if (kind === "missing-card") resolution.packagePath = null;
		if (kind === "symlink") {
			await rename(cardPath, `${cardPath}-moved`);
			await symlink(`${cardPath}-moved`, cardPath);
		}
		mocks.makeup.mockResolvedValue(resolution);
		const resolve = await resolver();
		await expect(
			resolve({
				selection: select({
					values: {},
					patch: { makeup: { lip: { cardId: card.id, intensity: 60 } } },
				}),
			})
		).rejects.toThrow();
	});
	it("pins the private runtime even if its current alias changes", async () => {
		const realRuntime = runtime;
		const alias = path.join(root, "current");
		await install({ identity: JIANYING_PORTRAIT_PACKAGE_IDENTITIES.features });
		await symlink(realRuntime, alias);
		mocks.current.mockReturnValue(alias);
		const resolve = createBeautyLabLiveSelectionResolver({
			runtimeRoot: await pinRoot({ root: alias }),
		});
		await resolve({ selection: select() });
		await rm(alias);
		await symlink(root, alias);
		await expect(resolve({ selection: select() })).rejects.toThrow();
	});
});
