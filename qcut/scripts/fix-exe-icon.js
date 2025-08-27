const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Official SHA256 hash for rcedit v2.0.0 x64
// You should verify this from the official release page
const RCEDIT_SHA256 =
  "02e8e40ad74aa2a837053a2be23313fb27cfdb2b6e52bb0e53bc25593c8762e2";
const RCEDIT_URL =
  "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe";

async function verifyFileHash(filePath, expectedHash) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => {
      const fileHash = hash.digest("hex");
      resolve(fileHash.toLowerCase() === expectedHash.toLowerCase());
    });
    stream.on("error", reject);
  });
}

async function fixExeIcon() {
  // Check platform - this script is Windows-only
  if (process.platform !== "win32") {
    process.stderr.write("This script is intended for Windows only.\n");
    process.exitCode = 1;
    return;
  }

  const getArg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : undefined;
  };
  const getArg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : undefined;
  };
  const exePath =
    getArg("--exe") ||
    path.resolve(
      process.cwd(),
      "dist",
      "win-unpacked",
      "QCut Video Editor.exe"
    );
  const icoPath =
    getArg("--ico") || path.resolve(process.cwd(), "build", "icon.ico");

  // Check if files exist
  if (!fs.existsSync(exePath)) {
    process.stderr.write(`Executable not found at: ${exePath}\n`);
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(icoPath)) {
    process.stderr.write(`Icon not found at: ${icoPath}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Fixing executable icon...\nExe path: ${exePath}\nIcon path: ${icoPath}\n`
  );

  // Download rcedit if not available or verify existing one
  const rceditPath = path.join(__dirname, "rcedit.exe");

  let needsDownload = false;

  if (fs.existsSync(rceditPath)) {
    // Verify existing rcedit integrity
    process.stdout.write("Verifying existing rcedit integrity...\n");
    const isValid = await verifyFileHash(rceditPath, RCEDIT_SHA256);
    if (isValid) {
      process.stdout.write("Existing rcedit.exe passed integrity check.\n");
    } else {
      process.stderr.write(
        "Existing rcedit.exe failed integrity check. Re-downloading...\n"
      );
      fs.unlinkSync(rceditPath);
      needsDownload = true;
    }
  } else {
    needsDownload = true;
  }

  if (needsDownload) {
    process.stdout.write("Downloading rcedit...\n");
    const https = require("https");
    const file = fs.createWriteStream(rceditPath);

    await new Promise((resolve, reject) => {
      const maxRedirects = 5;
      
      const doGet = (url, redirects = 0) => {
        const req = https.get(url, (res) => {
          const { statusCode, headers } = res;
          
          // Handle redirects
          if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
            if (redirects >= maxRedirects) {
              res.resume();
              file.destroy();
              reject(new Error("Too many redirects when downloading rcedit."));
              return;
            }
            res.resume();
            doGet(headers.location, redirects + 1);
            return;
          }
          
          // Check for success
          if (statusCode !== 200) {
            res.resume();
            file.destroy();
            reject(new Error(`Failed to download: HTTP ${statusCode}`));
            return;
          }
          
          // Pipe response to file
          res.pipe(file);
          
          file.on("finish", () => {
            file.close(() => {
              process.stdout.write("rcedit downloaded successfully\n");
              resolve();
            });
          });
          
          file.on("error", (err) => {
            file.destroy();
            fs.unlink(rceditPath, () => {}); // Clean up partial file
            reject(err);
          });
        });
        
        req.on("error", (err) => {
          file.destroy();
          fs.unlink(rceditPath, () => {}); // Clean up partial file
          reject(err);
        });
      };
      
      doGet(RCEDIT_URL);
    });

    // Verify downloaded file integrity
    process.stdout.write("Verifying downloaded rcedit integrity...\n");
    const isValid = await verifyFileHash(rceditPath, RCEDIT_SHA256);
    if (!isValid) {
      fs.unlinkSync(rceditPath);
      throw new Error(
        "Downloaded rcedit.exe failed integrity check. SHA256 mismatch."
      );
    }
    process.stdout.write("Downloaded rcedit.exe passed integrity check.\n");
  }

  // Use execFile instead of exec for better security
  execFile(
    rceditPath,
    [exePath, "--set-icon", icoPath],
    (error, stdout, stderr) => {
      if (error) {
        process.stderr.write(`Error setting icon: ${error?.stack || error}\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write("Icon set successfully!\n");
      if (stdout) process.stdout.write(`Output: ${stdout}\n`);
      if (stderr) process.stderr.write(`Stderr: ${stderr}\n`);
    }
  );
}

fixExeIcon().catch((err) => {
  process.stderr.write(`Error: ${err?.stack || err}\n`);
  process.exitCode = 1;
});
