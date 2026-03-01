/**
 * Cross-platform virtual display launcher for E2E tests.
 *
 * Runs Playwright Electron tests without stealing mouse/keyboard focus by
 * routing the Electron window to a virtual display or offscreen position.
 *
 * Platform strategies:
 *   Windows — Virtual Desktop via PowerShell COM, fallback to offscreen (-2000,-2000)
 *   macOS   — Offscreen window positioning (-2000,-2000)
 *   Linux   — xvfb-run wrapper, fallback to existing $DISPLAY
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

interface VirtualDisplayStrategy {
	setup(): Promise<Record<string, string>>;
	teardown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
	process.stderr.write(`[e2e-vdisplay] ${msg}\n`);
}

function execPromise(
	cmd: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { timeout: 30_000 }, (err, stdout, stderr) => {
			if (err) {
				reject(
					new Error(
						`${cmd} failed: ${err.message}\nstderr: ${stderr}`,
					),
				);
				return;
			}
			resolve({ stdout: String(stdout), stderr: String(stderr) });
		});
	});
}

function commandExists(name: string): Promise<boolean> {
	const checkCmd = platform() === "win32" ? "where" : "which";
	return new Promise((resolve) => {
		execFile(checkCmd, [name], (err) => resolve(!err));
	});
}

function spawnAndWait(
	command: string,
	args: string[],
	env: Record<string, string | undefined>,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			env,
			shell: platform() === "win32",
		});

		child.on("error", (err) => reject(err));
		child.on("exit", (code, signal) => {
			if (signal) {
				log(`Playwright terminated by signal ${signal}`);
				resolve(1);
				return;
			}
			resolve(code ?? 1);
		});
	});
}

// ---------------------------------------------------------------------------
// Windows — Virtual Desktop via PowerShell COM
// ---------------------------------------------------------------------------

class WindowsVirtualDesktop implements VirtualDisplayStrategy {
	private desktopId: string | null = null;
	private psScript: string;

	constructor() {
		this.psScript = resolve(
			import.meta.dirname,
			"e2e-virtual-display-win.ps1",
		);
	}

	async setup(): Promise<Record<string, string>> {
		if (!existsSync(this.psScript)) {
			throw new Error(`PowerShell helper not found: ${this.psScript}`);
		}

		try {
			const result = await execPromise("powershell", [
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				this.psScript,
				"-Action",
				"create",
			]);

			const guid = result.stdout.trim();
			if (!guid || guid === "FALLBACK") {
				throw new Error("Virtual Desktop creation returned FALLBACK");
			}

			this.desktopId = guid;
			log(`Created virtual desktop: ${guid}`);

			return {
				QCUT_E2E_VIRTUAL_DESKTOP: guid,
				QCUT_E2E_MOVE_WINDOW: "1",
			};
		} catch (err) {
			log(
				`Virtual Desktop API failed, falling back to offscreen: ${err instanceof Error ? err.message : String(err)}`,
			);
			return { QCUT_E2E_OFFSCREEN: "1" };
		}
	}

	async teardown(): Promise<void> {
		if (!this.desktopId) return;

		try {
			await execPromise("powershell", [
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				this.psScript,
				"-Action",
				"cleanup",
				"-DesktopId",
				this.desktopId,
			]);
			log(`Removed virtual desktop: ${this.desktopId}`);
		} catch (err) {
			log(
				`Virtual desktop cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		this.desktopId = null;
	}
}

// ---------------------------------------------------------------------------
// macOS — CGVirtualDisplay via Swift helper
// ---------------------------------------------------------------------------

/**
 * macOS — Offscreen window positioning.
 *
 * CGVirtualDisplay is process-local on macOS: the virtual display is only
 * visible within the creator process, not to other processes like Electron.
 * Therefore we use offscreen positioning (-2000, -2000) which fully renders
 * the window without stealing the user's mouse/keyboard focus.
 */
class MacOSOffscreen implements VirtualDisplayStrategy {
	async setup(): Promise<Record<string, string>> {
		log("macOS: using offscreen window positioning");
		return { QCUT_E2E_OFFSCREEN: "1" };
	}

	async teardown(): Promise<void> {
		// Nothing to clean up
	}
}

