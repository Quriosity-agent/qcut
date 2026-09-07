import { createHash } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createJianyingFilterLocalRenderSession } from "../../electron/jianying-filter-local-runtime/render.js";
import { inspectJianyingFilterLocalRuntime } from "../../electron/jianying-filter-local-runtime/runtime-discovery.js";

const identities = {
	creator: "0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9",
	agfx: "1b9493940eebda3b79d72b7308adf8abfbff56c9cfce9d7d73b31cd080453eee",
	package: "819180c07dfbf979de6ec584af19e99ae0829ce6e8d8b9a8c6e51e56db0e9822",
};

function hash({ bytes }: { bytes: Uint8Array }) {
	return createHash("sha256").update(bytes).digest("hex");
}

async function packageFiles({
	root,
	directory = root,
}: {
	root: string;
	directory?: string;
}): Promise<Array<{ path: string; bytes: Buffer }>> {
	const entries = await readdir(directory, { withFileTypes: true });
	const groups = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return packageFiles({ root, directory: path });
			if (!entry.isFile())
				throw new Error(
					"Package profile requires regular files and directories"
				);
			return [
				{
					path: relative(root, path).split(sep).join("/"),
					bytes: await readFile(path),
				},
			];
		})
	);
	return groups.flat();
}

async function packageHash({ root }: { root: string }) {
	const files = (await packageFiles({ root })).sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0
	);
	const digest = createHash("sha256");
	for (const file of files)
		digest.update(file.path).update("\0").update(file.bytes).update("\0");
	return digest.digest("hex");
}

function dimension({ value }: { value: string }) {
	if (!/^[1-9]\d*$/.test(value))
		throw new Error("Dimensions must be positive integers");
	const number = Number(value);
	if (number > 2048) throw new Error("Capture dimensions must be at most 2048");
	return number;
}

async function main() {
	if (process.argv.length !== 8)
		throw new Error(
			"Usage: bun capture-soft-glow-passes.ts input.rgba width height package-directory observer.dylib|off new-private-output-directory"
		);
	if (process.platform !== "darwin" || process.arch !== "arm64")
		throw new Error("This profile requires macOS arm64");
	const [
		inputPath,
		widthText,
		heightText,
		packageArgument,
		observerArgument,
		outputArgument,
	] = process.argv.slice(2);
	const width = dimension({ value: widthText });
	const height = dimension({ value: heightText });
	const directory = resolve(outputArgument);
	const repository = await realpath(resolve(import.meta.dir, "../../.."));
	const parent = await realpath(resolve(directory, ".."));
	const relation = relative(repository, parent);
	if (
		!relation ||
		(!relation.startsWith(`..${sep}`) &&
			relation !== ".." &&
			!isAbsolute(relation))
	) {
		throw new Error("Raw native evidence must be outside the repository");
	}
	if (
		process.env.DYLD_INSERT_LIBRARIES ||
		process.env.QCUT_CGL_CAPTURE_DIRECTORY ||
		process.env.QCUT_CGL_CAPTURE_GATE
	) {
		throw new Error(
			"Start a clean diagnostic process without preexisting capture variables"
		);
	}
	const packagePath = await realpath(resolve(packageArgument));
	const observer =
		observerArgument === "off"
			? null
			: await realpath(resolve(observerArgument));
	const input = await readFile(resolve(inputPath));
	if (input.length !== width * height * 4)
		throw new Error("Input RGBA byte count differs from dimensions");
	for (let index = 3; index < input.length; index += 4) {
		if (input[index] !== 255)
			throw new Error("This fixed profile requires an opaque input");
	}
	const runtime = await inspectJianyingFilterLocalRuntime();
	if (
		runtime.status.state !== "ready" ||
		!runtime.effectLibraryPath ||
		!runtime.frameworkDirectory ||
		!runtime.bridgePath
	) {
		throw new Error("Private runtime is not ready");
	}
	const [creator, agfx, resource, bridge, observerHash] = await Promise.all([
		readFile(runtime.effectLibraryPath).then((bytes) => hash({ bytes })),
		readFile(join(runtime.frameworkDirectory, "libAGFX.dylib")).then((bytes) =>
			hash({ bytes })
		),
		packageHash({ root: packagePath }),
		readFile(runtime.bridgePath).then((bytes) => hash({ bytes })),
		observer ? readFile(observer).then((bytes) => hash({ bytes })) : null,
	]);
	if (
		creator !== identities.creator ||
		agfx !== identities.agfx ||
		resource !== identities.package
	) {
		throw new Error(
			"Binary/resource identity differs from the D634 Soft Glow capture profile"
		);
	}
	await mkdir(directory);
	// These variables reach only the newly launched diagnostic child; warmup remains unrecorded.
	if (observer) {
		process.env.DYLD_INSERT_LIBRARIES = observer;
		process.env.QCUT_CGL_CAPTURE_DIRECTORY = directory;
		process.env.QCUT_CGL_CAPTURE_GATE = join(directory, "capture-enabled");
	}
	const session = await createJianyingFilterLocalRenderSession({
		resourceId: "7447126702137904420",
		packagePath,
		width,
		height,
		runtime,
		intensity: 100,
		bootstrapRgba: input,
		mode: "multi-pass",
	});
	const hashes: string[] = [];
	try {
		if (observer)
			await writeFile(join(directory, "capture-enabled"), "enabled", {
				flag: "wx",
			});
		async function renderFrame({ frame }: { frame: number }): Promise<void> {
			if (frame === 3) return;
			const result = await session.render({ rgba: input, timestampSeconds: 0 });
			if (result.rgba.length !== input.length)
				throw new Error("Unexpected native output byte count");
			await writeFile(join(directory, `output-${frame}.rgba`), result.rgba, {
				flag: "wx",
			});
			hashes.push(hash({ bytes: result.rgba }));
			return renderFrame({ frame: frame + 1 });
		}
		await renderFrame({ frame: 0 });
	} finally {
		await session.dispose();
	}
	if (new Set(hashes).size !== 1)
		throw new Error("Native output changed across repeated static frames");
	const report = {
		profile: "d634-soft-glow-cgl-rgba8-v1",
		width,
		height,
		inputPath: resolve(inputPath),
		inputSha256: hash({ bytes: input }),
		hashes,
		creator,
		agfx,
		resource,
		bridge,
		observerSha256: observerHash,
		observerEnabled: Boolean(observer),
		runtime,
	};
	await writeFile(
		join(directory, "capture.json"),
		`${JSON.stringify(report, null, 2)}\n`,
		{ flag: "wx" }
	);
	console.log(
		JSON.stringify({ directory, hashes, observerEnabled: Boolean(observer) })
	);
}

await main();
