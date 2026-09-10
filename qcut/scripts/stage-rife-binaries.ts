/**
 * Stages the pinned rife-ncnn-vulkan executable and the single RIFE model QCut
 * ships, mirroring scripts/stage-ffmpeg-binaries.ts.
 *
 *   bun scripts/stage-rife-binaries.ts                 # current platform
 *   bun scripts/stage-rife-binaries.ts --target win32  # one foreign target
 *   bun scripts/stage-rife-binaries.ts --all
 *
 * Every archive and every extracted file is checked against the SHA-256 in
 * electron/rife/rife-binaries.json before it lands under
 * electron/resources/rife/<platform>/. Foreign targets can only be verified
 * by hash here; they are never executed on this machine.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import extractZip from "extract-zip";
import manifest from "../electron/rife/rife-binaries.json";

type RifePlatform = keyof typeof manifest.targets;

const ROOT = resolve(import.meta.dir, "..");
const CACHE_ROOT = join(ROOT, "node_modules", ".cache", "qcut-rife");
const DOWNLOAD_MAX_RETRIES = 3;
/** Generous for the 436 MB macOS archive, small enough that a stall fails the job. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const RESOURCES_ROOT = join(ROOT, "electron", "resources", "rife");
const PLATFORMS = Object.keys(manifest.targets) as RifePlatform[];

function parseTargets(): RifePlatform[] {
	const args = process.argv.slice(2);
	if (args.includes("--all")) return PLATFORMS;
	const requested: RifePlatform[] = [];
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] !== "--target") continue;
		const value = args[index + 1];
		if (!PLATFORMS.includes(value as RifePlatform)) {
			throw new Error(
				`Unknown RIFE target "${value}"; expected one of ${PLATFORMS.join(", ")}`
			);
		}
		requested.push(value as RifePlatform);
	}
	if (requested.length > 0) return requested;
	if (!PLATFORMS.includes(process.platform as RifePlatform)) {
		throw new Error(`No RIFE binaries are pinned for ${process.platform}`);
	}
	return [process.platform as RifePlatform];
}

function sha256File({ filePath }: { filePath: string }): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const hash = createHash("sha256");
		createReadStream(filePath)
			.on("data", (chunk) => hash.update(chunk))
			.on("error", reject)
			.on("end", () => resolvePromise(hash.digest("hex")));
	});
}

async function expectHash({
	filePath,
	expected,
	label,
}: {
	filePath: string;
	expected: string;
	label: string;
}): Promise<void> {
	const actual = await sha256File({ filePath });
	if (actual !== expected) {
		throw new Error(
			`${label}: SHA256 mismatch — expected ${expected}, received ${actual}`
		);
	}
}

async function downloadArchive({
	platform,
}: {
	platform: RifePlatform;
}): Promise<string> {
	const target = manifest.targets[platform];
	await mkdir(CACHE_ROOT, { recursive: true });
	const archivePath = join(
		CACHE_ROOT,
		`${target.sha256}-${basename(new URL(target.url).pathname)}`
	);
	const cached = await sha256File({ filePath: archivePath }).catch(() => null);
	if (cached === target.sha256) return archivePath;
	const tempPath = `${archivePath}.download`;
	// A hung release-asset download stalled three release jobs for hours:
	// bound every attempt and retry, like scripts/stage-ffmpeg-binaries.ts.
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= DOWNLOAD_MAX_RETRIES; attempt += 1) {
		await rm(tempPath, { force: true });
		try {
			process.stdout.write(
				`[stage-rife] ${platform}: downloading ${basename(archivePath)} (attempt ${attempt}/${DOWNLOAD_MAX_RETRIES})\n`
			);
			const response = await fetch(target.url, {
				redirect: "follow",
				signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
			});
			if (!response.ok) {
				throw new Error(`Download failed (${response.status}): ${target.url}`);
			}
			await writeFile(tempPath, Buffer.from(await response.arrayBuffer()));
			await expectHash({
				filePath: tempPath,
				expected: target.sha256,
				label: `${platform} archive`,
			});
			await rename(tempPath, archivePath);
			return archivePath;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			await rm(tempPath, { force: true });
			if (attempt < DOWNLOAD_MAX_RETRIES) {
				process.stderr.write(
					`[stage-rife] ${platform}: attempt ${attempt}/${DOWNLOAD_MAX_RETRIES} failed: ${lastError.message}; retrying\n`
				);
			}
		}
	}
	throw new Error(
		`Could not download the RIFE archive for ${platform} after ${DOWNLOAD_MAX_RETRIES} attempts: ${lastError?.message ?? "unknown error"}`
	);
}

async function stage({ platform }: { platform: RifePlatform }): Promise<void> {
	const target = manifest.targets[platform];
	const archivePath = await downloadArchive({ platform });
	const extractRoot = await mkdtemp(join(CACHE_ROOT, "extract-"));
	try {
		await extractZip(archivePath, { dir: extractRoot });
		const destination = join(RESOURCES_ROOT, platform);
		await rm(destination, { recursive: true, force: true });
		await mkdir(join(destination, manifest.model), { recursive: true });

		const executableName = `${manifest.executableName}${platform === "win32" ? ".exe" : ""}`;
		const executablePath = join(destination, executableName);
		await copyFile(join(extractRoot, target.executable), executablePath);
		await expectHash({
			filePath: executablePath,
			expected: target.executableSha256,
			label: `${platform} ${executableName}`,
		});
		if (platform !== "win32") await chmod(executablePath, 0o755);

		for (const [file, expected] of Object.entries(target.modelFiles)) {
			const modelPath = join(destination, manifest.model, file);
			await copyFile(join(extractRoot, target.modelDir, file), modelPath);
			await expectHash({
				filePath: modelPath,
				expected,
				label: `${platform} ${manifest.model}/${file}`,
			});
		}
		const size = (await stat(executablePath)).size;
		console.log(
			`[stage-rife] ${platform}: ${executableName} (${(size / 1048576).toFixed(1)} MB) + ${manifest.model} staged under ${destination}`
		);
	} finally {
		await rm(extractRoot, { recursive: true, force: true });
	}
}

for (const platform of parseTargets()) {
	await stage({ platform });
}
console.log(
	`[stage-rife] rife-ncnn-vulkan ${manifest.release} (${manifest.license}), model ${manifest.model}`
);
