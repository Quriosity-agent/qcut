import { mkdtempSync, rmSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		isPackaged: false,
		getPath: vi.fn(() => "/mock/Documents"),
		getAppPath: vi.fn(() => "/mock/App"),
	},
	ipcMain: {
		handle: vi.fn(),
	},
}));

import { syncSkillsForClaudeProject } from "../skills-sync-handler";

const MANAGED_SKILLS = ["qcut-toolkit", "native-cli"] as const;
const tempDirs: string[] = [];

function createTempDir({ prefix }: { prefix: string }): string {
	const tempDir = mkdtempSync(path.join(tmpdir(), prefix));
	tempDirs.push(tempDir);
	return tempDir;
}

async function writeSkillFile({
	rootPath,
	skillName,
	content,
}: {
	rootPath: string;
	skillName: string;
	content: string;
}): Promise<void> {
	const skillDir = path.join(rootPath, skillName);
	await fs.mkdir(skillDir, { recursive: true });
	await fs.writeFile(path.join(skillDir, "Skill.md"), content, "utf-8");
}

async function readSkillFile({
	rootPath,
	skillName,
}: {
	rootPath: string;
	skillName: string;
}): Promise<string> {
	const skillPath = path.join(rootPath, skillName, "Skill.md");
	return fs.readFile(skillPath, "utf-8");
}

