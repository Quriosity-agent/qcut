const { ipcMain, app } = require("electron");
const { spawn, execFile, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { TempManager } = require("./temp-manager.js");

const tempManager = new TempManager();

function setupFFmpegIPC() {
  // Handle ffmpeg-path request
  ipcMain.handle("ffmpeg-path", async () => {
    try {
      return getFFmpegPath();
    } catch (error) {
      // Error getting FFmpeg path
      throw error;
    }
  });

  // Create export session
  ipcMain.handle("create-export-session", async () => {
    return tempManager.createExportSession();
  });

  // Save frame to disk
  ipcMain.handle(
    "save-frame",
    async (event, { sessionId, frameName, data }) => {
      try {
        const frameDir = tempManager.getFrameDir(sessionId);
        const framePath = path.join(frameDir, frameName);
        const buffer = Buffer.from(data, "base64");

        // Validate buffer
        if (!buffer || buffer.length < 100) {
          throw new Error(`Invalid PNG buffer: ${buffer.length} bytes`);
        }

        // Check PNG signature (first 8 bytes should be PNG signature)
        const pngSignature = Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]);
        if (!buffer.subarray(0, 8).equals(pngSignature)) {
          // Warning: Invalid PNG signature
        }

        fs.writeFileSync(framePath, buffer);

        // Log first few frames for debugging
        if (frameName === "frame-0000.png" || frameName === "frame-0001.png") {
          // Saved frame to disk
        }

        return framePath;
      } catch (error) {
        // Error saving frame
        throw error;
      }
    }
  );

  // Read output file
  ipcMain.handle("read-output-file", async (event, outputPath) => {
    return fs.readFileSync(outputPath);
  });

  // Cleanup export session
  ipcMain.handle("cleanup-export-session", async (event, sessionId) => {
    tempManager.cleanup(sessionId);
  });

  // Open frames folder in file explorer
  ipcMain.handle("open-frames-folder", async (event, sessionId) => {
    const frameDir = tempManager.getFrameDir(sessionId);
    const { shell } = require("electron");
    shell.openPath(frameDir);
    return { success: true, path: frameDir };
  });

  // Export video with CLI
  ipcMain.handle("export-video-cli", async (event, options) => {
    const { sessionId, width, height, fps, quality } = options;

    return new Promise((resolve, reject) => {
      // Get session directories
      const frameDir = tempManager.getFrameDir(sessionId);
      const outputDir = tempManager.getOutputDir(sessionId);
      const outputFile = path.join(outputDir, "output.mp4");

      // Construct FFmpeg arguments
      const ffmpegPath = getFFmpegPath();
      const args = buildFFmpegArgs(
        frameDir,
        outputFile,
        width,
        height,
        fps,
        quality
      );

      // FFmpeg CLI configuration ready

      // Verify input directory exists and has frames
      const fs = require("fs");
      if (!fs.existsSync(frameDir)) {
        throw new Error(`Frame directory does not exist: ${frameDir}`);
      }

      const frameFiles = fs
        .readdirSync(frameDir)
        .filter((f) => f.startsWith("frame-") && f.endsWith(".png"));
      // Found frame files for export
      if (frameFiles.length === 0) {
        throw new Error(`No frame files found in: ${frameDir}`);
      }

      // Ensure output directory exists
      const outputDirPath = require("path").dirname(outputFile);
      if (!fs.existsSync(outputDirPath)) {
        fs.mkdirSync(outputDirPath, { recursive: true });
      }

      // Test simple command first: create 1-second video from first frame only
      const simpleArgs = [
        "-y",
        "-f",
        "image2",
        "-i",
        path.join(frameDir, "frame-0000.png"),
        "-c:v",
        "libx264",
        "-t",
        "1",
        "-pix_fmt",
        "yuv420p",
        outputFile,
      ];

      // Attempt to spawn FFmpeg process directly instead of requiring manual run
      const inputPattern = path.join(frameDir, "frame-%04d.png");

      // =============================
      // Try to run FFmpeg directly
      // =============================
      try {
        const ffmpegProc = spawn(ffmpegPath, args, {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        ffmpegProc.stderr.on("data", (chunk) => {
          const text = chunk.toString();
          const progress = parseProgress(text);
          if (progress) {
            event.sender?.send?.("ffmpeg-progress", progress);
          }
          if (process.env.DEBUG_FFMPEG) {
            // FFmpeg debug output
          }
        });

        ffmpegProc.on("error", (err) => {
          // FFmpeg spawn error
          reject(err);
        });

        ffmpegProc.on("close", (code) => {
          if (code === 0) {
            // FFmpeg finished successfully
            resolve({ success: true, outputFile, method: "spawn" });
          } else {
            reject(new Error(`FFmpeg exited with code ${code}`));
          }
        });

        // If spawn succeeded we exit early and skip manual fallback logic below.
        return;
      } catch (spawnErr) {
        // Direct spawn failed, falling back to manual instructions
      }
      const batchFile = path.join(
        tempManager.getOutputDir(sessionId),
        "ffmpeg_run.bat"
      );

      // Create batch file content using Windows CMD syntax
      const ffmpegDir = path.dirname(ffmpegPath);
      const ffmpegExe = path.basename(ffmpegPath);
      const batchContent = `@echo off
cd /d "${ffmpegDir}"
echo Starting FFmpeg export...
${ffmpegExe} -y -framerate 30 -i "${inputPattern}" -c:v libx264 -preset fast -crf 23 -t 5 -pix_fmt yuv420p -movflags +faststart "${outputFile}"
echo FFmpeg exit code: %ERRORLEVEL%
exit /b %ERRORLEVEL%`;

      // Creating batch file workaround

      // Write batch file
      fs.writeFileSync(batchFile, batchContent);

      // Since Electron process spawning is restricted on Windows, provide manual export option
      // Windows process spawning restricted, frames ready for manual export

      // Check if user has already created the video manually
      const checkForManualVideo = () => {
        if (fs.existsSync(outputFile)) {
          const stats = fs.statSync(outputFile);
          // Found manually created video
          resolve({
            success: true,
            outputFile,
            method: "manual",
            message: "Video created manually - frames exported successfully!",
          });
        } else {
          // Provide helpful error with manual instructions
          reject(
            new Error(
              `FFmpeg process spawning restricted by Windows. Please run the command manually:\n\ncd "${path.dirname(ffmpegPath)}" && ${path.basename(ffmpegPath)} -y -framerate 30 -i "${inputPattern}" -c:v libx264 -preset fast -crf 23 -t 5 -pix_fmt yuv420p "${outputFile}"\n\nFrames location: ${frameDir}`
            )
          );
        }
      };

      // Check immediately and also after a short delay
      checkForManualVideo();
      setTimeout(checkForManualVideo, 2000);
    });
  });
}

function getFFmpegPath() {
  let ffmpegPath;

  if (app.isPackaged) {
    // Production: FFmpeg is in the app's resources folder
    // Path structure: resources/app/electron/resources/ffmpeg.exe
    const appResourcePath = path.join(
      process.resourcesPath,
      "app",
      "electron",
      "resources",
      "ffmpeg.exe"
    );

    if (fs.existsSync(appResourcePath)) {
      ffmpegPath = appResourcePath;
    } else {
      // Fallback: try old location for backwards compatibility
      const oldPath = path.join(process.resourcesPath, "ffmpeg.exe");
      if (fs.existsSync(oldPath)) {
        ffmpegPath = oldPath;
      } else {
        throw new Error(
          `FFmpeg not found. Searched:\n1. ${appResourcePath}\n2. ${oldPath}`
        );
      }
    }
  } else {
    // Development: try bundled FFmpeg first, then system PATH
    const devPath = path.join(__dirname, "resources", "ffmpeg.exe");
    if (fs.existsSync(devPath)) {
      ffmpegPath = devPath;
    } else {
      ffmpegPath = "ffmpeg"; // System PATH
    }
  }

  // Verify FFmpeg exists (skip verification for system PATH)
  if (ffmpegPath !== "ffmpeg" && !fs.existsSync(ffmpegPath)) {
    throw new Error(`FFmpeg not found at: ${ffmpegPath}`);
  }

  // FFmpeg path resolved
  return ffmpegPath;
}

function buildFFmpegArgs(inputDir, outputFile, width, height, fps, quality) {
  const qualitySettings = {
    "high": { crf: "18", preset: "slow" },
    "medium": { crf: "23", preset: "fast" },
    "low": { crf: "28", preset: "veryfast" },
  };

  const { crf, preset } = qualitySettings[quality] || qualitySettings.medium;

  // Use exact same format that worked manually
  const inputPattern = path.join(inputDir, "frame-%04d.png");

  return [
    "-y", // Overwrite output
    "-framerate",
    String(fps),
    "-i",
    inputPattern,
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    crf,
    "-t",
    "10", // Limit to 10 seconds to avoid issues
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputFile,
  ];
}

function parseProgress(output) {
  // Parse FFmpeg progress from output
  const frameMatch = output.match(/frame=\s*(\d+)/);
  const timeMatch = output.match(/time=(\d+:\d+:\d+\.\d+)/);

  if (frameMatch || timeMatch) {
    return {
      frame: frameMatch ? parseInt(frameMatch[1]) : null,
      time: timeMatch ? timeMatch[1] : null,
    };
  }
  return null;
}

module.exports = { setupFFmpegIPC };
