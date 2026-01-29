import { ipcMain, app, dialog, IpcMainInvokeEvent } from "electron";
import * as fs from "fs/promises";
import * as path from "path";

// Type definitions
interface Logger {
  info(message?: any, ...optionalParams: any[]): void;
  warn(message?: any, ...optionalParams: any[]): void;
  error(message?: any, ...optionalParams: any[]): void;
  debug(message?: any, ...optionalParams: any[]): void;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  dependencies?: string;
  folderName: string;
  mainFile: string;
  additionalFiles: string[];
  content: string;
  createdAt: number;
  updatedAt: number;
}

interface SkillFrontmatter {
  name: string;
  description: string;
  dependencies?: string;
}

// Try to load electron-log, fallback to no-op if not available
let log: Logger;
try {
  log = require("electron-log");
} catch (error) {
  // Create a no-op logger to avoid console usage (per project guidelines)
  const noop = (): void => {};
  log = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
  };
}

/**
 * Get the path to the project's skills folder
 */
function getProjectSkillsPath(projectId: string): string {
  const documentsPath = app.getPath("documents");
  return path.join(documentsPath, "QCut", "Projects", projectId, "skills");
}

/**
 * Validate that a resolved path is within the allowed base directory.
 * Prevents path traversal attacks (e.g., "../../../etc/passwd").
 */
function isPathWithinBase(targetPath: string, basePath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(basePath);
  return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
}

/**
 * Sanitize a filename/skillId to prevent path traversal.
 * Only allows alphanumeric, dash, underscore, and dot (no slashes or ..).
 */
function sanitizePathSegment(segment: string): string {
  // Remove any path separators and parent directory references
  return segment.replace(/[/\\]/g, "").replace(/\.\./g, "");
}

/**
 * Get the path to the global .claude/skills folder
 */
function getGlobalSkillsPath(): string {
  const homePath = app.getPath("home");
  return path.join(homePath, ".claude", "skills");
}

/**
 * Get the path to bundled default skills (shipped with app)
 */
function getBundledSkillsPath(): string {
  // In production (packaged), resources are in app.getAppPath()/resources/
  // In development, they're in the project root
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "default-skills");
  }
  // Development: __dirname is dist/electron/, so go up 2 levels to project root
  return path.join(__dirname, "..", "..", "resources", "default-skills");
}

/**
 * Parse frontmatter from Skill.md content
 * Handles both LF (\n) and CRLF (\r\n) line endings
 */
function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  // Normalize line endings to LF
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const match = normalizedContent.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result: Record<string, string> = {};

  for (const line of yaml.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      result[key] = value;
    }
  }

  return {
    name: result.name || "Unnamed Skill",
    description: result.description || "",
    dependencies: result.dependencies,
  };
}

/**
 * Setup skills IPC handlers
 */
