import { createHash } from "node:crypto";
import {
	BEAUTY_LAB_CANDIDATE_PROTOCOL,
	type BeautyLabCandidateRequest,
} from "./beauty-lab/beauty-lab-candidate-contract.js";
import { parseJianyingPortraitRenderRequest } from "./jianying-portrait-adjustment-runtime/request.js";

export function parseBeautyLabCandidateRequest({
	request,
}: {
	request: unknown;
}): BeautyLabCandidateRequest {
	if (!request || typeof request !== "object" || Array.isArray(request)) {
		throw new Error("Invalid Beauty Lab candidate request");
	}
	const record = request as Record<string, unknown>;
	if (
		record.protocol !== BEAUTY_LAB_CANDIDATE_PROTOCOL ||
		typeof record.requestId !== "string" ||
		!/^[A-Za-z0-9._:-]{1,128}$/.test(record.requestId) ||
		typeof record.backendVersion !== "string" ||
		!/^[A-Za-z0-9._:-]{1,128}$/.test(record.backendVersion)
	) {
		throw new Error(
			"Invalid candidate protocol, request ID or backend version"
		);
	}
	const parsed = parseJianyingPortraitRenderRequest({ request });
	if (parsed.rgba.buffer instanceof SharedArrayBuffer) {
		throw new Error("Candidate input must not use shared mutable storage");
	}
	if (
		parsed.sourceKey === undefined ||
		parsed.frameNumber === undefined ||
		parsed.timestampSeconds === undefined
	) {
		throw new Error(
			"Candidate source identity, frame and timestamp are required"
		);
	}
	// The native parser exposes a view; pending inference must own its input bytes.
	return {
		...parsed,
		rgba: new Uint8Array(parsed.rgba),
		protocol: BEAUTY_LAB_CANDIDATE_PROTOCOL,
		requestId: record.requestId,
		backendVersion: record.backendVersion,
		sourceKey: parsed.sourceKey,
		frameNumber: parsed.frameNumber,
		timestampSeconds: parsed.timestampSeconds,
	};
}

function canonicalJSON({ value }: { value: unknown }): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJSON({ value: item })).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
			.map(
				([key, item]) =>
					`${JSON.stringify(key)}:${canonicalJSON({ value: item })}`
			)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function beautyLabCandidateIdentity({
	request,
}: {
	request: BeautyLabCandidateRequest;
}) {
	const inputSha256 = createHash("sha256").update(request.rgba).digest("hex");
	const { rgba: _rgba, ...snapshot } = request;
	const requestFingerprint = createHash("sha256")
		.update(canonicalJSON({ value: { ...snapshot, inputSha256 } }))
		.digest("hex");
	return { inputSha256, requestFingerprint };
}