afterEach(() => {
	for (const tempDir of tempDirs.splice(0, tempDirs.length)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("syncSkillsForClaudeProject", () => {
	it("copies bundled baseline into canonical skills and Claude mirror", async () => {
		const projectRootPath = createTempDir({ prefix: "qcut-project-skills-" });
		const bundledSkillsPath = createTempDir({ prefix: "qcut-bundled-skills-" });

		await writeSkillFile({
			rootPath: bundledSkillsPath,
			skillName: "qcut-toolkit",
			content: "# qcut-toolkit\n",
		});
		await writeSkillFile({
			rootPath: bundledSkillsPath,
			skillName: "native-cli",
			content: "# native-cli\n",
		});

		const result = await syncSkillsForClaudeProject({
			projectId: "project_1",
			projectRootPath,
			bundledSkillsPath,
			managedSkillFolders: MANAGED_SKILLS,
		});

		expect(result.error).toBeUndefined();
		expect(result.synced).toBe(true);
		expect(result.copied).toBe(4);

		const canonicalSkillsPath = path.join(projectRootPath, "skills");
		const claudeMirrorSkillsPath = path.join(
			projectRootPath,
			".claude",
			"skills"
		);

		await expect(
			readSkillFile({
				rootPath: canonicalSkillsPath,
				skillName: "qcut-toolkit",
			})
		).resolves.toBe("# qcut-toolkit\n");
		await expect(
			readSkillFile({
				rootPath: canonicalSkillsPath,
				skillName: "native-cli",
			})
		).resolves.toBe("# native-cli\n");

		await expect(
			readSkillFile({
				rootPath: claudeMirrorSkillsPath,
				skillName: "qcut-toolkit",
			})
		).resolves.toBe("# qcut-toolkit\n");
		await expect(
			readSkillFile({
				rootPath: claudeMirrorSkillsPath,
				skillName: "native-cli",
			})
		).resolves.toBe("# native-cli\n");

		await expect(
			fs.readFile(
				path.join(projectRootPath, ".claude", ".skills-sync-manifest.json"),
				"utf-8"
			)
		).resolves.toContain("qcut-toolkit");
	});

	it("removes a retired skill from the mirror only while it matches the last sync", async () => {
		const projectRootPath = createTempDir({ prefix: "qcut-project-skills-" });
		const bundledSkillsPath = createTempDir({ prefix: "qcut-bundled-skills-" });
		await writeSkillFile({
			rootPath: bundledSkillsPath,
			skillName: "qcut-toolkit",
			content: "# toolkit\n",
		});
		await writeSkillFile({
			rootPath: bundledSkillsPath,
			skillName: "ai-content-pipeline",
			content: "# retired\n",
		});
		const mirrorPath = path.join(
			projectRootPath,
			".claude",
			"skills",
			"ai-content-pipeline"
		);

		// An earlier app version bundled and managed the skill.
		await syncSkillsForClaudeProject({
			projectId: "project_retired",
			projectRootPath,
			bundledSkillsPath,
			managedSkillFolders: ["qcut-toolkit", "ai-content-pipeline"],
			retiredSkillFolders: [],
		});
		await expect(fs.access(mirrorPath)).resolves.toBeUndefined();

		// The new version no longer bundles it: the untouched copy goes away.
		await fs.rm(path.join(bundledSkillsPath, "ai-content-pipeline"), {
			recursive: true,
			force: true,
		});
		const retired = await syncSkillsForClaudeProject({
			projectId: "project_retired",
			projectRootPath,
			bundledSkillsPath,
			managedSkillFolders: ["qcut-toolkit"],
			retiredSkillFolders: ["ai-content-pipeline"],
		});
		expect(retired.error).toBeUndefined();
		expect(retired.removed).toBe(1);
		await expect(fs.access(mirrorPath)).rejects.toThrow();
	});

	it("keeps a retired skill folder the user edited", async () => {
		const projectRootPath = createTempDir({ prefix: "qcut-project-skills-" });
		const bundledSkillsPath = createTempDir({ prefix: "qcut-bundled-skills-" });
		await writeSkillFile({
			rootPath: bundledSkillsPath,
			skillName: "ai-content-pipeline",
			content: "# retired\n",
		});
		const mirrorSkillsPath = path.join(projectRootPath, ".claude", "skills");

		await syncSkillsForClaudeProject({
			projectId: "project_retired_edited",
			projectRootPath,
			bundledSkillsPath,
			managedSkillFolders: ["ai-content-pipeline"],
			retiredSkillFolders: [],
		});
		await writeSkillFile({
			rootPath: mirrorSkillsPath,
			skillName: "ai-content-pipeline",
			content: "# my own notes\n",
		});

		await fs.rm(path.join(bundledSkillsPath, "ai-content-pipeline"), {
			recursive: true,
			force: true,
		});
		const retired = await syncSkillsForClaudeProject({
			projectId: "project_retired_edited",
			projectRootPath,
			bundledSkillsPath,
			managedSkillFolders: [],
			retiredSkillFolders: ["ai-content-pipeline"],
		});
		expect(retired.error).toBeUndefined();
		expect(retired.removed).toBe(0);
		await expect(
			readSkillFile({
				rootPath: mirrorSkillsPath,
				skillName: "ai-content-pipeline",
			})
		).resolves.toBe("# my own notes\n");
	});

	it("skips recopy when canonical and mirror are unchanged", async () => {
		const projectRootPath = createTempDir({ prefix: "qcut-project-skills-" });
		const bundledSkillsPath = createTempDir({ prefix: "qcut-bundled-skills-" });

		await writeSkillFile({
			rootPath: bundledSkillsPath,
			skillName: "qcut-toolkit",
			content: "# same\n",
		});

		await syncSkillsForClaudeProject({
			projectId: "project_2",
			projectRootPath,
			bundledSkillsPath,
			managedSkillFolders: ["qcut-toolkit"],
		});

		const secondResult = await syncSkillsForClaudeProject({
			projectId: "project_2",
			projectRootPath,
			bundledSkillsPath,
			managedSkillFolders: ["qcut-toolkit"],
		});

		expect(secondResult.error).toBeUndefined();
		expect(secondResult.synced).toBe(false);
		expect(secondResult.copied).toBe(0);
		expect(secondResult.skipped).toBe(2);
	});

	it("recopies only the changed skill when bundled content is updated", async () => {
		const projectRootPath = createTempDir({ prefix: "qcut-project-skills-" });
		const bundledSkillsPath = createTempDir({ prefix: "qcut-bundled-skills-" });

		await writeSkillFile({
			rootPath: bundledSkillsPath,
			skillName: "qcut-toolkit",
			content: "# old toolkit\n",
		});
		await writeSkillFile({
			rootPath: bundledSkillsPath,
			skillName: "native-cli",
			content: "# stable native-cli\n",
		});

		await syncSkillsForClaudeProject({
			projectId: "project_3",
			projectRootPath,
			bundledSkillsPath,
			managedSkillFolders: MANAGED_SKILLS,
		});

		await writeSkillFile({
			rootPath: bundledSkillsPath,
			skillName: "qcut-toolkit",
			content: "# new toolkit\n",
		});

		const secondResult = await syncSkillsForClaudeProject({
			projectId: "project_3",
			projectRootPath,
			bundledSkillsPath,
			managedSkillFolders: MANAGED_SKILLS,
		});

		expect(secondResult.error).toBeUndefined();
		expect(secondResult.synced).toBe(true);
		expect(secondResult.copied).toBe(2);
		expect(secondResult.skipped).toBe(2);

		const canonicalSkillsPath = path.join(projectRootPath, "skills");
		const claudeMirrorSkillsPath = path.join(
			projectRootPath,
			".claude",
			"skills"
		);

		await expect(
			readSkillFile({
				rootPath: canonicalSkillsPath,
				skillName: "qcut-toolkit",
			})
		).resolves.toBe("# new toolkit\n");
		await expect(
			readSkillFile({
				rootPath: canonicalSkillsPath,
				skillName: "native-cli",
			})
		).resolves.toBe("# stable native-cli\n");

		await expect(
			readSkillFile({
				rootPath: claudeMirrorSkillsPath,
				skillName: "qcut-toolkit",
			})
		).resolves.toBe("# new toolkit\n");
		await expect(
			readSkillFile({
				rootPath: claudeMirrorSkillsPath,
				skillName: "native-cli",
			})
		).resolves.toBe("# stable native-cli\n");
	});

	it("returns warning and no-op when bundled source is missing", async () => {
		const projectRootPath = createTempDir({ prefix: "qcut-project-skills-" });
		const bundledSkillsPath = path.join(
			projectRootPath,
			"missing-default-skills"
		);

		const result = await syncSkillsForClaudeProject({
			projectId: "project_4",
			projectRootPath,
			bundledSkillsPath,
			managedSkillFolders: MANAGED_SKILLS,
		});

		expect(result.error).toBeUndefined();
		expect(result.synced).toBe(false);
		expect(result.copied).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain("Bundled skills source not found");
	});

	it("rejects invalid project IDs safely", async () => {
		const projectRootPath = createTempDir({ prefix: "qcut-project-skills-" });
		const bundledSkillsPath = createTempDir({ prefix: "qcut-bundled-skills-" });

		const result = await syncSkillsForClaudeProject({
			projectId: "../project_5",
			projectRootPath,
			bundledSkillsPath,
			managedSkillFolders: MANAGED_SKILLS,
		});

		expect(result.synced).toBe(false);
		expect(result.copied).toBe(0);
		expect(result.skipped).toBe(0);
		expect(result.error).toBe("Invalid project ID");
	});
});
