/**
 * Skill Types for QCut AI Skills System
 *
 * Skills are AI agent capabilities stored as markdown files with YAML frontmatter.
 * They are stored per-project in the project/skills/ folder.
 */

/**
 * Skill metadata parsed from Skill.md frontmatter.
 */
export interface Skill {
	id: string;
	name: string;
	description: string;
	dependencies?: string; // e.g., "python>=3.10", "ffmpeg"
	folderName: string; // folder name in project/skills/
	mainFile: string; // typically "Skill.md"
	additionalFiles: string[]; // ["REFERENCE.md", "CONCEPTS.md"]
	content: string; // Full markdown content
	createdAt: number;
	updatedAt: number;
}

/**
 * Skill frontmatter from YAML header.
 */
export interface SkillFrontmatter {
	name: string;
	description: string;
	dependencies?: string;
}

/**
 * Parse frontmatter from Skill.md content.
 * Extracts YAML between --- markers at the start of the file.
 *
 * @example
 * ```markdown
 * ---
 * name: AI Content Pipeline
 * description: Generate AI content using YAML pipelines
 * dependencies: python>=3.10
 * ---
 * # Main content here
 * ```
 */
export function parseSkillFrontmatter(
	content: string
): SkillFrontmatter | null {
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
