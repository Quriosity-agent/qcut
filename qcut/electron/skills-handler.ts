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
 * Parse frontmatter from Skill.md content
 */
function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
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

      try {
        await fs.access(skillsPath);
      } catch {
        // Skills folder doesn't exist yet - return empty array
        log.info("[Skills Handler] Skills folder not found, returning empty array");
        return [];
      }

      const entries = await fs.readdir(skillsPath, { withFileTypes: true });
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

      const skillsPath = getProjectSkillsPath(projectId);
      const folderName = path.basename(sourcePath);
      const destPath = path.join(skillsPath, folderName);

      try {
        // Ensure skills directory exists
        await fs.mkdir(skillsPath, { recursive: true });

        // Check if source has Skill.md
        const sourceSkillMd = path.join(sourcePath, "Skill.md");
        try {
          await fs.access(sourceSkillMd);
        } catch {
          log.error("[Skills Handler] No Skill.md found in source folder");
          return null;
        }

        // Copy entire skill folder
        await fs.cp(sourcePath, destPath, { recursive: true });

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

      const skillPath = path.join(getProjectSkillsPath(projectId), skillId);

      try {
        await fs.rm(skillPath, { recursive: true, force: true });
        log.info("[Skills Handler] Successfully deleted skill:", skillId);
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

      const filePath = path.join(
        getProjectSkillsPath(projectId),
        skillId,
        filename
      );

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

  log.info("[Skills Handler] Skills IPC handlers registered");
}

// CommonJS export for backward compatibility with main.js
module.exports = { setupSkillsIPC };

// ES6 export for TypeScript files
export default { setupSkillsIPC };
export type { Skill, SkillFrontmatter, Logger };
