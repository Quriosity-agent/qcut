import { lstat } from "node:fs/promises";
import type {
	BeautyLabResearchCase,
	BeautyLabResearchFrame,
} from "./beauty-lab/beauty-lab-contract.js";
import {
	OWNED_CHAIN_CASE_ID,
	OWNED_CHAIN_ORIGINAL_FORMAT,
	OWNED_CHAIN_REPORT_FILES,
	ownedChainAuditSchema,
	ownedChainIndexSchema,
	ownedChainCandidateSchema,
	ownedChainCaptureSchema,
	ownedChainModelSchema,
	ownedChainOriginalAuditSchema,
	ownedChainOriginalCaptureSchema,
	ownedChainOriginalReportSchema,
	ownedChainPayloadSchema,
	ownedChainRenderSchema,
	ownedChainSummarySchema,
} from "./beauty-lab-owned-chain-evidence.js";
import { verifyOwnedChainReports } from "./beauty-lab-owned-chain-verify.js";
import { compareRgbaPixels } from "./beauty-lab-rgba-metrics.js";
import {
	MIB,
	WIDTH,
	HEIGHT,
	RGBA_BYTES,
	createSnapshot,
	readJson,
	decodeInput,
	pinRoot,
	requireEvidence,
} from "./beauty-lab-research-files.js";

const CASE: BeautyLabResearchCase = {
	id: OWNED_CHAIN_CASE_ID,
	name: "Owned Preprocess Research Replay",
	frameCount: 7,
};
const schemas = {
	capture: ownedChainCaptureSchema,
	candidate: ownedChainCandidateSchema,
	render: ownedChainRenderSchema,
	model: ownedChainModelSchema,
	summary: ownedChainSummarySchema,
	originalCapture: ownedChainOriginalCaptureSchema,
	originalReplay: ownedChainOriginalReportSchema,
	originalRender: ownedChainOriginalReportSchema,
	originalAudit: ownedChainOriginalAuditSchema,
};

