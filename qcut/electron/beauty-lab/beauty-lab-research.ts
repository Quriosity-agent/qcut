import { lstat } from "node:fs/promises";
import type { z } from "zod";
import type {
	BeautyLabResearchCase,
	BeautyLabResearchFrame,
} from "./beauty-lab-contract.js";
import {
	FRAME_COUNT,
	auditSchema,
	campaignSchema,
	payloadSchema,
	probeSchema,
	renderSchema,
	replaySchema,
	sha,
} from "./beauty-lab-research-evidence.js";
import {
	HEIGHT,
	MIB,
	RGBA_BYTES,
	WIDTH,
	checkPath,
	createSnapshot,
	decodeInput,
	pinRoot,
	readJson,
	requireEvidence,
	safeRelativePath,
	type PinnedRoot,
	type Snapshot,
} from "./beauty-lab-research-files.js";

const CASES = [
	{
		id: "temporal",
		name: "Temporal Research Replay",
		directory: "campaign-00",
		index: 0,
	},
	{
		id: "qcut-export",
		name: "QCut Export Research Replay",
		directory: "campaign-01",
		index: 1,
	},
] as const;

async function inspectCase({
	snapshot,
	root,
	sourceRoot,
	selected,
}: {
	snapshot: Snapshot;
	root: PinnedRoot;
	sourceRoot?: PinnedRoot;
	selected: (typeof CASES)[number];
}) {
	const campaign = (
		await readJson({
			snapshot,
			root,
			relativePath: "report.json",
			maximum: MIB,
			schema: campaignSchema,
		})
	).value;
	const entries = campaign.campaigns.filter(
		(entry) => entry.index === selected.index
	);
	requireEvidence({
		condition: entries.length === 1,
		message: "missing or duplicate campaign",
	});
	const entry = entries[0];
	const stageHashes = new Map(
		entry.stages.map((stage) => [stage.name, stage.report_sha256])
	);
	requireEvidence({
		condition: stageHashes.size === 4,
		message: "duplicate or missing campaign stage",
	});
	const readReport = <S extends z.ZodTypeAny>({
		stage,
		schema,
		maximum,
	}: {
		stage: "probe" | "replay" | "render" | "audit";
		schema: S;
		maximum: number;
	}) =>
		readJson({
			snapshot,
			root,
			relativePath: `${selected.directory}/${stage}/report.json`,
			maximum,
			schema,
			expected: stageHashes.get(stage),
		});
	const probe = await readReport({
		stage: "probe",
		schema: probeSchema,
		maximum: 16 * MIB,
	});
	const replay = await readReport({
		stage: "replay",
		schema: replaySchema,
		maximum: 8 * MIB,
	});
	const render = await readReport({
		stage: "render",
		schema: renderSchema,
		maximum: MIB,
	});
	const audit = await readReport({
		stage: "audit",
		schema: auditSchema,
		maximum: MIB,
	});
	const links = audit.value.report_sha256;
	requireEvidence({
		condition:
			links.capture === probe.hash &&
			links.sequence_replay === replay.hash &&
			links.sequence_render === render.hash &&
			replay.value.capture_sha256 === probe.hash &&
			render.value.capture_sha256 === probe.hash &&
			render.value.replay_sha256 === replay.value.replay_sha256 &&
			render.value.manifest_sha256 === entry.manifest_sha256 &&
			JSON.stringify(probe.value.frames) ===
				JSON.stringify(render.value.frames),
		message: "report SHA or frame links differ",
	});
	const sources = new Map<string, string>();
	for (const report of [probe.value, replay.value, render.value]) {
		for (const [relativePath, hash] of Object.entries(report.source_sha256)) {
			safeRelativePath({ relativePath });
			requireEvidence({
				condition:
					!sources.has(relativePath) || sources.get(relativePath) === hash,
				message: "conflicting source hashes",
			});
			sources.set(relativePath, hash);
		}
	}
	requireEvidence({
		condition: sources.size === audit.value.source_count,
		message: "source count differs",
	});
	if (!sourceRoot)
		throw new Error(
			"Beauty Lab research: currentSourceRoot is required to verify current research files"
		);
	await [...sources].reduce(
		(previous, [relativePath, expected]) =>
			previous.then(async () => {
				await snapshot.read({
					root: sourceRoot,
					relativePath,
					maximum: 2 * MIB,
					expected,
				});
			}),
		Promise.resolve()
	);
	const payload = await readJson({
		snapshot,
		root,
		relativePath: `${selected.directory}/replay/replay.json`,
		maximum: MIB,
		schema: payloadSchema,
		expected: replay.value.replay_sha256,
	});
	requireEvidence({
		condition: payload.value.image_sha256 === entry.manifest_sha256,
		message: "replay manifest link differs",
	});
	// Absolute evidence labels identify hashes only; they never authorize filesystem reads.
	const binaryHash =
		render.value.fixture_sha256[`${render.value.out}/replay.bin`];
	requireEvidence({
		condition: sha.safeParse(binaryHash).success,
		message: "missing replay binary SHA",
	});
	await snapshot.read({
		root,
		relativePath: `${selected.directory}/render/replay.bin`,
		maximum: MIB,
		expected: binaryHash,
	});
	return { probe: probe.value, render: render.value };
}

