import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

// Updated with the curated source manifest; source and manifest must change together.
export const BODY_PHOTO_SOURCE_MANIFEST_SHA256 =
	"97efe9714c6546ca60df5d2dc70f271f2b27f077f4e2f8e13844616ba3f9b6c1";

interface FileIdentity {
	bytes: number;
	sha256: string;
}

interface SourceManifest {
	schemaVersion: number;
	upstreamCommit: string;
	files: Record<string, FileIdentity>;
	engineOverrides: Record<string, FileIdentity & { sourcePath: string }>;
}

interface PreparedSources {
	root: string;
	bodyRoot: string;
	manifestSha256: string;
	files: number;
}

const OWNERSHIP_FILE = "qcut-source-stage.json";
const OWNERSHIP_OWNER = "qcut-body-photo-sources";

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set([
	".py",
	".json",
	".js",
	".html",
	".css",
	".md",
	".txt",
	".swift",
	".metal",
]);

function identity({ data }: { data: Buffer }): FileIdentity {
	return {
		bytes: data.length,
		sha256: createHash("sha256").update(data).digest("hex"),
	};
}

function assertSourcePath({ name }: { name: string }): void {
	const segments = name.split("/");
	const unsafe =
		name !== ".gitignore" &&
		(!name ||
			path.posix.isAbsolute(name) ||
			/[\\:\0]/.test(name) ||
			segments.some(
				(part) =>
					!part ||
					part.startsWith(".") ||
					/^(runtime|models?|weights?|__pycache__|node_modules|output)$/i.test(
						part
					)
			));
	if (
		unsafe ||
		(name !== ".gitignore" && !SOURCE_EXTENSIONS.has(path.posix.extname(name)))
	) {
		throw new Error(`Unsafe body photo source path: ${name}`);
	}
}

function assertDirectoryChain({ directory }: { directory: string }): void {
	let current = path.resolve(directory);
	while (true) {
		if (existsSync(current) || lstatIfPresent({ target: current })) {
			const entry = lstatSync(current);
			if (!entry.isDirectory() || entry.isSymbolicLink()) {
				throw new Error(
					`Body photo source directories cannot be symlinks: ${current}`
				);
			}
		}
		const parent = path.dirname(current);
		if (parent === current) return;
		current = parent;
	}
}

