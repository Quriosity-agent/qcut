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
 *   node scripts/release.js alpha   # 0.1.0 -> 0.1.1-alpha.1
 *   node scripts/release.js beta    # 0.1.0 -> 0.1.1-beta.1
 *   node scripts/release.js rc      # 0.1.0 -> 0.1.1-rc.1
 *   node scripts/release.js promote # 0.1.1-rc.2 -> 0.1.1
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

type ReleaseType =
  | "patch"
  | "minor"
  | "major"
  | "alpha"
  | "beta"
  | "rc"
  | "promote";
const RELEASE_TYPES: ReleaseType[] = [
  "patch",
  "minor",
  "major",
  "alpha",
  "beta",
  "rc",
  "promote",
];

type PrereleaseChannel = "alpha" | "beta" | "rc";
const PRERELEASE_CHANNELS: PrereleaseChannel[] = ["alpha", "beta", "rc"];

interface PackageJson {
  version: string;
  [key: string]: any;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: { channel: string; number: number } | null;
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
  const currentDir = import.meta.dirname;
  const isCompiled = currentDir.includes("dist");
  const rootDir = isCompiled
    ? path.join(currentDir, "../../") // Go up from dist/scripts
    : path.join(currentDir, "../"); // Go up from scripts

  // Default to dist-electron folder in project root
  return path.join(rootDir, "dist-electron");
}