export function createBeautyLabResearchProvider({
	root,
	currentSourceRoot,
}: {
	root: string;
	currentSourceRoot?: string;
}): {
	list: () => Promise<BeautyLabResearchCase[]>;
	load: ({
		caseId,
		frameIndex,
	}: {
		caseId: string;
		frameIndex: number;
	}) => Promise<BeautyLabResearchFrame>;
} {
	let pinned:
		| Promise<{ root: PinnedRoot; sourceRoot?: PinnedRoot }>
		| undefined;
	const roots = () => {
		pinned ??= Promise.all([
			pinRoot({ root }),
			currentSourceRoot
				? pinRoot({ root: currentSourceRoot })
				: Promise.resolve(undefined),
		]).then(([root, sourceRoot]) => ({ root, sourceRoot }));
		return pinned;
	};
	return {
		list: async () => {
			const available = await Promise.all(
				CASES.map(async (selected): Promise<BeautyLabResearchCase[]> => {
					try {
						const snapshot = createSnapshot();
						const locations = await roots();
						await inspectCase({ snapshot, ...locations, selected });
						await Promise.all(
							Array.from({ length: FRAME_COUNT }, (_, index) => {
								const suffix = String(index).padStart(2, "0");
								return Promise.all(
									[
										`probe/input-${suffix}.png`,
										`probe/baseline/frame-${suffix}.rgba`,
										`render/frame-${suffix}.rgba`,
									].map(async (relative) => {
										const relativePath = `${selected.directory}/${relative}`;
										const filename = await checkPath({
											root: locations.root,
											relativePath,
										});
										const stat = await lstat(filename);
										requireEvidence({
											condition:
												stat.isFile() &&
												(relative.endsWith(".rgba")
													? stat.size === RGBA_BYTES
													: stat.size > 0 && stat.size <= 16 * MIB),
											message: "frame unavailable",
										});
									})
								);
							})
						);
						await snapshot.verify();
						return [
							{ id: selected.id, name: selected.name, frameCount: FRAME_COUNT },
						];
					} catch {
						return [];
					}
				})
			);
			return available.flat();
		},
		load: async ({ caseId, frameIndex }) => {
			const selected = CASES.find((entry) => entry.id === caseId);
			requireEvidence({
				condition: Boolean(selected),
				message: "unknown case id",
			});
			if (!selected) throw new Error("Beauty Lab research: unknown case id");
			requireEvidence({
				condition:
					typeof frameIndex === "number" &&
					Number.isInteger(frameIndex) &&
					frameIndex >= 0 &&
					frameIndex < FRAME_COUNT,
				message: "invalid frame index",
			});
			const snapshot = createSnapshot();
			const locations = await roots();
			const reports = await inspectCase({ snapshot, ...locations, selected });
			const frame = reports.probe.frames[frameIndex];
			const comparison = reports.render.comparisons[frameIndex];
			requireEvidence({
				condition:
					reports.probe.comparisons[frameIndex].baseline_sha256 ===
						comparison.baseline_sha256 &&
					reports.probe.comparisons[frameIndex].sha256 ===
						comparison.baseline_sha256 &&
					comparison.sha256 === comparison.baseline_sha256,
				message: "baseline/candidate frame hashes differ",
			});
			const suffix = String(frameIndex).padStart(2, "0");
			const readFrame = ({
				relative,
				maximum,
				expected,
			}: {
				relative: string;
				maximum: number;
				expected?: string;
			}) =>
				snapshot.read({
					root: locations.root,
					relativePath: `${selected.directory}/${relative}`,
					maximum,
					expected,
				});
			const png = await readFrame({
				relative: `probe/input-${suffix}.png`,
				maximum: 16 * MIB,
			});
			const native = await readFrame({
				relative: `probe/baseline/frame-${suffix}.rgba`,
				maximum: RGBA_BYTES,
				expected: comparison.baseline_sha256,
			});
			const candidate = await readFrame({
				relative: `render/frame-${suffix}.rgba`,
				maximum: RGBA_BYTES,
				expected: comparison.sha256,
			});
			requireEvidence({
				condition:
					native.length === RGBA_BYTES &&
					candidate.length === RGBA_BYTES &&
					native.equals(candidate),
				message: "RGBA byte count or pixel parity differs",
			});
			const input = decodeInput({
				bytes: png,
				expected: frame.input_rgba_sha256,
			});
			const intensity = frame.parameters.face_adjust_eye[0].intensity;
			await snapshot.verify();
			return {
				caseId,
				frameIndex,
				width: WIDTH,
				height: HEIGHT,
				input,
				native: Uint8Array.from(native),
				candidate: Uint8Array.from(candidate),
				adjustments: {
					enabled: intensity !== 0,
					values: { face_adjust_eye: intensity * 100 },
				},
				source: "verified-offline-replay",
				sourceHashesVerified: true,
				nativeDependencies: true,
			};
		},
	};
}