function lstatIfPresent({ target }: { target: string }): boolean {
	try {
		lstatSync(target);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function readSource({ root, name }: { root: string; name: string }): Buffer {
	assertSourcePath({ name });
	const target = path.join(root, ...name.split("/"));
	assertDirectoryChain({ directory: path.dirname(target) });
	const info = lstatSync(target);
	if (
		!info.isFile() ||
		info.isSymbolicLink() ||
		info.size <= 0 ||
		info.size > MAX_SOURCE_BYTES
	) {
		throw new Error(`Bounded regular body photo source required: ${name}`);
	}
	const data = readFileSync(target);
	if (data.includes(0))
		throw new Error(`Binary body photo source rejected: ${name}`);
	return data;
}

function assertIdentity({
	data,
	expected,
	name,
}: {
	data: Buffer;
	expected: FileIdentity;
	name: string;
}): void {
	const actual = identity({ data });
	if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
		throw new Error(`Body photo source integrity failed: ${name}`);
	}
}

function parseIdentity({ value }: { value: unknown }): FileIdentity {
	if (!value || typeof value !== "object")
		throw new Error("Invalid body photo source identity");
	const record = value as Record<string, unknown>;
	if (
		!Number.isSafeInteger(record.bytes) ||
		Number(record.bytes) <= 0 ||
		Number(record.bytes) > MAX_SOURCE_BYTES ||
		typeof record.sha256 !== "string" ||
		!SHA256.test(record.sha256)
	) {
		throw new Error("Invalid body photo source identity");
	}
	return { bytes: Number(record.bytes), sha256: record.sha256 };
}

function loadManifest({
	root,
	manifestSha256 = BODY_PHOTO_SOURCE_MANIFEST_SHA256,
}: {
	root: string;
	manifestSha256?: string;
}): {
	manifest: SourceManifest;
	data: Buffer;
} {
	const data = readSource({ root, name: "source-manifest.json" });
	if (identity({ data }).sha256 !== manifestSha256) {
		throw new Error("Body photo source manifest integrity failed");
	}
	const parsed = JSON.parse(data.toString("utf8")) as SourceManifest;
	if (
		parsed.schemaVersion !== 1 ||
		!/^[0-9a-f]{40}$/.test(parsed.upstreamCommit) ||
		!parsed.files ||
		!parsed.engineOverrides ||
		Array.isArray(parsed.files)
	) {
		throw new Error("Invalid body photo source manifest");
	}
	for (const [name, value] of Object.entries(parsed.files)) {
		assertSourcePath({ name });
		if (
			!name.startsWith("body/") &&
			name !== "README.md" &&
			name !== ".gitignore"
		)
			throw new Error("Invalid application source scope");
		if (name.startsWith("body/engine/"))
			throw new Error("Engine source must use shared closure");
		parseIdentity({ value });
	}
	return { manifest: parsed, data };
}

function engineFiles({
	sourceRoot,
	manifest,
}: {
	sourceRoot: string;
	manifest: SourceManifest;
}): Record<string, FileIdentity> {
	const name = "body/engine-source-manifest.json";
	const data = readSource({ root: sourceRoot, name });
	assertIdentity({ data, expected: manifest.files[name], name });
	const engine = JSON.parse(data.toString("utf8")) as {
		sourceCommit: string;
		sourcePrefix: string;
		sourceBytesModified: boolean;
		files: Record<string, FileIdentity>;
	};
	if (
		engine.sourceCommit !== "7bd5ceacc996b924c25563f430651dd1046d6ce0" ||
		engine.sourcePrefix !== "qcut/research/independent-beauty/research/" ||
		engine.sourceBytesModified !== false ||
		Object.keys(engine.files).length !== 107
	) {
		throw new Error("Pinned 107-file body photo engine required");
	}
	for (const [entry, value] of Object.entries(engine.files)) {
		assertSourcePath({ name: entry });
		if (!entry.startsWith("engine/research/"))
			throw new Error("Invalid engine source scope");
		parseIdentity({ value });
	}
	return engine.files;
}

function inventory({ root }: { root: string }): Set<string> {
	const files = new Set<string>();
	const visit = ({
		directory,
		prefix,
	}: {
		directory: string;
		prefix: string;
	}): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const name = `${prefix}${entry.name}`;
			const target = path.join(directory, entry.name);
			if (entry.isSymbolicLink())
				throw new Error(`Symlink in body photo sources: ${name}`);
			if (entry.isDirectory()) {
				assertSourcePath({ name: `${name}/directory.txt` });
				visit({ directory: target, prefix: `${name}/` });
				continue;
			}
			if (!entry.isFile())
				throw new Error(`Non-file in body photo sources: ${name}`);
			assertSourcePath({ name });
			files.add(name);
		}
	};
	assertDirectoryChain({ directory: root });
	visit({ directory: root, prefix: "" });
	return files;
}

function assertInventory({
	root,
	expected,
}: {
	root: string;
	expected: Set<string>;
}): void {
	const actual = inventory({ root });
	if (
		actual.size !== expected.size ||
		[...actual].some((name) => !expected.has(name))
	) {
		throw new Error("Unexpected or missing body photo source files");
	}
}

function verifyStage({
	root,
	manifestSha256,
}: {
	root: string;
	manifestSha256: string;
}): PreparedSources {
	const resolved = path.resolve(root);
	const { manifest } = loadManifest({ root: resolved, manifestSha256 });
	const ownership = readOwnership({ root: resolved });
	if (ownership !== manifestSha256)
		throw new Error("Body photo stage ownership mismatch");
	const entries = { ...manifest.files };
	for (const [name, pin] of Object.entries(
		engineFiles({ sourceRoot: resolved, manifest })
	)) {
		entries[`body/${name}`] = pin;
	}
	const expected = new Set([
		"source-manifest.json",
		OWNERSHIP_FILE,
		...Object.keys(entries),
	]);
	assertInventory({ root: resolved, expected });
	for (const [name, pin] of Object.entries(entries)) {
		assertIdentity({
			data: readSource({ root: resolved, name }),
			expected: pin,
			name,
		});
	}
	return {
		root: resolved,
		bodyRoot: path.join(resolved, "body"),
		manifestSha256,
		files: expected.size,
	};
}

function readOwnership({ root }: { root: string }): string {
	const data = readSource({ root, name: OWNERSHIP_FILE });
	const owner = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
	if (
		owner.schemaVersion !== 1 ||
		owner.owner !== OWNERSHIP_OWNER ||
		typeof owner.manifestSha256 !== "string" ||
		!SHA256.test(owner.manifestSha256) ||
		Object.keys(owner).length !== 3
	)
		throw new Error("Unowned body photo stage");
	return owner.manifestSha256;
}