function main(): void {
  const releaseType: string | undefined = process.argv[2];

  if (!releaseType || !RELEASE_TYPES.includes(releaseType as ReleaseType)) {
    process.stderr.write(
      "Usage: bun run release <patch|minor|major|alpha|beta|rc|promote>\n\n" +
        "  patch   - Bump patch version (0.3.52 -> 0.3.53)\n" +
        "  minor   - Bump minor version (0.3.52 -> 0.4.0)\n" +
        "  major   - Bump major version (0.3.52 -> 1.0.0)\n" +
        "  alpha   - Create/bump alpha prerelease (0.3.52 -> 0.3.53-alpha.1)\n" +
        "  beta    - Create/bump beta prerelease (0.3.52 -> 0.3.53-beta.1)\n" +
        "  rc      - Create/bump release candidate (0.3.52 -> 0.3.53-rc.1)\n" +
        "  promote - Promote prerelease to stable (0.3.53-rc.2 -> 0.3.53)\n"
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

    // Step 3: Generate release doc in docs/releases/
    process.stdout.write("📋 Step 3: Generating release doc...\n");
    generateReleaseDoc(newVersion, releaseType as ReleaseType);

    // Step 4: Build web application
    process.stdout.write("📋 Step 4: Building web application...\n");
    buildWebApp();

    // Step 5: Build Electron application
    process.stdout.write("📋 Step 5: Building Electron application...\n");
    buildElectronApp();

    // Step 6: Generate checksums
    process.stdout.write("📋 Step 6: Generating checksums...\n");
    generateChecksums();

    // Step 7: Create git tag
    process.stdout.write("📋 Step 7: Creating git tag...\n");
    createGitTag(newVersion);

    // Step 8: Generate release notes template
    process.stdout.write("📋 Step 8: Generating release notes...\n");
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
    process.stderr.write(
      `\n❌ Release process failed: ${error?.message || error}\n`
    );
    process.exit(1);
  }
}

/**
 * Generate a release doc in docs/releases/ from the [Unreleased] section of CHANGELOG.md.
 * Also updates latest.md for stable releases.
 */
function generateReleaseDoc(version: string, releaseType: ReleaseType): void {
  const currentDir = import.meta.dirname;
  const isCompiled = currentDir.includes("dist");
  const rootDir = isCompiled
    ? path.join(currentDir, "../../")
    : path.join(currentDir, "../");

  const releasesDir = path.join(rootDir, "docs", "releases");
  const changelogPath = path.join(rootDir, "CHANGELOG.md");

  if (!fs.existsSync(releasesDir)) {
    fs.mkdirSync(releasesDir, { recursive: true });
  }

  const today = new Date().toISOString().split("T")[0];
  const channel =
    releaseType === "promote"
      ? "stable"
      : PRERELEASE_CHANNELS.includes(releaseType as PrereleaseChannel)
        ? releaseType
        : "stable";

  // Extract [Unreleased] content from CHANGELOG.md
  let unreleasedContent = "";
  if (fs.existsSync(changelogPath)) {
    const changelog = fs.readFileSync(changelogPath, "utf-8");
    const unreleasedMatch = changelog.match(
      /## \[Unreleased\]\s*\n([\s\S]*?)(?=\n## \[|$)/
    );
    if (unreleasedMatch) {
      unreleasedContent = unreleasedMatch[1].trim();
    }
  }

  const sections = unreleasedContent || `- Release v${version}`;
  const releaseDoc = `---
version: "${version}"
date: "${today}"
channel: "${channel}"
---

# QCut v${version}

${sections}
`;

  const filename = `v${version}.md`;
  fs.writeFileSync(path.join(releasesDir, filename), releaseDoc);
  process.stdout.write(`✅ Created docs/releases/${filename}\n`);

  if (channel === "stable") {
    fs.writeFileSync(path.join(releasesDir, "latest.md"), releaseDoc);
    process.stdout.write("✅ Updated docs/releases/latest.md\n");
  }

  // Update CHANGELOG.md: move [Unreleased] content to new version section
  if (fs.existsSync(changelogPath) && unreleasedContent) {
    const changelog = fs.readFileSync(changelogPath, "utf-8");
    const updatedChangelog = changelog.replace(
      /## \[Unreleased\]\s*\n[\s\S]*?(?=\n## \[|$)/,
      `## [Unreleased]\n\n## [${version}] - ${today}\n\n${unreleasedContent}\n`
    );
    fs.writeFileSync(changelogPath, updatedChangelog);
    process.stdout.write("✅ Updated CHANGELOG.md with new version section\n");
  }

  // Stage the release docs for the git tag step
  try {
    execSync(`git add docs/releases/${filename}`);
    if (channel === "stable") {
      execSync("git add docs/releases/latest.md");
    }
    if (unreleasedContent) {
      execSync("git add CHANGELOG.md");
    }
  } catch {
    process.stdout.write("⚠️  Could not stage release docs (non-fatal)\n");
  }
}

function checkGitStatus(): void {
  const status: string = execSync("git status --porcelain", {
    encoding: "utf8",
  });
  if (status.trim()) {
    throw new Error(
      "Working directory is not clean. Please commit your changes first."
    );
  }
  process.stdout.write("✅ Working directory is clean\n");
}

/**
 * Parse a version string into its components
 * Handles both stable (1.2.3) and prerelease (1.2.3-beta.4) formats
 */
function parseVersion(version: string): ParsedVersion {
  // Matches: 1.2.3 or 1.2.3-beta.4
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4]
      ? { channel: match[4], number: parseInt(match[5], 10) }
      : null,
  };
}

/**
 * Bump a prerelease version
 * - If same channel: increment number (0.3.53-beta.1 -> 0.3.53-beta.2)
 * - If stable: bump patch and start at 1 (0.3.52 -> 0.3.53-beta.1)
 * - If different channel (progressing): start new channel at 1 (0.3.53-alpha.5 -> 0.3.53-beta.1)
 * - If different channel (regressing): bump patch first (0.3.53-rc.1 -> 0.3.54-alpha.1)
 */
function bumpPrerelease(
  parsed: ParsedVersion,
  channel: PrereleaseChannel
): string {
  const { major, minor, patch, prerelease } = parsed;

  // If current is same channel, increment prerelease number
  if (prerelease && prerelease.channel === channel) {
    return `${major}.${minor}.${patch}-${channel}.${prerelease.number + 1}`;
  }

  // If current is stable, bump patch and start prerelease at 1
  if (!prerelease) {
    return `${major}.${minor}.${patch + 1}-${channel}.1`;
  }

  // If switching channels (e.g., alpha -> beta, beta -> rc)
  const channelOrder: PrereleaseChannel[] = ["alpha", "beta", "rc"];
  const currentIdx = channelOrder.indexOf(
    prerelease.channel as PrereleaseChannel
  );
  const targetIdx = channelOrder.indexOf(channel);

  if (targetIdx > currentIdx) {
    // Progressing forward (alpha -> beta -> rc): keep same base version
    return `${major}.${minor}.${patch}-${channel}.1`;
  }
  // Going backward: bump patch first
  return `${major}.${minor}.${patch + 1}-${channel}.1`;
}

