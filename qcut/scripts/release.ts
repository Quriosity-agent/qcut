#!/usr/bin/env node
/**
 * QCut Release Script
 *
 * Automates the release process:
 * 1. Version bumping
 * 2. Building the application
 * 3. Generating checksums
 * 4. Creating release notes template
 *
 * Usage:
 *   node scripts/release.js patch   # 0.1.0 -> 0.1.1
 *   node scripts/release.js minor   # 0.1.0 -> 0.2.0
 *   node scripts/release.js major   # 0.1.0 -> 1.0.0
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

type ReleaseType = "patch" | "minor" | "major";
const RELEASE_TYPES: ReleaseType[] = ["patch", "minor", "major"];

interface PackageJson {
  version: string;
  [key: string]: any;
}

/**
 * Resolves the build output directory based on environment
 * @returns The build output directory path
 */
function resolveBuildOutputDir(): string {
  // Check for environment variable first (CI/CD)
  if (process.env.BUILD_OUTPUT_DIR) {
    return process.env.BUILD_OUTPUT_DIR;
  }

  // Handle both source and compiled execution contexts
  const isCompiled = __dirname.includes('dist');
  const rootDir = isCompiled 
    ? path.join(__dirname, '../../')  // Go up from dist/scripts
    : path.join(__dirname, '../');     // Go up from scripts

  // Default to dist folder in project root
  return path.join(rootDir, "dist");
}

function main(): void {
  const releaseType: string | undefined = process.argv[2];

  if (!releaseType || !RELEASE_TYPES.includes(releaseType as ReleaseType)) {
    process.stderr.write(
      "❌ Usage: node scripts/release.js <patch|minor|major>\n"
    );
    process.exit(1);
  }

  process.stdout.write(`🚀 Starting ${releaseType} release process...\n\n`);

  try {
    // Step 1: Check working directory is clean
    process.stdout.write("📋 Step 1: Checking git status...\n");
    checkGitStatus();

    // Step 2: Bump version
    process.stdout.write("📋 Step 2: Bumping version...\n");
    const newVersion: string = bumpVersion(releaseType as ReleaseType);

    // Step 3: Build web application
    process.stdout.write("📋 Step 3: Building web application...\n");
    buildWebApp();

    // Step 4: Build Electron application
    process.stdout.write("📋 Step 4: Building Electron application...\n");
    buildElectronApp();

    // Step 5: Generate checksums
    process.stdout.write("📋 Step 5: Generating checksums...\n");
    generateChecksums();

    // Step 6: Create git tag
    process.stdout.write("📋 Step 6: Creating git tag...\n");
    createGitTag(newVersion);

    // Step 7: Generate release notes template
    process.stdout.write("📋 Step 7: Generating release notes...\n");
    generateReleaseNotes(newVersion);

    process.stdout.write(
      `\n✅ Release v${newVersion} prepared successfully!\n`
    );
    process.stdout.write("\n📋 Next steps:\n");
    process.stdout.write("1. Review the generated files\n");
    process.stdout.write(
      "2. Push the tag: git push origin v" + newVersion + "\n"
    );
    process.stdout.write("3. Create GitHub release with the installer\n");
    process.stdout.write("4. Use the generated release notes template\n");
  } catch (error: any) {
    process.stderr.write(`\n❌ Release process failed: ${error?.message || error}\n`);
    process.exit(1);
  }
}

function checkGitStatus(): void {
  const status: string = execSync("git status --porcelain", { encoding: "utf8" });
  if (status.trim()) {
    throw new Error(
      "Working directory is not clean. Please commit your changes first."
    );
  }
  process.stdout.write("✅ Working directory is clean\n");
}

function bumpVersion(releaseType: ReleaseType): string {
  // Handle both source and compiled execution contexts
  const isCompiled = __dirname.includes('dist');
  const rootDir = isCompiled 
    ? path.join(__dirname, '../../')  // Go up from dist/scripts
    : path.join(__dirname, '../');     // Go up from scripts

  const packagePath: string = path.join(rootDir, "package.json");
  const packageJson: PackageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  const currentVersion: string = packageJson.version;
  const [major, minor, patch]: number[] = currentVersion.split(".").map(Number);

  let newVersion: string;
  switch (releaseType) {
    case "patch":
      newVersion = `${major}.${minor}.${patch + 1}`;
      break;
    case "minor":
      newVersion = `${major}.${minor + 1}.0`;
      break;
    case "major":
      newVersion = `${major + 1}.0.0`;
      break;
  }

  packageJson.version = newVersion;
  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n");

  process.stdout.write(
    `✅ Version bumped: ${currentVersion} -> ${newVersion}\n`
  );
  return newVersion;
}

function buildWebApp(): void {
  try {
    execSync("bun run build", { stdio: "inherit" });
    process.stdout.write("✅ Web application built successfully\n");
  } catch (error: any) {
    throw new Error("Failed to build web application");
  }
}

function buildElectronApp(): void {
  try {
    execSync("bun run dist:win:release", { stdio: "inherit" });
    process.stdout.write("✅ Electron application built successfully\n");
  } catch (error: any) {
    throw new Error("Failed to build Electron application");
  }
}

