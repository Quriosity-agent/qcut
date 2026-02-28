#!/usr/bin/env node
/**
 * Creates a node_modules symlink for @composio/ao-core → packages/core
 * to work around Bun's node-linker=isolated not resolving nested workspace packages.
 */
import { mkdirSync, symlinkSync, existsSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(moduleDir, "..");
const target = join(root, "packages", "core");
const nmDir = join(root, "node_modules", "@composio");
const link = join(nmDir, "ao-core");

try {
  if (existsSync(link)) {
    const stat = lstatSync(link);
    if (stat.isSymbolicLink()) process.exit(0); // already linked
    // exists but not a symlink — remove it first
    const { rmSync } = await import("node:fs");
    rmSync(link, { recursive: true, force: true });
  }

  mkdirSync(nmDir, { recursive: true });
  symlinkSync(target, link, "junction"); // junction works on Windows without admin
  console.log("Linked @composio/ao-core → packages/core");
} catch (error) {
  console.error(
    `Warning: failed to link @composio/ao-core: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}