export function verifyStagedBodyPhotoSources({
	root,
}: {
	root: string;
}): PreparedSources {
	return verifyStage({
		root,
		manifestSha256: BODY_PHOTO_SOURCE_MANIFEST_SHA256,
	});
}

export function verifyOwnedBodyPhotoBuildSources({
	root,
}: {
	root: string;
}): PreparedSources {
	return verifyStage({ root, manifestSha256: readOwnership({ root }) });
}

export function bodyPhotoPathsOverlap({
	left,
	right,
	pathApi = path,
}: {
	left: string;
	right: string;
	pathApi?: Pick<typeof path, "relative" | "isAbsolute" | "sep">;
}): boolean {
	return [pathApi.relative(left, right), pathApi.relative(right, left)].some(
		(relative) =>
			!pathApi.isAbsolute(relative) &&
			relative !== ".." &&
			!relative.startsWith(`..${pathApi.sep}`)
	);
}

export function stageBodyPhotoSources({
	sourceRoot,
	sharedEngineRoot,
	destinationRoot,
}: {
	sourceRoot: string;
	sharedEngineRoot: string;
	destinationRoot: string;
}): PreparedSources {
	const source = path.resolve(sourceRoot);
	const shared = path.resolve(sharedEngineRoot);
	const destination = path.resolve(destinationRoot);
	if (lstatIfPresent({ target: destination }))
		throw new Error("Body photo destination must be fresh");
	const overlaps = [source, shared].some((root) =>
		bodyPhotoPathsOverlap({ left: root, right: destination })
	);
	if (overlaps)
		throw new Error("Body photo staging destination overlaps source");
	assertDirectoryChain({ directory: path.dirname(destination) });
	const { manifest, data: manifestData } = loadManifest({ root: source });
	const payload = new Map<string, Buffer>([
		["source-manifest.json", manifestData],
		[
			OWNERSHIP_FILE,
			Buffer.from(
				JSON.stringify({
					schemaVersion: 1,
					owner: OWNERSHIP_OWNER,
					manifestSha256: BODY_PHOTO_SOURCE_MANIFEST_SHA256,
				}) + "\n"
			),
		],
	]);
	const inputFiles = new Set([
		"source-manifest.json",
		...Object.keys(manifest.files),
	]);
	for (const [name, pin] of Object.entries(manifest.files)) {
		const data = readSource({ root: source, name });
		assertIdentity({ data, expected: pin, name });
		payload.set(name, data);
	}
	const engine = engineFiles({ sourceRoot: source, manifest });
	for (const [name, pin] of Object.entries(engine)) {
		const relative = name.slice("engine/research/".length);
		const override = manifest.engineOverrides[relative];
		const root = override ? source : shared;
		const inputName = override ? override.sourcePath : relative;
		if (override) {
			if (inputName !== `engine-overrides/${relative}`)
				throw new Error("Invalid engine override path");
			parseIdentity({ value: override });
			if (override.sha256 !== pin.sha256 || override.bytes !== pin.bytes)
				throw new Error("Engine override differs from frozen engine");
			inputFiles.add(inputName);
		}
		const data = readSource({ root, name: inputName });
		assertIdentity({ data, expected: pin, name });
		payload.set(`body/${name}`, data);
	}
	if (Object.keys(manifest.engineOverrides).length !== 2)
		throw new Error("Two pinned engine overrides required");
	assertInventory({ root: source, expected: inputFiles });
	mkdirSync(path.dirname(destination), { recursive: true });
	const temporary = mkdtempSync(`${destination}.stage-`);
	try {
		for (const [name, data] of payload) {
			const target = path.join(temporary, ...name.split("/"));
			mkdirSync(path.dirname(target), { recursive: true });
			writeFileSync(target, data, { flag: "wx", mode: 0o644 });
		}
		verifyStagedBodyPhotoSources({ root: temporary });
		if (lstatIfPresent({ target: destination }))
			throw new Error("Body photo destination appeared during staging");
		renameSync(temporary, destination);
	} catch (error) {
		rmSync(temporary, { recursive: true, force: true });
		throw error;
	}
	return verifyStagedBodyPhotoSources({ root: destination });
}