function generateChecksums(): void {
  const buildDir: string = resolveBuildOutputDir();
  const installerPattern: RegExp = /QCut.*Setup.*\.exe$/;

  try {
    const files: string[] = fs.readdirSync(buildDir);
    const installerFile: string | undefined = files.find((file: string) => installerPattern.test(file));

    if (!installerFile) {
      throw new Error("Installer file not found");
    }

    const installerPath: string = path.join(buildDir, installerFile);

    // Generate SHA256 checksum
    const checksum: string = execSync(
      `powershell "Get-FileHash '${installerPath}' -Algorithm SHA256 | Select-Object -ExpandProperty Hash"`,
      { encoding: "utf8" }
    ).trim();

    // Write checksums file
    const checksumContent: string = `SHA256 Checksums for QCut Release
=================================

${installerFile}
SHA256: ${checksum}

Verification:
1. Download the installer
2. Run: certutil -hashfile "${installerFile}" SHA256
3. Compare with the hash above
`;

    fs.writeFileSync(path.join(buildDir, "SHA256SUMS.txt"), checksumContent);
    process.stdout.write(`✅ Checksums generated for ${installerFile}\n`);
  } catch (error: any) {
    throw new Error("Failed to generate checksums: " + error.message);
  }
}

function createGitTag(version: string): void {
  try {
    // Add package.json to staging
    execSync("git add package.json");

    // Commit version bump
    execSync(`git commit -m "chore: bump version to v${version}"`);

    // Create tag
    execSync(`git tag -a v${version} -m "Release v${version}"`);

    process.stdout.write(`✅ Git tag v${version} created\n`);
  } catch (error: any) {
    throw new Error("Failed to create git tag: " + error.message);
  }
}

function generateReleaseNotes(version: string): void {
  const buildDir: string = resolveBuildOutputDir();
  const installerPattern: RegExp = /QCut.*Setup.*\.exe$/;

  try {
    const files: string[] = fs.readdirSync(buildDir);
    const installerFile: string | undefined = files.find((file: string) => installerPattern.test(file));
    
    if (!installerFile) {
      throw new Error("Installer file not found for release notes");
    }

    const installerStats: fs.Stats = fs.statSync(path.join(buildDir, installerFile));
    const fileSizeMB: string = (installerStats.size / (1024 * 1024)).toFixed(1);

    const releaseNotes: string = `# QCut Video Editor v${version}

## 🎉 What's New

<!-- Add your changes here -->
- 

## 🐛 Bug Fixes

<!-- Add bug fixes here -->
- 

## 🔧 Technical Changes

<!-- Add technical changes here -->
- 

## 📦 Download

**Windows Installer:**
- **File:** \`${installerFile}\`
- **Size:** ${fileSizeMB} MB
- **SHA256:** See SHA256SUMS.txt

## 🔒 Security Notice

⚠️ **This is an unsigned installer.** QCut is an open-source project and releases are not code signed due to cost constraints.

**Expected Windows behavior:**
- Windows Defender SmartScreen will show a warning
- Click "More info" then "Run anyway"
- This is normal for open-source software

**Verify authenticity:**
1. Only download from official GitHub releases
2. Check SHA256 checksum matches SHA256SUMS.txt
3. All source code is available for review

## 📋 Installation

1. Download \`${installerFile}\`
2. Run the installer (see security notice above)
3. Follow the installation wizard
4. QCut will be available in Start Menu and Desktop

## 🔄 Auto-Updates

This version includes auto-update functionality:
- Checks for updates automatically every hour
- Notifies when updates are available
- Updates install on next app restart

## 🛠️ Technical Requirements

- **OS:** Windows 10/11 (64-bit)
- **RAM:** 4GB minimum, 8GB recommended
- **Storage:** 500MB free space
- **GPU:** DirectX 11 compatible (recommended)

## 🐛 Known Issues

- FFmpeg path issue in installed version (export may fail)
- First launch may take longer due to initial setup

---

**Full Changelog:** https://github.com/your-org/qcut/compare/v${getPreviousVersion()}...v${version}
`;

    fs.writeFileSync(path.join(buildDir, "RELEASE_NOTES.md"), releaseNotes);
    process.stdout.write("✅ Release notes template generated\n");
  } catch (error: any) {
    process.stdout.write(
      "⚠️  Could not generate full release notes template, creating basic version\n"
    );

    // Handle both source and compiled execution contexts for fallback
    const isCompiled = __dirname.includes('dist');
    const rootDir = isCompiled 
      ? path.join(__dirname, '../../')  // Go up from dist/scripts
      : path.join(__dirname, '../');     // Go up from scripts

    const basicNotes: string = `# QCut Video Editor v${version}

## Download
- Windows Installer: Available in this release
- See SHA256SUMS.txt for checksums

## Security Notice
This is an unsigned installer - see documentation for details.
`;

    fs.writeFileSync(path.join(rootDir, "RELEASE_NOTES.md"), basicNotes);
  }
}

function getPreviousVersion(): string {
  try {
    const tags: string = execSync("git tag --sort=-version:refname", {
      encoding: "utf8",
    });
    const tagList: string[] = tags
      .trim()
      .split("\n")
      .filter((tag: string) => tag.match(/^v\d+\.\d+\.\d+$/));
    return tagList[1] || "v0.0.0"; // Return second tag (previous version)
  } catch (error: any) {
    return "v0.0.0";
  }
}

if (require.main === module) {
  main();
}

// CommonJS export for backward compatibility
module.exports = { main, bumpVersion, generateChecksums };

// ES6 export for TypeScript files
export { main, bumpVersion, generateChecksums };
export type { ReleaseType, PackageJson };