import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
	checkPath,
	pinRoot,
	type PinnedRoot,
	requireEvidence,
} from "../beauty-lab-research-files.js";

const MIB = 1024 ** 2;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative();
const fingerprintSchema = z.object({
	sha256: sha,
	identity: z.tuple([
		z.string(),
		integer,
		integer,
		integer.max(256 * MIB),
		integer,
	]),
});
export const liveDependenciesSchema = z
	.object({
		files: z.record(sha),
		libraries: z.record(fingerprintSchema),
		trees: z
			.array(
				z.object({
					directory: z.string(),
					source: z.boolean(),
					files: z.record(fingerprintSchema),
				})
			)
			.min(5)
			.max(6),
	})
	.passthrough();

type FileDigest = { sha256: string; size: number };
export interface LiveExpectedDependencies {
	trees: {
		directory: string;
		source: boolean;
		files: Record<string, FileDigest>;
	}[];
	libraries: Record<string, FileDigest>;
}
const LIBRARIES = [
	"libcccreator.dylib",
	"libAGFX.dylib",
	"liblens.dylib",
	"libbytenn.dylib",
];
const SOURCE_TREES = [
	"research/local-model-pytorch",
	"research/jianying-runtime-probe",
];

function unchanged({ before, after }: { before: Stats; after: Stats }) {
	return (
		after.isFile() &&
		before.dev === after.dev &&
		before.ino === after.ino &&
		before.size === after.size &&
		before.mtimeMs === after.mtimeMs &&
		before.ctimeMs === after.ctimeMs
	);
}

async function fingerprint({
	root,
	relativePath,
}: {
	root: PinnedRoot;
	relativePath: string;
}): Promise<FileDigest> {
	const filename = await checkPath({ root, relativePath });
	const before = await lstat(filename);
	requireEvidence({
		condition: before.isFile() && before.size <= 256 * MIB,
		message: "bounded regular dependency file required",
	});
	const handle = await open(
		filename,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
	);
	try {
		requireEvidence({
			condition: unchanged({ before, after: await handle.stat() }),
			message: "dependency changed before hashing",
		});
		const hash = createHash("sha256");
		const buffer = Buffer.alloc(MIB);
		let total = 0;
		const consume = async (): Promise<void> => {
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
			if (!bytesRead) return;
			total += bytesRead;
			requireEvidence({
				condition: total <= before.size,
				message: "dependency grew during hashing",
			});
			hash.update(buffer.subarray(0, bytesRead));
			return consume();
		};
		await consume();
		await checkPath({ root, relativePath });
		requireEvidence({
			condition:
				total === before.size &&
				unchanged({ before, after: await handle.stat() }) &&
				unchanged({ before, after: await lstat(filename) }),
			message: "dependency changed during hashing",
		});
		return { sha256: hash.digest("hex"), size: total };
	} finally {
		await handle.close();
	}
}

async function captureTree({
	root,
	source,
}: {
	root: PinnedRoot;
	source: boolean;
}) {
	const files: Record<string, FileDigest> = {};
	let entries = 0;
	let total = 0;
	const walk = async ({ directory }: { directory: string }): Promise<void> => {
		const children = await readdir(directory, { withFileTypes: true });
		entries += children.length;
		requireEvidence({
			condition: entries <= 2048,
			message: "dependency tree inventory exceeds budget",
		});
		await children.reduce(async (previous, child) => {
			await previous;
			requireEvidence({
				condition: !child.isSymbolicLink(),
				message: "dependency tree symlink rejected",
			});
			const filename = path.join(directory, child.name);
			const relativePath = path
				.relative(root.canonical, filename)
				.split(path.sep)
				.join("/");
			if (child.isDirectory())
				return walk({ directory: await checkPath({ root, relativePath }) });
			if (
				source &&
				(![".py", ".mm", ".cpp", ".h"].includes(path.extname(child.name)) ||
					child.name.endsWith("_test.py"))
			)
				return;
			const file = await fingerprint({ root, relativePath });
			total += file.size;
			requireEvidence({
				condition: total <= 384 * MIB,
				message: "dependency tree bytes exceed budget",
			});
			files[filename] = file;
		}, Promise.resolve());
	};
	await walk({ directory: root.canonical });
	requireEvidence({
		condition: Object.keys(files).length > 0,
		message: "empty dependency tree rejected",
	});
	return { directory: root.canonical, source, files };
}

