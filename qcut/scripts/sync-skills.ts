/**
 * Sync skills from .claude/skills/ to resources/default-skills/
 *
 * This script makes .claude/skills/ the single source of truth for bundled skills.
 * Run during build to copy skills to the resources folder for production bundling.
 *
 * Usage: bun scripts/sync-skills.ts
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const SOURCE_DIR = ".claude/skills";
const TARGET_DIR = "resources/default-skills";

// Skills to sync (add new bundled skills here)
const BUNDLED_SKILLS = ["ai-content-pipeline", "ffmpeg-skill"];

function syncSkills() {
  console.log("📦 Syncing skills from .claude/skills/ → resources/default-skills/");

  // Ensure target directory exists
  if (!existsSync(TARGET_DIR)) {
    mkdirSync(TARGET_DIR, { recursive: true });
  }

  for (const skillName of BUNDLED_SKILLS) {
    const sourcePath = join(SOURCE_DIR, skillName);
    const targetPath = join(TARGET_DIR, skillName);

    if (!existsSync(sourcePath)) {
      console.warn(`⚠️  Skill not found: ${sourcePath}`);
      continue;
    }

    // Remove existing target if it exists
    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true });
    }

    // Copy skill folder
    cpSync(sourcePath, targetPath, { recursive: true });
    console.log(`✅ Synced: ${skillName}`);
  }

  console.log("✨ Skills sync complete!");
}

try {
  syncSkills();
} catch (error) {
  process.stderr.write(
    `sync-skills failed: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
}