function bumpVersion(releaseType: ReleaseType): string {
  // Handle both source and compiled execution contexts
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const isCompiled = currentDir.includes(`${path.sep}dist${path.sep}`);
  const rootDir = isCompiled
    ? path.join(currentDir, "../../") // Go up from dist/scripts
    : path.join(currentDir, "../"); // Go up from scripts

  const packagePath: string = path.join(rootDir, "package.json");
  const packageJson: PackageJson = JSON.parse(
    fs.readFileSync(packagePath, "utf8")
  );

  const currentVersion: string = packageJson.version;
  const parsed = parseVersion(currentVersion);

  let newVersion: string;
  switch (releaseType) {
    case "patch":
      // Reset prerelease, bump patch from base version
      newVersion = `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
      break;
    case "minor":
      newVersion = `${parsed.major}.${parsed.minor + 1}.0`;
      break;
    case "major":
      newVersion = `${parsed.major + 1}.0.0`;
      break;
    case "alpha":
    case "beta":
    case "rc":
      newVersion = bumpPrerelease(parsed, releaseType);
      break;
    case "promote":
      // Remove prerelease suffix to promote to stable
      if (!parsed.prerelease) {
        throw new Error("Cannot promote: current version is not a prerelease");
      }
      newVersion = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
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
    const installerFile: string | undefined = files.find((file: string) =>
      installerPattern.test(file)
    );

    if (!installerFile) {
      throw new Error("Installer file not found");
    }

    const installerPath: string = path.join(buildDir, installerFile);

    // Generate SHA256 checksum using certutil (works on all Windows versions)
    const certutilOutput: string = execSync(
      `certutil -hashfile "${installerPath}" SHA256`,
      { encoding: "utf8" }
    );
    // certutil output: line 0 = header, line 1 = hash, line 2 = status
    const checksum: string = certutilOutput.split("\n")[1].trim().toUpperCase();

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
    const installerFile: string | undefined = files.find((file: string) =>
      installerPattern.test(file)
    );

    if (!installerFile) {
      throw new Error("Installer file not found for release notes");
    }

    const installerStats: fs.Stats = fs.statSync(
      path.join(buildDir, installerFile)
    );
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

**Full Changelog:** https://github.com/qcut-team/qcut/compare/v${getPreviousVersion()}...v${version}
`;

    fs.writeFileSync(path.join(buildDir, "RELEASE_NOTES.md"), releaseNotes);
    process.stdout.write("✅ Release notes template generated\n");
  } catch (error: any) {
    process.stdout.write(
      "⚠️  Could not generate full release notes template, creating basic version\n"
    );

    // Handle both source and compiled execution contexts for fallback
    const currentDir = import.meta.dirname;
    const isCompiled = currentDir.includes("dist");
    const rootDir = isCompiled
      ? path.join(currentDir, "../../") // Go up from dist/scripts
      : path.join(currentDir, "../"); // Go up from scripts

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
      .filter((tag: string) =>
        tag.match(/^v\d+\.\d+\.\d+(-(?:alpha|beta|rc)\.\d+)?$/)
      );
    return tagList[1] || "v0.0.0"; // Return second tag (previous version)
  } catch (error: any) {
    return "v0.0.0";
  }
}

if (require.main === module) {
  main();
}

// CommonJS export for backward compatibility
module.exports = {
  main,
  bumpVersion,
  generateChecksums,
  parseVersion,
  bumpPrerelease,
};

// ES6 export for TypeScript files
export { main, bumpVersion, generateChecksums, parseVersion, bumpPrerelease };
export type { ReleaseType, PackageJson, ParsedVersion, PrereleaseChannel };
