/**
 * Vendors the MIT-licensed gl-transitions shader collection and generates the
 * Transition Lab recipes for it.
 *
 *   bun scripts/import-gl-transitions.ts --from <extracted gl-transitions repo>
 *   bun scripts/import-gl-transitions.ts            # regenerate from the vendored copy
 *
 * `--from` copies `transitions/*.glsl` and `LICENSE` into the vendored
 * directory and records the pinned commit; without it the script only
 * regenerates the TypeScript from what is already vendored. Generated files
 * are committed so the build never needs the network.
 */
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import {
	adaptGlTransition,
	glTransitionDisplayName,
	glTransitionSlug,
} from "../electron/native-pipeline/transitions/gl-transition-adapter.js";

const ROOT = path.resolve(import.meta.dir, "..");
const TRANSITIONS_DIR = path.join(ROOT, "electron/native-pipeline/transitions");
const VENDOR_DIR = path.join(TRANSITIONS_DIR, "gl-transitions");
const VENDOR_SHADERS = path.join(VENDOR_DIR, "transitions");
const MANIFEST_PATH = path.join(VENDOR_DIR, "manifest.json");
const SOURCE_URL = "https://github.com/gl-transitions/gl-transitions";
/** Keep every generated chunk comfortably under the repo's 800-line ceiling. */
const CHUNK_LINE_BUDGET = 600;
const DEFAULT_DURATION = 0.8;

/** Files whose extra textures fall outside the from/to contract. */
const EXCLUDED: Record<string, string> = {
	"displacement.glsl": "requires an extra displacementMap sampler",
	"luma.glsl": "requires an extra luma sampler",
};

interface ManifestFile {
	file: string;
	author?: string;
	sha256: string;
}

interface Manifest {
	source: string;
	commit: string;
	license: "MIT";
	excluded: Array<{ file: string; reason: string }>;
	files: ManifestFile[];
}

function parseArgs(): { from?: string; commit?: string } {
	const args = process.argv.slice(2);
	const read = (flag: string) => {
		const index = args.indexOf(flag);
		return index >= 0 ? args[index + 1] : undefined;
	};
	return { from: read("--from"), commit: read("--commit") };
}

