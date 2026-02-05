/**
 * Patches node-pty to fix Windows build issues:
 * 1. Removes dependency on GetCommitHash.bat (path issues)
 * 2. Disables Spectre mitigation (requires extra VS components)
 * 3. Creates GenVersion.h header file
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NODE_PTY_PATH = join(process.cwd(), "node_modules", "node-pty");

function patchFile(filePath: string, replacements: [string, string][]) {
  if (!existsSync(filePath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return false;
  }

  let content = readFileSync(filePath, "utf-8");
  let modified = false;

  for (const [search, replace] of replacements) {
    // Use split/join to replace ALL occurrences
    if (content.includes(search)) {
      content = content.split(search).join(replace);
      modified = true;
    }
  }

  if (modified) {
    writeFileSync(filePath, content);
    console.log(`✅ Patched: ${filePath}`);
    return true;
  }

  console.log(`ℹ️  Already patched or no changes needed: ${filePath}`);
  return false;
}

function main() {
  console.log("🔧 Patching node-pty for Windows build...\n");

  if (!existsSync(NODE_PTY_PATH)) {
    console.log("ℹ️  node-pty not installed, skipping patch");
    return;
  }

  // Patch winpty.gyp
  const winptyGyp = join(NODE_PTY_PATH, "deps", "winpty", "src", "winpty.gyp");
  patchFile(winptyGyp, [
    // Fix GetCommitHash.bat path issue
    [
      `'WINPTY_COMMIT_HASH%': '<!(cmd /c "cd shared && GetCommitHash.bat")',`,
      `'WINPTY_COMMIT_HASH%': 'none',`,
    ],
    // Fix UpdateGenVersion.bat and include path
    [
      `'include_dirs': [
            # Add the 'src/gen' directory to the include path and force gyp to
            # run the script (re)generating the version header.
            '<!(cmd /c "cd shared && UpdateGenVersion.bat <(WINPTY_COMMIT_HASH)")',
        ]`,
      `'include_dirs': [
            'gen',
        ],
        'defines!': [],  # Clear any conflicting defines`,
    ],
    // Disable Spectre mitigation
    [`'SpectreMitigation': 'Spectre'`, `'SpectreMitigation': 'false'`],
  ]);

  // Patch binding.gyp
  const bindingGyp = join(NODE_PTY_PATH, "binding.gyp");
  patchFile(bindingGyp, [
    [`'SpectreMitigation': 'Spectre'`, `'SpectreMitigation': 'false'`],
  ]);

  // Create gen directory and GenVersion.h
  const genDir = join(NODE_PTY_PATH, "deps", "winpty", "src", "gen");
  if (!existsSync(genDir)) {
    mkdirSync(genDir, { recursive: true });
    console.log(`✅ Created: ${genDir}`);
  }

  const genVersionH = join(genDir, "GenVersion.h");
  if (!existsSync(genVersionH)) {
    writeFileSync(
      genVersionH,
      `// AUTO-GENERATED VERSION HEADER
const char GenVersion_Version[] = "0.4.4-dev";
const char GenVersion_Commit[] = "none";
`
    );
    console.log(`✅ Created: ${genVersionH}`);
  }

  console.log("\n✨ node-pty patching complete!");
}

main();
