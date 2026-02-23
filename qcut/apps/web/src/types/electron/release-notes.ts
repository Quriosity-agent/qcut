/**
 * Release note types.
 */

export type ReleaseNote = {
	/** Semver version string */
	version: string;
	/** Release date in ISO format */
	date: string;
	/** Release channel: stable, alpha, beta, or rc */
	channel: "stable" | "alpha" | "beta" | "rc";
	/** Raw Markdown content (excluding frontmatter) */
	content: string;
};