function sha256(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function vendor({ from, commit }: { from: string; commit: string }): void {
	const sourceShaders = path.join(from, "transitions");
	const license = path.join(from, "LICENSE");
	if (!existsSync(sourceShaders) || !existsSync(license)) {
		throw new Error(`${from} does not look like a gl-transitions checkout`);
	}
	rmSync(VENDOR_SHADERS, { recursive: true, force: true });
	mkdirSync(VENDOR_SHADERS, { recursive: true });
	copyFileSync(license, path.join(VENDOR_DIR, "LICENSE"));
	for (const file of readdirSync(sourceShaders)) {
		if (!file.endsWith(".glsl") || file in EXCLUDED) continue;
		// The repo normalises text to LF on commit (.gitattributes); hash and
		// vendor the LF form so manifest.json matches the checked-in bytes.
		const source = readFileSync(path.join(sourceShaders, file), "utf8");
		writeFileSync(
			path.join(VENDOR_SHADERS, file),
			source.replace(/\r\n?/g, "\n")
		);
	}
	const files: ManifestFile[] = readdirSync(VENDOR_SHADERS)
		.filter((file) => file.endsWith(".glsl"))
		.sort()
		.map((file) => {
			const buffer = readFileSync(path.join(VENDOR_SHADERS, file));
			const author = /^[ \t]*\/\/[ \t]*Author:[ \t]*(.+?)[ \t]*$/im.exec(
				buffer.toString("utf8")
			)?.[1];
			return { file, ...(author ? { author } : {}), sha256: sha256(buffer) };
		});
	const manifest: Manifest = {
		source: SOURCE_URL,
		commit,
		license: "MIT",
		excluded: Object.entries(EXCLUDED).map(([file, reason]) => ({
			file,
			reason,
		})),
		files,
	};
	writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, "\t")}\n`);
}

/** Template-literal safe: only backslash, backtick and `${` need escaping. */
function templateLiteral(value: string): string {
	return `\`${value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;
}

function recipeSource({ file, author }: ManifestFile): string {
	const source = readFileSync(path.join(VENDOR_SHADERS, file), "utf8");
	const adapted = adaptGlTransition({ source, fileName: file });
	const slug = glTransitionSlug({ fileName: file });
	const name = glTransitionDisplayName({ fileName: file });
	const credit = author ?? "unknown author";
	return [
		"\t{",
		`\t\tid: ${JSON.stringify(`gl-${slug}`)},`,
		`\t\tname: ${JSON.stringify(name)},`,
		`\t\tlocalizedName: ${JSON.stringify(name)},`,
		`\t\tdescription: ${JSON.stringify(`gl-transitions/${file} by ${credit} (MIT)`)},`,
		`\t\tdefaultDuration: ${DEFAULT_DURATION},`,
		'\t\tclip: { type: "shader", easing: "linear" },',
		"\t\tshader: {",
		`\t\t\tfragmentSource: ${templateLiteral(adapted.fragmentSource)},`,
		'\t\t\torigin: "gl-transitions",',
		'\t\t\tlicense: "MIT",',
		"\t\t\tbinaryAssets: false,",
		...(author ? [`\t\t\tauthor: ${JSON.stringify(author)},`] : []),
		`\t\t\tsourceFile: ${JSON.stringify(file)},`,
		"\t\t},",
		"\t},",
	].join("\n");
}

function generate(): void {
	const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
	const header = (index: number) =>
		[
			`// Generated by scripts/import-gl-transitions.ts from ${manifest.source}`,
			`// at commit ${manifest.commit}. Do not edit; rerun the script instead.`,
			'import type { TransitionLabRecipe } from "./transition-lab-catalog.js";',
			"",
			`export const GL_TRANSITION_RECIPES_${String(index).padStart(2, "0")}: TransitionLabRecipe[] = [`,
		].join("\n");
	for (const stale of readdirSync(TRANSITIONS_DIR)) {
		if (/^gl-transitions-recipes-\d+\.ts$/.test(stale)) {
			rmSync(path.join(TRANSITIONS_DIR, stale));
		}
	}
	const chunkNames: string[] = [];
	let chunk: string[] = [];
	let chunkLines = 0;
	let chunkIndex = 1;
	const flush = () => {
		if (chunk.length === 0) return;
		const name = `gl-transitions-recipes-${String(chunkIndex).padStart(2, "0")}`;
		writeFileSync(
			path.join(TRANSITIONS_DIR, `${name}.ts`),
			`${[header(chunkIndex), ...chunk, "];"].join("\n")}\n`
		);
		chunkNames.push(name);
		chunk = [];
		chunkLines = 0;
		chunkIndex += 1;
	};
	for (const entry of manifest.files) {
		const source = recipeSource(entry);
		const lines = source.split("\n").length;
		if (chunkLines + lines > CHUNK_LINE_BUDGET) flush();
		chunk.push(source);
		chunkLines += lines;
	}
	flush();
	const index = [
		"// Generated by scripts/import-gl-transitions.ts. Do not edit.",
		'import type { TransitionLabRecipe } from "./transition-lab-catalog.js";',
		...chunkNames.map(
			(name, position) =>
				`import { GL_TRANSITION_RECIPES_${String(position + 1).padStart(2, "0")} } from "./${name}.js";`
		),
		"",
		`export const GL_TRANSITIONS_COMMIT = ${JSON.stringify(manifest.commit)};`,
		"",
		"export const GL_TRANSITION_RECIPES: TransitionLabRecipe[] = [",
		...chunkNames.map(
			(_, position) =>
				`\t...GL_TRANSITION_RECIPES_${String(position + 1).padStart(2, "0")},`
		),
		"];",
	].join("\n");
	writeFileSync(
		path.join(TRANSITIONS_DIR, "gl-transitions-recipes.ts"),
		`${index}\n`
	);
	console.log(
		`Generated ${manifest.files.length} gl-transitions recipes in ${chunkNames.length} chunks (commit ${manifest.commit.slice(0, 7)}).`
	);
}

const { from, commit } = parseArgs();
if (from) {
	if (!commit) throw new Error("--from requires --commit <sha> for provenance");
	vendor({ from, commit });
}
generate();
