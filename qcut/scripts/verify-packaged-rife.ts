/**
 * Verifies the packaged RIFE frame-interpolation host against
 * electron/rife/rife-binaries.json.
 *
 *   bun scripts/verify-packaged-rife.ts
 *
 * Finds the newest packaged resources directory under dist-electron (the same
 * rule scripts/verify-packaged-ffmpeg.ts uses), checks that the platform's
 * model files are present with the pinned SHA-256, that the executable is
 * present, executable and (on macOS) carries a valid code signature, and on
 * the host platform also runs the executable so a broken binary fails the
 * build rather than the first export.
 *
 * The executable itself is not hashed here: electron-builder re-signs every
 * Mach-O (hardened runtime + notarization) and may sign Windows binaries, so
 * its bytes legitimately differ from the download. Its pinned hash is checked
 * once, before signing, by scripts/stage-rife-binaries.ts.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { access, constants, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import manifest from "../electron/rife/rife-binaries.json";

const execFileAsync = promisify(execFile);
type RifePlatform = keyof typeof manifest.targets;

function sha256File({ filePath }: { filePath: string }): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const hash = createHash("sha256");
		createReadStream(filePath)
			.on("data", (chunk) => hash.update(chunk))
			.on("error", reject)
			.on("end", () => resolvePromise(hash.digest("hex")));
	});
}

async function resolveLatestResourcesDir(): Promise<string> {
	const distDir = join(process.cwd(), "dist-electron");
	if (!existsSync(distDir)) {
		throw new Error(`dist-electron not found: ${distDir}`);
	}
	const entries = await readdir(distDir, { withFileTypes: true });
	const groups = await Promise.all(
		entries.map(async (entry): Promise<string[]> => {
			if (!entry.isDirectory()) return [];
			const entryPath = join(distDir, entry.name);
			if (
				entry.name.endsWith("win-unpacked") ||
				entry.name.endsWith("linux-unpacked")
			) {
				return [join(entryPath, "resources")];
			}
			const bundles = await readdir(entryPath, { withFileTypes: true }).catch(
				() => []
			);
			return bundles
				.filter(
					(bundle) => bundle.isDirectory() && bundle.name.endsWith(".app")
				)
				.map((bundle) => join(entryPath, bundle.name, "Contents", "Resources"));
		})
	);
	const existing = groups.flat().filter((dirPath) => existsSync(dirPath));
	if (existing.length === 0) {
		throw new Error(`No packaged resources directory found in: ${distDir}`);
	}
	const dated = await Promise.all(
		existing.map(async (fullPath) => ({
			fullPath,
			mtimeMs: (await stat(fullPath)).mtimeMs,
		}))
	);
	return dated.sort((a, b) => b.mtimeMs - a.mtimeMs)[0].fullPath;
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
	if (!existsSync(filePath)) {
		throw new Error(`Packaged RIFE file missing: ${label} (${filePath})`);
	}
	const actual = await sha256File({ filePath });
	if (actual !== expected) {
		throw new Error(
			`Packaged RIFE file differs from the pinned build: ${label} — expected ${expected}, received ${actual}`
		);
	}
}

async function verifyPackagedRife(): Promise<void> {
	const platform = process.platform as RifePlatform;
	const target = manifest.targets[platform];
	if (!target) {
		throw new Error(`No RIFE binaries are pinned for ${process.platform}`);
	}
	const resourcesDir = await resolveLatestResourcesDir();
	const platformDir = join(resourcesDir, "rife", platform);
	const executableName = `${manifest.executableName}${platform === "win32" ? ".exe" : ""}`;
	const executablePath = join(platformDir, executableName);
	if (!existsSync(executablePath)) {
		throw new Error(`Packaged RIFE host missing: ${executablePath}`);
	}
	if (platform !== "win32") {
		await access(executablePath, constants.X_OK).catch(() => {
			throw new Error(
				`Packaged RIFE host is not executable: ${executablePath}`
			);
		});
	}
	if (platform === "darwin") {
		// Signing rewrote the binary; the signature must still verify.
		await execFileAsync("codesign", [
			"--verify",
			"--strict",
			executablePath,
		]).catch((error: { stderr?: string }) => {
			throw new Error(
				`Packaged RIFE host has an invalid code signature: ${executablePath}${error.stderr ? ` — ${String(error.stderr).trim()}` : ""}`
			);
		});
	}
	for (const [file, expected] of Object.entries(target.modelFiles)) {
		await expectHash({
			filePath: join(platformDir, manifest.model, file),
			expected,
			label: `${manifest.model}/${file}`,
		});
	}
	// The packaged host must at least start on the machine that built it.
	const { stdout, stderr } = await execFileAsync(executablePath, ["-h"], {
		windowsHide: true,
	}).catch((error: { stdout?: string; stderr?: string }) => ({
		stdout: error.stdout ?? "",
		stderr: error.stderr ?? "",
	}));
	if (!`${stdout}\n${stderr}`.includes("Usage: rife-ncnn-vulkan")) {
		throw new Error(
			`Packaged RIFE host did not print its usage: ${executablePath}`
		);
	}
	console.log(
		`[verify-rife] ${platform}: ${executableName} + ${manifest.model} verified under ${platformDir}`
	);
}

await verifyPackagedRife();