export async function captureBeautyLabLiveRequestDependencies({
	source,
	backendFiles,
	runtime,
	models,
	packagePath,
	additionalPackagePath,
}: {
	source: PinnedRoot;
	backendFiles: Readonly<Record<string, string>>;
	runtime: string;
	models: string;
	packagePath: string;
	additionalPackagePath?: string;
}) {
	const roots = [
		...SOURCE_TREES.map((relativePath) => ({
			directory: path.join(source.canonical, relativePath),
			source: true,
		})),
		{ directory: path.join(runtime, "Models"), source: false },
		{ directory: models, source: false },
		{ directory: packagePath, source: false },
		...(additionalPackagePath
			? [{ directory: additionalPackagePath, source: false }]
			: []),
	];
	const capture = async (): Promise<LiveExpectedDependencies> => {
		const trees: LiveExpectedDependencies["trees"] = [];
		await roots.reduce(async (previous, row) => {
			await previous;
			const root = await pinRoot({ root: row.directory });
			requireEvidence({
				condition: root.canonical === row.directory,
				message: "dependency root alias rejected",
			});
			trees.push(await captureTree({ root, source: row.source }));
		}, Promise.resolve());
		const runtimeRoot = await pinRoot({ root: runtime });
		const libraries: LiveExpectedDependencies["libraries"] = {};
		await LIBRARIES.reduce(async (previous, name) => {
			await previous;
			const relativePath = `Frameworks/${name}`;
			libraries[path.join(runtime, relativePath)] = await fingerprint({
				root: runtimeRoot,
				relativePath,
			});
		}, Promise.resolve());
		return { trees, libraries };
	};
	const expected = await capture();
	const files = Object.assign(
		{},
		...expected.trees.map((tree) => tree.files)
	) as Record<string, FileDigest>;
	requireEvidence({
		condition: Object.entries(backendFiles).every(
			([filename, hash]) => files[filename]?.sha256 === hash
		),
		message:
			"request dependency snapshot differs from frozen backend source/models",
	});
	return {
		expected: structuredClone(expected),
		verify: async () =>
			requireEvidence({
				condition: isDeepStrictEqual(await capture(), expected),
				message: "request dependency inventory changed during audit",
			}),
	};
}

export function verifyBeautyLabLiveDependencyInventory({
	dependencies,
	expected,
}: {
	dependencies: z.infer<typeof liveDependenciesSchema>;
	expected: LiveExpectedDependencies;
}) {
	const normalizeFiles = ({
		files,
	}: {
		files: Record<string, z.infer<typeof fingerprintSchema>>;
	}) =>
		Object.fromEntries(
			Object.entries(files).map(([filename, file]) => {
				requireEvidence({
					condition: file.identity[0] === filename,
					message: "dependency fingerprint path differs",
				});
				return [filename, { sha256: file.sha256, size: file.identity[3] }];
			})
		);
	const actual = dependencies.trees.map((tree) => ({
		...tree,
		files: normalizeFiles({ files: tree.files }),
	}));
	const byDirectory = (
		left: { directory: string },
		right: { directory: string }
	) => left.directory.localeCompare(right.directory);
	requireEvidence({
		condition:
			isDeepStrictEqual(
				actual.sort(byDirectory),
				[...expected.trees].sort(byDirectory)
			) &&
			isDeepStrictEqual(
				normalizeFiles({ files: dependencies.libraries }),
				expected.libraries
			),
		message:
			"audit source/model/runtime/package inventory differs from request snapshot",
	});
}
