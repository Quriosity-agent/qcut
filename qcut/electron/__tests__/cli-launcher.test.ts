import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildCliLauncherScript,
	bundledCliScriptPath,
	CliLauncherError,
	cliLauncherPath,
	findQcutOnPath,
	installCliLauncher,
	parseCliLauncher,
	readCliLauncherState,
	refreshCliLauncher,
} from "../cli-launcher.js";

const target = {
	executablePath:
		"/Applications/QCut AI Video Editor.app/Contents/MacOS/QCut AI Video Editor",
	cliScriptPath:
		"/Applications/QCut AI Video Editor.app/Contents/Resources/app.asar/electron/native-pipeline/cli/cli.js",
};

const dirs: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "qcut-launcher-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe("qcut launcher", () => {
	it("lives in ~/.local/bin, or a QCut folder under LOCALAPPDATA on Windows", () => {
		expect(cliLauncherPath({ platform: "darwin", home: "/Users/me" })).toBe(
			"/Users/me/.local/bin/qcut"
		);
		expect(
			cliLauncherPath({
				platform: "win32",
				home: "C:\\Users\\me",
				env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
			})
		).toBe("C:\\Users\\me\\AppData\\Local\\QCut\\bin\\qcut.cmd");
	});

	it("knows where each install layout keeps the bundled command", () => {
		expect(
			bundledCliScriptPath({
				appPath: "/Applications/QCut.app",
				kind: "mac-zip",
			})
		).toBe(
			"/Applications/QCut.app/Contents/Resources/app.asar/electron/native-pipeline/cli/cli.js"
		);
		expect(
			bundledCliScriptPath({
				appPath: "C:\\Programs\\QCut",
				kind: "windows-nsis",
			})
		).toBe(
			"C:\\Programs\\QCut\\resources\\app.asar\\electron\\native-pipeline\\cli\\cli.js"
		);
		expect(
			bundledCliScriptPath({
				appPath: "/tmp/x.AppImage",
				kind: "linux-appimage",
			})
		).toBeUndefined();
	});

	it("runs the app as Node with the bundled script and survives quotes in paths", () => {
		const quoted = {
			executablePath: "/Volumes/Pete's Disk/QCut.app/Contents/MacOS/QCut",
			cliScriptPath:
				"/Volumes/Pete's Disk/QCut.app/Contents/Resources/app.asar/cli.js",
		};
		const script = buildCliLauncherScript({
			target: quoted,
			platform: "darwin",
		});
		expect(script.startsWith("#!/bin/sh\n")).toBe(true);
		expect(script).toContain("export ELECTRON_RUN_AS_NODE=1");
		expect(script).toContain(
			'exec "$QCUT_APP_EXECUTABLE" "$QCUT_CLI_SCRIPT" "$@"'
		);
		expect(parseCliLauncher({ content: script })).toEqual(quoted);

		const windows = buildCliLauncherScript({
			target: {
				executablePath: "C:\\Programs\\QCut\\QCut AI Video Editor.exe",
				cliScriptPath: "C:\\Programs\\QCut\\resources\\app.asar\\cli.js",
			},
			platform: "win32",
		});
		expect(windows).toContain("set ELECTRON_RUN_AS_NODE=1");
		expect(windows).toContain('"%QCUT_APP_EXECUTABLE%" "%QCUT_CLI_SCRIPT%" %*');
		expect(parseCliLauncher({ content: windows })).toEqual({
			executablePath: "C:\\Programs\\QCut\\QCut AI Video Editor.exe",
			cliScriptPath: "C:\\Programs\\QCut\\resources\\app.asar\\cli.js",
		});
		expect(
			parseCliLauncher({ content: '#!/bin/sh\nexec bun x qcut "$@"\n' })
		).toBeUndefined();
	});

	it("doubles percent signs in Windows paths and refuses double quotes", () => {
		// cmd.exe expands %name% as it reads a line, so a literal % is doubled
		// in the file and single again when read back.
		const percent = {
			executablePath: "C:\\Users\\100%\\QCut\\QCut AI Video Editor.exe",
			cliScriptPath: "C:\\Users\\100%\\QCut\\resources\\app.asar\\cli.js",
		};
		const script = buildCliLauncherScript({
			target: percent,
			platform: "win32",
		});
		expect(script).toContain(
			'set "QCUT_APP_EXECUTABLE=C:\\Users\\100%%\\QCut\\QCut AI Video Editor.exe"'
		);
		expect(parseCliLauncher({ content: script })).toEqual(percent);
		expect(() =>
			buildCliLauncherScript({
				target: { ...percent, executablePath: 'C:\\Odd"Name\\QCut.exe' },
				platform: "win32",
			})
		).toThrow(CliLauncherError);
	});

	it("lists qcut commands PATH resolves before the launcher", () => {
		const root = tempDir();
		const bunBin = join(root, "bun-bin");
		const localBin = join(root, "local-bin");
		const laterBin = join(root, "later-bin");
		for (const dir of [bunBin, localBin, laterBin]) mkdirSync(dir);
		writeFileSync(join(bunBin, "qcut"), "#!/bin/sh\n");
		writeFileSync(join(laterBin, "qcut"), "#!/bin/sh\n");
		const launcherPath = join(localBin, "qcut");

		expect(
			findQcotOnPathCompat({
				launcherPath,
				PATH: [bunBin, localBin, laterBin].join(":"),
			})
		).toEqual({ onPath: true, shadowedBy: [join(bunBin, "qcut")] });
		expect(
			findQcotOnPathCompat({ launcherPath, PATH: [bunBin, laterBin].join(":") })
		).toEqual({
			onPath: false,
			shadowedBy: [join(bunBin, "qcut"), join(laterBin, "qcut")],
		});
	});

	it("installs an executable launcher, refuses foreign files unless told, and refreshes a moved target", () => {
		const root = tempDir();
		const launcherPath = join(root, "bin", "qcut");
		const env = { PATH: join(root, "bin") };

		const installed = installCliLauncher({
			target,
			launcherPath,
			platform: "darwin",
			env,
		});
		expect(installed).toMatchObject({
			installed: true,
			managed: true,
			target,
			onPath: true,
			shadowedBy: [],
			previousTarget: undefined,
		});
		expect(statSync(launcherPath).mode & 0o111).toBe(0o111);

		const moved = {
			...target,
			executablePath: "/Users/me/Applications/QCut.app/Contents/MacOS/QCut",
		};
		const refreshed = refreshCliLauncher({
			target: moved,
			launcherPath,
			platform: "darwin",
			env,
		});
		expect(refreshed.refreshed).toBe(true);
		expect(
			readCliLauncherState({ launcherPath, platform: "darwin", env }).target
		).toEqual(moved);
		expect(
			refreshCliLauncher({
				target: moved,
				launcherPath,
				platform: "darwin",
				env,
			}).refreshed
		).toBe(false);

		writeFileSync(launcherPath, '#!/bin/sh\nexec bun x qcut "$@"\n');
		chmodSync(launcherPath, 0o755);
		expect(
			refreshCliLauncher({ target, launcherPath, platform: "darwin", env })
		).toMatchObject({ refreshed: false });
		expect(() =>
			installCliLauncher({ target, launcherPath, platform: "darwin", env })
		).toThrow(CliLauncherError);
		expect(readFileSync(launcherPath, "utf8")).toContain("bun x qcut");
		const replaced = installCliLauncher({
			target,
			launcherPath,
			platform: "darwin",
			env,
			replaceForeign: true,
		});
		expect(replaced.target).toEqual(target);
		expect(replaced.previousTarget).toBeUndefined();
	});
});

/** findQcutOnPath with an explicit PATH, in the shape the assertions read. */
function findQcotOnPathCompat({
	launcherPath,
	PATH,
}: {
	launcherPath: string;
	PATH: string;
}) {
	return findQcutOnPath({ launcherPath, platform: "darwin", env: { PATH } });
}
