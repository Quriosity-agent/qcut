import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	copyFile,
	mkdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { runIndependentBeautyJob } from "./beauty-lab-independent-process.js";
import {
	independentBeautyEnvironment,
	independentBeautyPythonPackages,
	verifyIndependentBeautyEnvironment,
} from "./beauty-lab-runtime-environment.js";
import {
	independentBeautyRuntimeProfile,
	verifyIndependentBeautyRuntime,
} from "../beauty-lab-runtime-payload.js";

export async function installIndependentBeautyRuntime({
	sourceRoot,
	engineRoot,
	destination,
	basePython,
	uv,
	bun,
	environment = process.env,
	signal = new AbortController().signal,
	requirements,
	runJob = runIndependentBeautyJob,
	verifyEnvironment = verifyIndependentBeautyEnvironment,
}: {
	sourceRoot: string;
	engineRoot: string;
	destination: string;
	basePython: string;
	uv: string;
	bun: string;
	environment?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	requirements?: unknown;
	runJob?: typeof runIndependentBeautyJob;
	verifyEnvironment?: typeof verifyIndependentBeautyEnvironment;
}) {
	signal.throwIfAborted();
	const sourceManifestSha256 = createHash("sha256")
		.update(await readFile(path.join(engineRoot, "source-manifest.json")))
		.digest("hex");
	const profile = independentBeautyRuntimeProfile({
		sourceManifestSha256,
		requirements,
	});
	const source = await realpath(sourceRoot);
	await verifyIndependentBeautyRuntime({
		runtimeRoot: source,
		sourceManifestSha256,
		requirements: profile,
	});
	await mkdir(path.dirname(path.resolve(destination)), { recursive: true });
	const target = path.join(
		await realpath(path.dirname(path.resolve(destination))),
		path.basename(destination)
	);
	const relative = path.relative(source, target);
	if (
		!relative ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative))
	)
		throw new Error("Installation must be outside the source payload");
	// The final venv path is fixed before creation; moving it breaks script shebangs.
	await mkdir(target);
	try {
		let next = 0;
		async function copyNext(): Promise<void> {
			signal.throwIfAborted();
			const file = profile.files[next++];
			if (!file) return;
			const output = path.join(target, file.path);
			await mkdir(path.dirname(output), { recursive: true });
			await copyFile(
				path.join(source, file.path),
				output,
				constants.COPYFILE_EXCL
			);
			return copyNext();
		}
		// Wait for every worker to stop before rollback removes the owned directory.
		const copies = await Promise.allSettled(
			Array.from({ length: 4 }, () => copyNext())
		);
		const failure = copies.find((entry) => entry.status === "rejected");
		if (failure?.status === "rejected") throw failure.reason;
		const payload = await verifyIndependentBeautyRuntime({
			runtimeRoot: target,
			sourceManifestSha256,
			requirements: profile,
		});
		const cleanEnvironment = independentBeautyEnvironment({ environment });
		const python = path.join(target, ".venv/bin/python");
		const run = ({ args }: { args: string[] }) =>
			runJob({
				python: uv,
				args,
				cwd: target,
				environment: cleanEnvironment,
				signal,
				timeoutMs: 300_000,
			});
		await run({
			args: [
				"venv",
				"--python",
				basePython,
				"--no-managed-python",
				path.join(target, ".venv"),
			],
		});
		await run({
			args: [
				"pip",
				"install",
				"--python",
				python,
				...Object.entries(independentBeautyPythonPackages)
					.filter(([name]) => name !== "opencv-python-headless")
					.map(([name, version]) => `${name}==${version}`),
			],
		});
		await run({
			args: [
				"pip",
				"install",
				"--python",
				python,
				"--no-deps",
				`opencv-python-headless==${independentBeautyPythonPackages["opencv-python-headless"]}`,
			],
		});
		const capabilities = await verifyEnvironment({
			python,
			bun,
			cwd: target,
			environment: cleanEnvironment,
			signal,
		});
		signal.throwIfAborted();
		await verifyIndependentBeautyRuntime({
			runtimeRoot: target,
			sourceManifestSha256,
			requirements: profile,
		});
		const receipt = {
			schemaVersion: 1,
			sourceManifestSha256,
			...payload,
			...capabilities,
			installedAt: new Date().toISOString(),
			runtimeRoot: target,
			python,
			pixelsRendered: false,
		};
		await writeFile(
			path.join(target, "installation-receipt.json"),
			`${JSON.stringify(receipt, null, 2)}\n`,
			{ flag: "wx" }
		);
		return receipt;
	} catch (error) {
		await rm(target, { recursive: true, force: true });
		throw error;
	}
}
