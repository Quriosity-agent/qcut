const path = require("path");
const { execFile } = require("node:child_process");
const fs = require("fs");

exports.default = async (context) => {
  process.stdout.write("Running afterPack hook to fix icon...\n");

  const appOutDir = context.appOutDir;
  const exePath = path.join(appOutDir, "QCut Video Editor.exe");
  const icoPath = path.join(context.packager.projectDir, "build", "icon.ico");

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
  let rceditPath = path.join(
    context.packager.projectDir,
    "scripts",
    "rcedit.exe"
  );

  // Fallback to electron-builder's cache
  if (!fs.existsSync(rceditPath)) {
    rceditPath = path.join(
      require("os").homedir(),
      "AppData/Local/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe"
    );
  }

  if (fs.existsSync(rceditPath)) {
    process.stdout.write(`Using rcedit from: ${rceditPath}\n`);

    return new Promise((resolve, reject) => {
      execFile(
        rceditPath,
        [exePath, "--set-icon", icoPath],
        { windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            process.stderr.write(`Error setting icon: ${error?.stack || error}\n`);
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
};