export function createBeautyLabOwnedChainProvider({
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
		| Promise<{
				root: Awaited<ReturnType<typeof pinRoot>>;
				sources: Awaited<ReturnType<typeof pinRoot>>;
		  }>
		| undefined;
	const roots = () => {
		pinned ??= (async () => {
			requireEvidence({
				condition: Boolean(currentSourceRoot),
				message: "currentSourceRoot is required for owned-chain research",
			});
			if (!currentSourceRoot) throw new Error("Missing currentSourceRoot");
			requireEvidence({
				condition:
					!(await lstat(root)).isSymbolicLink() &&
					!(await lstat(currentSourceRoot)).isSymbolicLink(),
				message: "symlink owned-chain root",
			});
			return {
				root: await pinRoot({ root }),
				sources: await pinRoot({ root: currentSourceRoot }),
			};
		})();
		return pinned;
	};
	const inspect = async ({ selectedFrame }: { selectedFrame?: number }) => {
		const locations = await roots();
		const snapshot = createSnapshot();
		const index = (
			await readJson({
				snapshot,
				root: locations.root,
				relativePath: "index.json",
				maximum: MIB,
				schema: ownedChainIndexSchema,
			})
		).value;
		const readReport = <K extends keyof typeof schemas>({ key }: { key: K }) =>
			readJson({
				snapshot,
				root: locations.root,
				relativePath: OWNED_CHAIN_REPORT_FILES[key],
				maximum: 16 * MIB,
				schema: schemas[key],
				expected: index.reports[key],
			}).then((result) => result.value);
		const reports = {
			capture: await readReport({ key: "capture" }),
			candidate: await readReport({ key: "candidate" }),
			render: await readReport({ key: "render" }),
			model: await readReport({ key: "model" }),
			summary: await readReport({ key: "summary" }),
			originalCapture: await readReport({ key: "originalCapture" }),
			originalReplay: await readReport({ key: "originalReplay" }),
			originalRender: await readReport({ key: "originalRender" }),
			originalAudit: await readReport({ key: "originalAudit" }),
			...(index.format === OWNED_CHAIN_ORIGINAL_FORMAT
				? {
						chainAudit: (
							await readJson({
								snapshot,
								root: locations.root,
								relativePath: "reports/chain-audit.json",
								maximum: 16 * MIB,
								schema: ownedChainAuditSchema,
								expected: index.reports.chainAudit,
							})
						).value,
					}
				: {}),
		};
		const payload = (
			await readJson({
				snapshot,
				root: locations.root,
				relativePath: "replay.json",
				maximum: MIB,
				schema: ownedChainPayloadSchema,
				expected: index.replay_sha256,
			})
		).value;
		await snapshot.read({
			root: locations.root,
			relativePath: "manifest.json",
			maximum: MIB,
			expected: index.manifest_sha256,
		});
		const sources = verifyOwnedChainReports({ index, reports, payload });
		await Object.entries(sources).reduce(
			(previous, [relativePath, expected]) =>
				previous.then(() =>
					snapshot
						.read({
							root: locations.sources,
							relativePath,
							maximum: 2 * MIB,
							expected,
						})
						.then(() => undefined)
				),
			Promise.resolve()
		);
		let selected: BeautyLabResearchFrame | undefined;
		const frameSnapshots: ReturnType<typeof createSnapshot>[] = [];
		// Per-frame budgets keep the seven real RGBA triplets within the shared 64 MiB read bound.
		await index.frames.reduce(
			(previous, frame) =>
				previous.then(async () => {
					const frameSnapshot = createSnapshot();
					frameSnapshots.push(frameSnapshot);
					const suffix = String(frame.index).padStart(2, "0");
					const png = await frameSnapshot.read({
						root: locations.root,
						relativePath: `frames/input-${suffix}.png`,
						maximum: 16 * MIB,
						expected: frame.input_png_sha256,
					});
					const native = await frameSnapshot.read({
						root: locations.root,
						relativePath: `frames/native-${suffix}.rgba`,
						maximum: RGBA_BYTES,
						expected: frame.native_rgba_sha256,
					});
					const candidate = await frameSnapshot.read({
						root: locations.root,
						relativePath: `frames/candidate-${suffix}.rgba`,
						maximum: RGBA_BYTES,
						expected: frame.candidate_rgba_sha256,
					});
					requireEvidence({
						condition:
							native.length === RGBA_BYTES &&
							candidate.length === RGBA_BYTES &&
							native.equals(candidate),
						message: "owned-chain actual pixel parity differs",
					});
					const input = decodeInput({
						bytes: png,
						expected: frame.input_rgba_sha256,
					});
					const { changedPixels, maxDelta, bbox } = compareRgbaPixels({
						actual: native,
						expected: input,
						width: WIDTH,
						height: HEIGHT,
					});
					const comparison =
						reports.render.comparisons[frame.index].versus_input;
					requireEvidence({
						condition:
							changedPixels === comparison.changed_pixels &&
							maxDelta === comparison.max_delta &&
							JSON.stringify(bbox) === JSON.stringify(comparison.bbox),
						message: "owned-chain actual effect/control metrics differ",
					});
					if (frame.index !== selectedFrame) return;
					const intensity =
						reports.render.frames[frame.index].parameters.face_adjust_eye[0]
							.intensity;
					selected = {
						caseId: OWNED_CHAIN_CASE_ID,
						frameIndex: frame.index,
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
				}),
			Promise.resolve()
		);
		await frameSnapshots.reduce(
			(previous, frameSnapshot) => previous.then(() => frameSnapshot.verify()),
			Promise.resolve()
		);
		await snapshot.verify();
		return {
			selected,
			case: {
				...CASE,
				name:
					index.format === OWNED_CHAIN_ORIGINAL_FORMAT
						? "Original RGBA Owned Chain Research Replay"
						: CASE.name,
			},
		};
	};
	return {
		list: async () => {
			try {
				return [(await inspect({})).case];
			} catch {
				return [];
			}
		},
		load: async ({ caseId, frameIndex }) => {
			requireEvidence({
				condition: caseId === OWNED_CHAIN_CASE_ID,
				message: "unknown owned-chain case id",
			});
			requireEvidence({
				condition:
					typeof frameIndex === "number" &&
					Number.isInteger(frameIndex) &&
					frameIndex >= 0 &&
					frameIndex < 7,
				message: "invalid owned-chain frame index",
			});
			const { selected } = await inspect({ selectedFrame: frameIndex });
			if (!selected)
				throw new Error("Beauty Lab research: owned-chain frame missing");
			return selected;
		},
	};
}
