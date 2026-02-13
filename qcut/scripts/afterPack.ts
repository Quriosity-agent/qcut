import path from "node:path";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
// biome-ignore lint/style/noExportedImports: This is not being re-exported, just used for type annotation
import { AfterPackContext } from "electron-builder";

async function afterPack(context: AfterPackContext): Promise<void> {
  process.stdout.write("Running afterPack hook to fix icon...\n");

  // Skip icon fixing when cross-compiling (e.g., building Windows on macOS)
  if (process.platform !== "win32" && context.electronPlatformName === "win32") {
    process.stdout.write(
      "Skipping icon fix: cross-compiling from non-Windows platform\n"
    );
    return;
  }

  const appOutDir: string = context.appOutDir;
  const exePath: string = path.join(appOutDir, "QCut AI Video Editor.exe");
  const icoPath: string = path.join(
    context.packager.projectDir,
    "build",
    "icon.ico"
  );

  process.stdout.write(`Executable path: ${exePath}\n`);
  process.stdout.write(`Icon path: ${icoPath}\n`);

  if (!fs.existsSync(exePath)) {
    process.stderr.write(`Executable not found: ${exePath}\n`);
    return;
  }

  if (!fs.existsSync(icoPath)) {
    process.stderr.write(`Icon not found: ${icoPath}\n`);
    return;
  }

  // Try to use our downloaded rcedit
  let rceditPath: string = path.join(
    context.packager.projectDir,
    "scripts",
    "rcedit.exe"
  );

  // Fallback to electron-builder's cache
  if (!fs.existsSync(rceditPath)) {
    rceditPath = path.join(
      os.homedir(),
      "AppData/Local/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe"
    );
  }

  if (fs.existsSync(rceditPath)) {
    process.stdout.write(`Using rcedit from: ${rceditPath}\n`);

    return new Promise<void>((resolve, reject) => {
      execFile(
        rceditPath,
        [exePath, "--set-icon", icoPath],
        { windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            process.stderr.write(
              `Error setting icon: ${error?.stack || error}\n`
            );
            reject(error);
            return;
          }
          process.stdout.write("Icon successfully embedded into executable!\n");
          if (stdout) process.stdout.write(`Output: ${stdout}\n`);
          if (stderr) process.stderr.write(`Stderr: ${stderr}\n`);
          resolve();
        }
      );
    });
  }
  process.stdout.write(
    "rcedit not found in electron-builder cache, icon should be set by electron-builder\n"
  );
}

// CommonJS export for electron-builder
export = afterPack;
