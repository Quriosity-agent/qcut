#!/usr/bin/env node
/**
 * Creates a node_modules symlink for @composio/ao-core → packages/core
 * to work around Bun's node-linker=isolated not resolving nested workspace packages.
 */
import { mkdirSync, symlinkSync, existsSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = join(root, "packages", "core");
const nmDir = join(root, "node_modules", "@composio");
const link = join(nmDir, "ao-core");

if (existsSync(link)) {
  const stat = lstatSync(link);
  if (stat.isSymbolicLink()) process.exit(0); // already linked
}

mkdirSync(nmDir, { recursive: true });
symlinkSync(target, link, "junction"); // junction works on Windows without admin
console.log("Linked @composio/ao-core → packages/core");