// ---------------------------------------------------------------------------
// Linux — Xvfb
// ---------------------------------------------------------------------------

class LinuxXvfb implements VirtualDisplayStrategy {
	private useXvfb = false;

	async setup(): Promise<Record<string, string>> {
		const hasXvfb = await commandExists("xvfb-run");

		if (hasXvfb) {
			log("xvfb-run found — will wrap Playwright in virtual framebuffer");
			this.useXvfb = true;
			return { QCUT_E2E_USE_XVFB: "1" };
		}

		// No xvfb-run — check for existing display
		if (process.env.DISPLAY) {
			log(
				`xvfb-run not found, using existing DISPLAY=${process.env.DISPLAY}`,
			);
			return {};
		}

		log(
			"WARNING: No display available and xvfb-run not found. Install xvfb: apt install xvfb",
		);
		log("Attempting direct launch — tests may fail without a display.");
		return {};
	}

	async teardown(): Promise<void> {
		// xvfb-run handles its own cleanup when the child exits
	}
}

// ---------------------------------------------------------------------------
// NoOp — unknown platforms
// ---------------------------------------------------------------------------

class NoOpStrategy implements VirtualDisplayStrategy {
	async setup(): Promise<Record<string, string>> {
		log("Unknown platform — launching Playwright directly");
		return {};
	}
	async teardown(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Strategy factory
// ---------------------------------------------------------------------------

function createStrategy(plat: NodeJS.Platform): VirtualDisplayStrategy {
	switch (plat) {
		case "win32":
			return new WindowsVirtualDesktop();
		case "darwin":
			return new MacOSOffscreen();
		case "linux":
			return new LinuxXvfb();
		default:
			return new NoOpStrategy();
	}
}

// ---------------------------------------------------------------------------
// Playwright launcher
// ---------------------------------------------------------------------------

async function runPlaywright(
	env: Record<string, string>,
	args: string[],
): Promise<number> {
	const useXvfb = env.QCUT_E2E_USE_XVFB === "1";

	const command = useXvfb ? "xvfb-run" : "bunx";
	const commandArgs = useXvfb
		? [
				"--auto-servernum",
				"--server-args=-screen 0 1920x1080x24 -ac",
				"bunx",
				"playwright",
				"test",
				...args,
			]
		: ["playwright", "test", ...args];

	log(`Running: ${command} ${commandArgs.join(" ")}`);

	const mergedEnv: Record<string, string | undefined> = {
		...process.env,
		...env,
	};

	return spawnAndWait(command, commandArgs, mergedEnv);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const plat = platform();
	log(`Platform: ${plat}`);

	const strategy = createStrategy(plat);
	let cleanedUp = false;

	const cleanup = async (): Promise<void> => {
		if (cleanedUp) return;
		cleanedUp = true;
		await strategy.teardown().catch((err) => {
			log(
				`Teardown error: ${err instanceof Error ? err.message : String(err)}`,
			);
		});
	};

	// Register cleanup handlers for all exit paths
	process.on("exit", () => {
		// Synchronous — can't await, but teardown should be called before exit
	});

	process.on("SIGINT", async () => {
		log("Received SIGINT — cleaning up...");
		await cleanup();
		process.exit(130);
	});

	process.on("SIGTERM", async () => {
		log("Received SIGTERM — cleaning up...");
		await cleanup();
		process.exit(143);
	});

	process.on("uncaughtException", async (err) => {
		log(`Uncaught exception: ${err.message}`);
		await cleanup();
		process.exit(1);
	});

	// Parse args: everything after "--" goes to Playwright
	const rawArgs = process.argv.slice(2);
	const dashDashIdx = rawArgs.indexOf("--");
	const playwrightArgs =
		dashDashIdx >= 0 ? rawArgs.slice(dashDashIdx + 1) : rawArgs;

	try {
		const env = await strategy.setup();
		const exitCode = await runPlaywright(env, playwrightArgs);
		await cleanup();
		process.exit(exitCode);
	} catch (err) {
		log(
			`Virtual display setup failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		log("Falling back to direct Playwright launch...");
		await cleanup();
		const exitCode = await runPlaywright({}, playwrightArgs);
		process.exit(exitCode);
	}
}

main();
