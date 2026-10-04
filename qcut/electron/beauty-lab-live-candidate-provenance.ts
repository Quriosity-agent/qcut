import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
	checkPath,
	createSnapshot,
	type PinnedRoot,
} from "./beauty-lab-research-files.js";

const SOURCE_TREES = [
	"research/local-model-pytorch",
	"research/jianying-runtime-probe",
];
const MODEL_ROOT =
	".local/jianying-model-pytorch/face-heads-20261003-stable-r2";
const MODEL_FILES = [
	"summary.json",
	"align-120/artifacts/model.onnx",
	"align-160/artifacts/model.onnx",
];

async function sourceFiles({ source }: { source: PinnedRoot }) {
	const files: string[] = [];
	let entries = 0;
	const walk = async ({
		relativePath,
	}: {
		relativePath: string;
	}): Promise<void> => {
		const directory = await checkPath({ root: source, relativePath });
		const children = await readdir(directory, { withFileTypes: true });
		entries += children.length;
		if (entries > 2048) throw new Error("Live source inventory exceeds budget");
		await children.reduce(async (previous, child) => {
			await previous;
			const childPath = `${relativePath}/${child.name}`;
			if (child.isSymbolicLink())
				throw new Error("Live source symlink rejected");
			if (child.isDirectory()) return walk({ relativePath: childPath });
			if (
				[".py", ".mm", ".cpp", ".h"].includes(path.extname(child.name)) &&
				!child.name.endsWith("_test.py")
			) {
				if (!child.isFile())
					throw new Error("Live source must be a regular file");
				files.push(childPath);
			}
		}, Promise.resolve());
	};
	await SOURCE_TREES.reduce(async (previous, relativePath) => {
		await previous;
		const count = files.length;
		await walk({ relativePath });
		if (files.length === count) throw new Error("Live source tree is empty");
	}, Promise.resolve());
	return files.sort();
}

export async function captureBeautyLabLiveDependencies({
	source,
}: {
	source: PinnedRoot;
}) {
	const sources = await sourceFiles({ source });
	const snapshot = createSnapshot();
	const hash = createHash("sha256");
	await [
		...sources,
		...MODEL_FILES.map((file) => `${MODEL_ROOT}/${file}`),
	].reduce(async (previous, relativePath) => {
		await previous;
		const bytes = await snapshot.read({
			root: source,
			relativePath,
			maximum: 32 * 1024 ** 2,
		});
		hash
			.update(relativePath)
			.update("\0")
			.update(createHash("sha256").update(bytes).digest())
			.update("\0");
	}, Promise.resolve());
	return {
		digest: hash.digest("hex"),
		verify: async () => {
			if (
				JSON.stringify(await sourceFiles({ source })) !==
				JSON.stringify(sources)
			)
				throw new Error("Live source inventory changed; restart required");
			await snapshot.verify();
		},
	};
}