export function setupSkillsIPC(): void {
  log.info("[Skills Handler] Setting up skills IPC handlers...");

  // List all skills in project
  ipcMain.handle(
    "skills:list",
    async (event: IpcMainInvokeEvent, projectId: string): Promise<Skill[]> => {
      log.info("[Skills Handler] Listing skills for project:", projectId);

      const skillsPath = getProjectSkillsPath(projectId);

      let entries;
      try {
        entries = await fs.readdir(skillsPath, { withFileTypes: true });
      } catch {
        // Skills folder doesn't exist or can't be read - return empty array
        log.info("[Skills Handler] Skills folder not accessible, returning empty array");
        return [];
      }

      const skills: Skill[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillFolder = path.join(skillsPath, entry.name);
        const skillMdPath = path.join(skillFolder, "Skill.md");

        try {
          const content = await fs.readFile(skillMdPath, "utf-8");
          const frontmatter = parseSkillFrontmatter(content);
          if (!frontmatter) {
            log.warn("[Skills Handler] Invalid frontmatter in:", skillMdPath);
            continue;
          }

          // Get additional .md files
          const files = await fs.readdir(skillFolder);
          const additionalFiles = files.filter(
            (f) => f !== "Skill.md" && f.endsWith(".md")
          );

          const stat = await fs.stat(skillMdPath);

          skills.push({
            id: entry.name,
            name: frontmatter.name,
            description: frontmatter.description,
            dependencies: frontmatter.dependencies,
            folderName: entry.name,
            mainFile: "Skill.md",
            additionalFiles,
            content,
            createdAt: stat.birthtimeMs,
            updatedAt: stat.mtimeMs,
          });

          log.info("[Skills Handler] Loaded skill:", frontmatter.name);
        } catch (error) {
          // Skip invalid skill folders
          log.warn("[Skills Handler] Failed to load skill from:", skillFolder, error);
        }
      }

      log.info("[Skills Handler] Total skills loaded:", skills.length);
      return skills;
    }
  );

  // Import skill from source path
  ipcMain.handle(
    "skills:import",
    async (
      event: IpcMainInvokeEvent,
      projectId: string,
      sourcePath: string
    ): Promise<Skill | null> => {
      log.info("[Skills Handler] Importing skill from:", sourcePath);

      // Security: Validate source path is within allowed directories
      const globalSkillsPath = getGlobalSkillsPath();
      const bundledSkillsPath = getBundledSkillsPath();
      const resolvedSource = path.resolve(sourcePath);

      const isFromGlobal = isPathWithinBase(resolvedSource, globalSkillsPath);
      const isFromBundled = isPathWithinBase(resolvedSource, bundledSkillsPath);

      if (!isFromGlobal && !isFromBundled) {
        log.error(
          "[Skills Handler] Security: Source path not in allowed directories:",
          resolvedSource
        );
        return null;
      }

      const skillsPath = getProjectSkillsPath(projectId);
      // Security: Use only the basename to prevent path traversal in destination
      const folderName = sanitizePathSegment(path.basename(sourcePath));
      if (!folderName) {
        log.error("[Skills Handler] Security: Invalid folder name");
        return null;
      }
      const destPath = path.join(skillsPath, folderName);

      try {
        // Ensure skills directory exists
        await fs.mkdir(skillsPath, { recursive: true });

        // Check if source has Skill.md
        const sourceSkillMd = path.join(resolvedSource, "Skill.md");
        try {
          await fs.access(sourceSkillMd);
        } catch {
          log.error("[Skills Handler] No Skill.md found in source folder");
          return null;
        }

        // Copy entire skill folder (source already validated above)
        await fs.cp(resolvedSource, destPath, { recursive: true });

        // Read and parse the skill
        const skillMdPath = path.join(destPath, "Skill.md");
        const content = await fs.readFile(skillMdPath, "utf-8");
        const frontmatter = parseSkillFrontmatter(content);

        if (!frontmatter) {
          log.error("[Skills Handler] Invalid Skill.md frontmatter");
          // Cleanup on failure
          await fs.rm(destPath, { recursive: true, force: true });
          return null;
        }

        const files = await fs.readdir(destPath);
        const additionalFiles = files.filter(
          (f) => f !== "Skill.md" && f.endsWith(".md")
        );
        const stat = await fs.stat(skillMdPath);

        const skill: Skill = {
          id: folderName,
          name: frontmatter.name,
          description: frontmatter.description,
          dependencies: frontmatter.dependencies,
          folderName,
          mainFile: "Skill.md",
          additionalFiles,
          content,
          createdAt: stat.birthtimeMs,
          updatedAt: stat.mtimeMs,
        };

        log.info("[Skills Handler] Successfully imported skill:", skill.name);
        return skill;
      } catch (error) {
        log.error("[Skills Handler] Failed to import skill:", error);
        return null;
      }
    }
  );

  // Delete skill
  ipcMain.handle(
    "skills:delete",
    async (
      event: IpcMainInvokeEvent,
      projectId: string,
      skillId: string
    ): Promise<void> => {
      log.info("[Skills Handler] Deleting skill:", skillId);

      // Security: Sanitize skillId to prevent path traversal
      const sanitizedSkillId = sanitizePathSegment(skillId);
      if (!sanitizedSkillId || sanitizedSkillId !== skillId) {
        log.error("[Skills Handler] Security: Invalid skill ID:", skillId);
        throw new Error("Invalid skill ID");
      }

      const skillsPath = getProjectSkillsPath(projectId);
      const skillPath = path.join(skillsPath, sanitizedSkillId);

      // Security: Verify the resolved path is within the skills directory
      if (!isPathWithinBase(skillPath, skillsPath)) {
        log.error("[Skills Handler] Security: Path traversal attempt detected");
        throw new Error("Invalid skill path");
      }

      try {
        await fs.rm(skillPath, { recursive: true, force: true });
        log.info("[Skills Handler] Successfully deleted skill:", sanitizedSkillId);
      } catch (error) {
        log.error("[Skills Handler] Failed to delete skill:", error);
        throw error;
      }
    }
  );

  // Get skill content (for viewing specific files)
  ipcMain.handle(
    "skills:getContent",
    async (
      event: IpcMainInvokeEvent,
      projectId: string,
      skillId: string,
      filename: string
    ): Promise<string> => {
      log.info("[Skills Handler] Getting content:", skillId, filename);

      // Security: Sanitize skillId and filename to prevent path traversal
      const sanitizedSkillId = sanitizePathSegment(skillId);
      const sanitizedFilename = sanitizePathSegment(filename);

      if (!sanitizedSkillId || !sanitizedFilename) {
        log.error("[Skills Handler] Security: Invalid skill ID or filename");
        throw new Error("Invalid skill ID or filename");
      }

      // Security: Only allow .md files to be read
      if (!sanitizedFilename.endsWith(".md")) {
        log.error("[Skills Handler] Security: Only .md files can be read");
        throw new Error("Only markdown files can be read");
      }

      const skillsPath = getProjectSkillsPath(projectId);
      const filePath = path.join(skillsPath, sanitizedSkillId, sanitizedFilename);

      // Security: Verify the resolved path is within the skills directory
      if (!isPathWithinBase(filePath, skillsPath)) {
        log.error("[Skills Handler] Security: Path traversal attempt detected");
        throw new Error("Invalid file path");
      }

      try {
        return await fs.readFile(filePath, "utf-8");
      } catch (error) {
        log.error("[Skills Handler] Failed to read file:", error);
        throw error;
      }
    }
  );

  // Browse for skill folders (opens dialog)
  ipcMain.handle("skills:browse", async (): Promise<string | null> => {
    log.info("[Skills Handler] Opening folder browser dialog");

    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Skill Folder",
      message: "Choose a folder containing Skill.md",
    });

    if (result.canceled || !result.filePaths.length) {
      log.info("[Skills Handler] Browse canceled");
      return null;
    }

    const selectedPath = result.filePaths[0];

    // Verify it contains Skill.md
    try {
      await fs.access(path.join(selectedPath, "Skill.md"));
      log.info("[Skills Handler] Valid skill folder selected:", selectedPath);
      return selectedPath;
    } catch {
      log.warn(
        "[Skills Handler] Selected folder does not contain Skill.md:",
        selectedPath
      );
      // Still return the path - let the import function handle validation
      return selectedPath;
    }
  });

  // Get skills folder path (for displaying in UI)
  ipcMain.handle(
    "skills:getPath",
    async (
      event: IpcMainInvokeEvent,
      projectId: string
    ): Promise<string> => {
      return getProjectSkillsPath(projectId);
    }
  );

  // Scan for available skills (bundled + global ~/.claude/skills)
  ipcMain.handle(
    "skills:scanGlobal",
    async (): Promise<
      Array<{ path: string; name: string; description: string; bundled?: boolean }>
    > => {
      log.info("[Skills Handler] Scanning for available skills");

      const availableSkills: Array<{
        path: string;
        name: string;
        description: string;
        bundled?: boolean;
      }> = [];

      // Helper function to scan a directory for skills
      const scanSkillsDirectory = async (
        dirPath: string,
        isBundled: boolean
      ) => {
        let entries;
        try {
          entries = await fs.readdir(dirPath, { withFileTypes: true });
        } catch {
          log.info("[Skills Handler] Skills folder not accessible:", dirPath);
          return;
        }

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const skillFolder = path.join(dirPath, entry.name);
          const skillMdPath = path.join(skillFolder, "Skill.md");

          try {
            const content = await fs.readFile(skillMdPath, "utf-8");
            const frontmatter = parseSkillFrontmatter(content);

            if (frontmatter) {
              availableSkills.push({
                path: skillFolder,
                name: frontmatter.name,
                description: frontmatter.description,
                bundled: isBundled,
              });
              log.info(
                `[Skills Handler] Found ${isBundled ? "bundled" : "global"} skill:`,
                frontmatter.name
              );
            }
          } catch {
            // Skip folders without valid Skill.md
          }
        }
      };

      // 1. Scan bundled skills (shipped with app)
      const bundledPath = getBundledSkillsPath();
      log.info("[Skills Handler] __dirname:", __dirname);
      log.info("[Skills Handler] app.isPackaged:", app.isPackaged);
      log.info("[Skills Handler] Scanning bundled skills at:", bundledPath);
      await scanSkillsDirectory(bundledPath, true);

      // 2. Scan global ~/.claude/skills
      const globalPath = getGlobalSkillsPath();
      log.info("[Skills Handler] Scanning global skills at:", globalPath);
      await scanSkillsDirectory(globalPath, false);

      log.info(
        "[Skills Handler] Total available skills found:",
        availableSkills.length
      );
      return availableSkills;
    }
  );

  log.info("[Skills Handler] Skills IPC handlers registered");
}

// CommonJS export for backward compatibility with main.js
module.exports = { setupSkillsIPC };

// ES6 export for TypeScript files
export default { setupSkillsIPC };
export type { Skill, SkillFrontmatter, Logger };
