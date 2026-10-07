import { createHash } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { checkTrackedPaths } from "./check-filter-provenance";

const fileSchema = z.object({
	path: z.string(),
	bytes: z.number().int().nonnegative(),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const manifestSchema = z.object({
	schemaVersion: z.literal(1),
	files: z.array(fileSchema).min(1),
	generatedFiles: z.array(fileSchema),
});
const sourceExtensions = new Set([
	".py",
	".swift",
	".json",
	".ts",
	".js",
	".metal",
	".sh",
	".txt",
]);
const digest = ({ bytes }: { bytes: Uint8Array }) =>
	createHash("sha256").update(bytes).digest("hex");

export function stageIndependentBeauty({
	sourceRoot,
	outputRoot,
}: {
	sourceRoot: string;
	outputRoot: string;
}) {
	const source = path.resolve(sourceRoot),
		output = path.resolve(outputRoot);
	const relative = path.relative(output, source);
	if (
		!relative ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative)) ||
		output.startsWith(`${source}${path.sep}`)
	)
		throw new Error("Stage output must be separate from its source");
	if (!lstatSync(source).isDirectory() || lstatSync(source).isSymbolicLink())
		throw new Error("Source root must be a regular directory");
	const manifestBytes = readFileSync(path.join(source, "source-manifest.json"));
	const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString()));
	const files = [...manifest.files, ...manifest.generatedFiles];
	const violations = checkTrackedPaths(
		files.map(({ path: filePath }) => filePath)
	);
	if (violations.length)
		throw new Error("Private artifact in staged source manifest");
	const paths = new Set<string>();
	const payload = files.map((file) => {
		const segments = file.path.split("/");
		if (
			segments.some(
				(segment) =>
					!segment ||
					segment === "." ||
					segment === ".." ||
					segment.startsWith(".")
			) ||
			file.path.includes("\\") ||
			file.path.includes(":") ||
			path.isAbsolute(file.path) ||
			!sourceExtensions.has(path.extname(file.path)) ||
			segments.some((segment) =>
				[
					"runtime",
					"output",
					"Cache",
					"Models",
					"build",
					"__pycache__",
				].includes(segment)
			) ||
			paths.has(file.path)
		)
			throw new Error(`Invalid staged source path: ${file.path}`);
		paths.add(file.path);
		for (let index = 1; index <= segments.length; index++) {
			const entry = lstatSync(path.join(source, ...segments.slice(0, index)));
			if (
				entry.isSymbolicLink() ||
				(index === segments.length ? !entry.isFile() : !entry.isDirectory())
			)
				throw new Error(`Non-regular staged source: ${file.path}`);
		}
		const bytes = readFileSync(path.join(source, file.path));
		if (bytes.length !== file.bytes || digest({ bytes }) !== file.sha256)
			throw new Error(`Staged source hash mismatch: ${file.path}`);
		return { path: file.path, bytes };
	});
	if (
		!readFileSync(path.join(source, "source-manifest.json")).equals(
			manifestBytes
		)
	)
		throw new Error("Source manifest changed during staging");
	mkdirSync(path.dirname(output), { recursive: true });
	const temporary = mkdtempSync(
		path.join(path.dirname(output), ".independent-beauty-stage-")
	);
	try {
		for (const file of payload) {
			const destination = path.join(temporary, file.path);
			mkdirSync(path.dirname(destination), { recursive: true });
			writeFileSync(destination, file.bytes);
		}
		writeFileSync(path.join(temporary, "source-manifest.json"), manifestBytes);
		rmSync(output, { recursive: true, force: true });
		renameSync(temporary, output);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
	return {
		files: files.length,
		sourceManifestSha256: digest({ bytes: manifestBytes }),
	};
}
if (import.meta.main)
	console.log(
		stageIndependentBeauty({
			sourceRoot: path.resolve("research/independent-beauty"),
			outputRoot: path.resolve("build/independent-beauty"),
		})
	);
