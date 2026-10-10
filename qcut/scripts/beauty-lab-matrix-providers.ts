import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { createBeautyLabIndependentProvider } from "../electron/beauty-lab/beauty-lab-independent";
import { createJianyingPortraitAdjustmentProvider } from "../electron/jianying-portrait-adjustment-runtime/provider";

export function beautyMatrixOptions({ argv }: { argv: string[] }) {
	const [configurationPath, outputPath, ...flags] = argv;
	if (
		!configurationPath ||
		!outputPath ||
		configurationPath.startsWith("--") ||
		outputPath.startsWith("--")
	)
		throw new Error(
			"Usage: <matrix> <configuration.json> <output-directory> [--resume] [--packaged-app <app>]"
		);
	let resume = false;
	let packagedApp: string | undefined;
	for (let index = 0; index < flags.length; index++) {
		const flag = flags[index];
		if (flag === "--resume" && !resume) {
			resume = true;
			continue;
		}
		if (flag === "--packaged-app" && !packagedApp) {
			const value = flags[++index];
			if (!value || value.startsWith("--"))
				throw new Error("Missing packaged app path");
			packagedApp = path.resolve(value);
			continue;
		}
		throw new Error(`Unknown or duplicate matrix option: ${flag}`);
	}
	return { configurationPath, outputPath, resume, packagedApp };
}

export function validatePackagedMatrixEnvironment({
	environment,
}: {
	environment: NodeJS.ProcessEnv;
}) {
	if (environment.ELECTRON_RUN_AS_NODE !== "1")
		throw new Error("Packaged audit requires Electron Node mode");
	if (environment.QCUT_JIANYING_PORTRAIT_ADJUSTMENT_HOST)
		throw new Error("Packaged audit forbids a native host override");
	const runtimeRoot = environment.QCUT_INDEPENDENT_BEAUTY_RUNTIME;
	const python = environment.QCUT_INDEPENDENT_BEAUTY_PYTHON;
	if (
		!runtimeRoot ||
		!python ||
		!path.isAbsolute(runtimeRoot) ||
		!path.isAbsolute(python)
	)
		throw new Error(
			"Packaged audit requires explicit absolute external runtime and Python paths"
		);
	return { runtimeRoot, python };
}

export async function beautyMatrixProviders({
	packagedApp,
}: {
	packagedApp?: string;
}) {
	if (!packagedApp) {
		const engineRoot = path.resolve("research/independent-beauty");
		return {
			engineRoot,
			executionIdentity: { mode: "development" },
			owned: createBeautyLabIndependentProvider({ engineRoot }),
			native: createJianyingPortraitAdjustmentProvider(),
		};
	}
	const external = validatePackagedMatrixEnvironment({
		environment: process.env,
	});
	const app = await realpath(packagedApp);
	const executable = path.join(app, "Contents/MacOS/QCut AI Video Editor");
	if ((await realpath(process.execPath)) !== (await realpath(executable)))
		throw new Error(
			"Audit must run inside the selected packaged Electron executable"
		);
	const resources = path.join(app, "Contents/Resources");
	const asar = path.join(resources, "app.asar");
	const independentModule = path.join(
		asar,
		"electron/beauty-lab/beauty-lab-independent.js"
	);
	const nativeModule = path.join(
		asar,
		"electron/jianying-portrait-adjustment-runtime/provider.js"
	);
	const host = path.join(resources, "bin/jianying-portrait-adjustment-host");
	const load = createRequire(path.resolve("package.json"));
	// Electron's patched fs treats the archive itself as a directory.
	const archiveFs = load("original-fs") as typeof import("node:fs");
	const identities = await Promise.all(
		[asar, executable, host].map(async (file) => ({
			file,
			sha256: createHash("sha256")
				.update(
					await (file === asar
						? archiveFs.promises.readFile(file)
						: readFile(file))
				)
				.digest("hex"),
		}))
	);
	const independent = load(
		independentModule
	) as typeof import("../electron/beauty-lab/beauty-lab-independent");
	const native = load(
		nativeModule
	) as typeof import("../electron/jianying-portrait-adjustment-runtime/provider");
	const engineRoot = path.join(resources, "independent-beauty");
	return {
		engineRoot,
		executionIdentity: {
			mode: "packaged",
			app,
			executable,
			identities,
			external,
			packagedUIVerified: false,
		},
		owned: independent.createBeautyLabIndependentProvider({
			engineRoot,
			...external,
		}),
		native: native.createJianyingPortraitAdjustmentProvider(),
	};
}
