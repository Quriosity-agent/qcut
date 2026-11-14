const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
	createPortraitRuntimeFingerprinter,
	createPortraitRenderDiskCache,
	createPortraitSourceWindowRenderCache,
} = require("./runtime.cjs");

async function main() {
	assert.ok(process.versions.electron, "Must execute in real Electron");
	assert.equal(process.env.ELECTRON_RUN_AS_NODE, "1");
	const [mode, serialized] = process.argv.slice(2);
	const options = JSON.parse(serialized);
	const packed = path.join(__dirname, "assets/packed.txt");
	const virtualBefore = await fs.stat(packed, { bigint: true });
	const virtualAfter = await fs.stat(packed, { bigint: true });
	assert.notEqual(virtualBefore.ino, virtualAfter.ino);
	const fingerprinter = createPortraitRuntimeFingerprinter();
	const fingerprint = ({ paths = [__dirname], signal } = {}) =>
		fingerprinter.fingerprint({
			paths,
			configuration: { fixture: "source-window-asar" },
			signal,
		});

	if (mode === "missing") {
		await assert.rejects(
			fingerprint({ paths: [path.join(__dirname, options.relativePath)] }),
			{ code: "ENOENT" }
		);
		return { missingRejected: true };
	}
	if (mode === "ordinary-directory") {
		const first = await fingerprint({ paths: [options.directory] });
		assert.equal(await fingerprint({ paths: [options.directory] }), first);
		await fs.writeFile(path.join(options.directory, "model.txt"), "new-model");
		assert.notEqual(await fingerprint({ paths: [options.directory] }), first);
		return { ordinaryDirectoryMutationDetected: true };
	}
	if (mode === "linked-unpacked") {
		const paths = [path.join(__dirname, "assets")];
		const first = await fingerprint({ paths });
		await fs.writeFile(
			path.join(`${__dirname}.unpacked`, "shared/unpacked.txt"),
			"shared-v2"
		);
		assert.notEqual(await fingerprint({ paths }), first);
		return { linkedUnpackedMutationDetected: true };
	}
	if (mode === "archive-mutation") {
		const physicalFs = process.getBuiltinModule("original-fs");
		const createReadStream = physicalFs.createReadStream;
		const archivePath = physicalFs.realpathSync(__dirname);
		let mutated = false;
		physicalFs.createReadStream = (file, streamOptions) => {
			const stream = createReadStream(file, streamOptions);
			if (file === archivePath && !mutated) {
				stream.once("data", () => {
					physicalFs.appendFileSync(__dirname, "changed-during-read");
					mutated = true;
				});
			}
			return stream;
		};
		try {
			await assert.rejects(
				fingerprint(),
				/Native runtime changed while fingerprinting/
			);
			assert.equal(mutated, true);
			return { archiveMutationRejected: true };
		} finally {
			physicalFs.createReadStream = createReadStream;
		}
	}

	const firstIdentity = await fingerprint();
	assert.equal(await fingerprint(), firstIdentity);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(fingerprint({ signal: controller.signal }), {
		name: "AbortError",
	});
	const cache = createPortraitRenderDiskCache({
		directory: options.cacheDirectory,
		maxBytes: 1024 * 1024,
	});
	const executor = createPortraitSourceWindowRenderCache({
		cache,
		identity: {
			resolve: ({ signal } = {}) => fingerprint({ signal }),
			clear: () => fingerprinter.clear(),
		},
	});
	const request = {
		width: 1,
		height: 1,
		rgba: new Uint8Array([10, 20, 30, 255]),
		sourceKey: "source-window-v1:asar-regression",
		timestampSeconds: 0,
		freshTracking: true,
		adjustments: { enabled: true, values: { body_adjust_SlimBody: 40 } },
	};
	const output = new Uint8Array([40, 50, 60, 255]);
	let nativeCalls = 0;
	let cacheApplications = 0;
	const render = () =>
		executor.render({
			request,
			// Only native rendering is synthetic; identity, disk I/O and cache policy are real.
			renderFresh: async () => {
				nativeCalls++;
				return {
					provider: "jianying-local-swing-v1",
					width: 1,
					height: 1,
					rgba: output.slice(),
					activeGroups: ["body"],
					nativeRenderCount: 1,
				};
			},
			applyCachedResult: async ({ result, assertReplayIdentity }) => {
				assert.deepEqual(result.rgba, output);
				await assertReplayIdentity();
				cacheApplications++;
			},
		});
	try {
		const first = await render();
		const second = await render();
		assert.deepEqual(first.rgba, output);
		assert.deepEqual(second.rgba, output);
		assert.equal(second.sourceWindowCacheHit, true);
		assert.equal(second.nativeRenderCount, 0);
		const hits = [first.sourceWindowCacheHit, second.sourceWindowCacheHit];
		if (mode === "unpacked-mutation") {
			const backing = path.join(`${__dirname}.unpacked`, "assets/unpacked.txt");
			await fs.writeFile(backing, "unpacked-v2");
			assert.notEqual(await fingerprint(), firstIdentity);
			const changed = await render();
			const changedAgain = await render();
			hits.push(
				changed.sourceWindowCacheHit,
				changedAgain.sourceWindowCacheHit
			);
			assert.deepEqual(changed.rgba, output);
		}
		const files = (await fs.readdir(options.cacheDirectory)).sort();
		assert.ok(files.length > 0);
		assert.ok(files.every((file) => /^[a-f0-9]{64}\.frame$/.test(file)));
		return {
			electronVersion: process.versions.electron,
			virtualInodeChanged: true,
			identity: firstIdentity,
			hits,
			nativeCalls,
			cacheApplications,
			files,
		};
	} finally {
		await executor.close();
	}
}

main().then(
	(result) => process.stdout.write(`${JSON.stringify(result)}\n`),
	(error) => {
		console.error(error);
		process.exitCode = 1;
	}
);
