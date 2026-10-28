/**
 * The `fontsdir` libass gets for a burn-in.
 *
 * libass reads every file in its fontsdir into memory when the filter starts
 * (the macOS Supplemental folder alone made each export's FFmpeg ~480 MB
 * larger), and a family it does not find there comes from the platform's
 * font provider. On macOS that is CoreText, whose matching in libass 0.17
 * answers (Avenir Next, bold, upright) with AvenirNext-BoldItalic, so bold
 * captions came out italic. A folder holding links to just the font files of
 * the families a script names — found in every font folder, including
 * /System/Library/Fonts and ~/Library/Fonts — lets libass read those faces
 * itself (FreeType reports each face's weight and slant) and costs only the
 * fonts used. Families it cannot find still come from the provider.
 *
 * @module electron/claude/handlers/claude-export-handler/ass-fonts-dir
 */
import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { assFontFilesForFamilies } from "./ass-font-metrics.js";

/**
 * The fontsdir used when no folder of its own is built: the platform folder
 * with the CJK families (Songti, Kaiti… on macOS), so a requested family is
 * used rather than swapped.
 */
export function platformAssFontsDirectory(
	platform: NodeJS.Platform = process.platform
): string | undefined {
	if (platform === "darwin") return "/System/Library/Fonts/Supplemental";
	if (platform === "win32") {
		return `${process.env.WINDIR ?? "C:\\Windows"}\\Fonts`;
	}
	return undefined;
}

/** Every family an ASS script names: each style's Fontname and every `\fn`. */
export function assFamiliesFromScript(script: string): string[] {
	const families = new Set<string>();
	let fontnameIndex = -1;
	for (const line of script.split(/\r?\n/)) {
		const format = /^Format:\s*(.*)$/i.exec(line);
		if (format) {
			const fields = format[1].split(",").map((field) => field.trim());
			if (fields.includes("Fontname")) {
				fontnameIndex = fields.indexOf("Fontname");
			}
			continue;
		}
		const style = /^Style:\s*(.*)$/i.exec(line);
		if (style && fontnameIndex >= 0) {
			const family = style[1].split(",")[fontnameIndex]?.trim();
			if (family) families.add(family.replace(/^@/, ""));
			continue;
		}
		if (/^Dialogue:/i.test(line)) {
			for (const match of line.matchAll(/\\fn([^\\}]+)/g)) {
				const family = match[1].trim();
				if (family) families.add(family.replace(/^@/, ""));
			}
		}
	}
	return [...families];
}

/**
 * Builds `directory` with links to the font files of the families the
 * scripts name and returns it. Off macOS, or when none of the families is
 * installed in a font folder, it returns the platform folder instead (the
 * behaviour before; Windows and Linux are not changed).
 */
export function prepareAssFontsDirectory({
	scripts,
	directory,
	fontDirectories,
	platform = process.platform,
}: {
	scripts: string[];
	directory: string;
	/** Folders to search instead of the system's (tests). */
	fontDirectories?: string[];
	platform?: NodeJS.Platform;
}): string | undefined {
	if (platform !== "darwin") return platformAssFontsDirectory(platform);
	const families = [...new Set(scripts.flatMap(assFamiliesFromScript))];
	const files = assFontFilesForFamilies({
		families,
		directories: fontDirectories,
	});
	if (files.length === 0) return platformAssFontsDirectory(platform);
	mkdirSync(directory, { recursive: true });
	for (const [index, file] of files.entries()) {
		// Same-named files exist in different folders (a user's Arial).
		const link = path.join(directory, `${index}-${path.basename(file)}`);
		try {
			symlinkSync(file, link);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	return directory;
}
