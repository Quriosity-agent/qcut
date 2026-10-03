import {
	BEAUTY_LAB_CANDIDATE_BACKEND,
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	BEAUTY_LAB_CANDIDATE_STAGES,
	type BeautyLabCandidateRequest,
	type BeautyLabCandidateResult,
	type BeautyLabCandidateStage,
	type BeautyLabCandidateStageId,
	type BeautyLabCandidateStatus,
} from "./beauty-lab-candidate-contract.js";
import {
	beautyLabCandidateIdentity,
	parseBeautyLabCandidateRequest,
} from "./beauty-lab-candidate-request.js";

export interface BeautyLabCandidateBackend {
	version: string;
	stages: BeautyLabCandidateStage[];
	render: (
		request: BeautyLabCandidateRequest & {
			inputSha256: string;
			requestFingerprint: string;
		}
	) => Promise<BeautyLabCandidateResult>;
}

function validateStages({ stages }: { stages: BeautyLabCandidateStage[] }) {
	if (
		!Array.isArray(stages) ||
		stages.length !== BEAUTY_LAB_CANDIDATE_STAGES.length ||
		new Set(stages.map((stage) => stage?.id)).size !== stages.length ||
		Array.from(stages).some(
			(stage) =>
				!stage ||
				!BEAUTY_LAB_CANDIDATE_STAGES.includes(stage.id) ||
				!["qcut", "native"].includes(stage.implementation) ||
				!["accepted", "unverified", "blocked"].includes(stage.parity) ||
				typeof stage.message !== "string" ||
				stage.message.length > 512
		)
	) {
		throw new Error("Invalid candidate pipeline stage descriptor");
	}
}

function validateResult({
	result,
	request,
	identity,
	nativeDependencies,
}: {
	result: BeautyLabCandidateResult;
	request: BeautyLabCandidateRequest;
	identity: ReturnType<typeof beautyLabCandidateIdentity>;
	nativeDependencies: BeautyLabCandidateStageId[];
}): BeautyLabCandidateResult {
	if (
		!result ||
		result.protocol !== BEAUTY_LAB_CANDIDATE_PROTOCOL ||
		result.source !== "live-candidate" ||
		result.backendId !== BEAUTY_LAB_CANDIDATE_BACKEND ||
		result.backendVersion !== request.backendVersion ||
		result.requestId !== request.requestId ||
		result.sourceKey !== request.sourceKey ||
		result.frameNumber !== request.frameNumber ||
		result.timestampSeconds !== request.timestampSeconds ||
		result.requestFingerprint !== identity.requestFingerprint ||
		result.inputSha256 !== identity.inputSha256
	) {
		throw new Error(
			"Candidate result does not belong to the current live request"
		);
	}
	if (
		result.width !== request.width ||
		result.height !== request.height ||
		!(result.rgba instanceof Uint8Array) ||
		result.rgba.byteLength !== request.width * request.height * 4 ||
		result.rgba.buffer instanceof SharedArrayBuffer
	) {
		throw new Error("Invalid candidate output RGBA dimensions or storage");
	}
	const dependencies = result.nativeDependencies;
	if (
		!Array.isArray(dependencies) ||
		dependencies.length !== nativeDependencies.length ||
		new Set(dependencies).size !== dependencies.length ||
		Array.from(dependencies).some(
			(stage) => !nativeDependencies.includes(stage)
		)
	) {
		throw new Error("Candidate native dependencies disagree with the pipeline");
	}
	const metrics = result.stageMetrics;
	if (
		!Array.isArray(metrics) ||
		metrics.length !== BEAUTY_LAB_CANDIDATE_STAGES.length ||
		new Set(metrics.map((metric) => metric?.id)).size !== metrics.length ||
		Array.from(metrics).some(
			(metric) =>
				!metric ||
				!BEAUTY_LAB_CANDIDATE_STAGES.includes(metric.id) ||
				typeof metric.durationMs !== "number" ||
				!Number.isFinite(metric.durationMs) ||
				metric.durationMs < 0
		)
	) {
		throw new Error("Invalid candidate stage metrics");
	}
	return {
		protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
		source: "live-candidate",
		backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
		backendVersion: request.backendVersion,
		requestId: request.requestId,
		...identity,
		sourceKey: request.sourceKey,
		frameNumber: request.frameNumber,
		timestampSeconds: request.timestampSeconds,
		width: request.width,
		height: request.height,
		rgba: new Uint8Array(result.rgba),
		nativeDependencies: [...nativeDependencies],
		stageMetrics: metrics.map(({ id, durationMs }) => ({ id, durationMs })),
	};
}

export function createBeautyLabCandidateProvider({
	backend,
}: {
	backend?: BeautyLabCandidateBackend;
} = {}) {
	if (
		backend &&
		(typeof backend.version !== "string" ||
			!/^[A-Za-z0-9._:-]{1,128}$/.test(backend.version))
	) {
		throw new Error("Invalid candidate backend version");
	}
	if (backend) validateStages({ stages: backend.stages });
	if (backend && typeof backend.render !== "function") {
		throw new Error("Invalid candidate backend renderer");
	}
	const version = backend?.version ?? null;
	const execute = backend?.render.bind(backend);
	const stages = structuredClone(backend?.stages ?? []);
	const nativeDependencies = stages
		.filter((stage) => stage.implementation === "native")
		.map((stage) => stage.id);
	let busy = false;

	function inspect(): BeautyLabCandidateStatus {
		const blockers = backend
			? stages
					.filter((stage) => stage.parity !== "accepted")
					.map((stage) => `${stage.id}:${stage.parity}`)
			: [
					"arbitrary-frame-backend-not-connected",
					"independent-160-sampling-unverified",
				];
		return {
			protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
			backendId: BEAUTY_LAB_CANDIDATE_BACKEND,
			backendVersion: version,
			state: backend
				? blockers.length
					? "blocked"
					: "ready"
				: "not-connected",
			available: Boolean(backend && blockers.length === 0),
			blockers,
			stages: structuredClone(stages),
		};
	}

	async function render({ request }: { request: unknown }) {
		if (busy) throw new Error("Candidate inference is already running");
		const status = inspect();
		if (!execute || !status.available) {
			throw new Error(
				`Candidate backend unavailable: ${status.blockers.join(", ")}`
			);
		}
		const parsed = parseBeautyLabCandidateRequest({ request });
		if (parsed.backendVersion !== status.backendVersion) {
			throw new Error("Candidate backend version changed; inspect again");
		}
		const identity = beautyLabCandidateIdentity({ request: parsed });
		busy = true;
		try {
			const result = await execute({
				...structuredClone(parsed),
				...identity,
			});
			return validateResult({
				result,
				request: parsed,
				identity,
				nativeDependencies,
			});
		} finally {
			busy = false;
		}
	}

	return { inspect, render };
}
