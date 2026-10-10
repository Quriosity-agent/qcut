import { z } from "zod";
import {
	createSnapshot,
	pinRoot,
	readJson,
} from "./beauty-lab-research-files.js";

export type BeautyLabLiveJobFailureKind =
	| "not-started"
	| "cancelled"
	| "timeout"
	| "output-budget"
	| "process-error"
	| "exit-code"
	| "exit-signal";

export interface BeautyLabLiveJobFailure {
	kind: BeautyLabLiveJobFailureKind;
	// SIGKILL replaced Python's identity-bound cleanup, so no receipt can vouch for it.
	forced: boolean;
}

// Errors keep their plain shape and message; only this registry classifies them.
const failures = new WeakMap<Error, BeautyLabLiveJobFailure>();

export function createBeautyLabLiveJobError({
	message,
	kind,
	forced,
}: {
	message: string;
} & BeautyLabLiveJobFailure): Error {
	const error = new Error(message);
	failures.set(error, { kind, forced });
	return error;
}

export function beautyLabLiveJobFailure({
	error,
}: {
	error: unknown;
}): BeautyLabLiveJobFailure | undefined {
	return error instanceof Error ? failures.get(error) : undefined;
}

const cleanFailureReceipt = z.object({
	passed: z.literal(false),
	native_launch_lease: z.string().min(1).max(256),
	dependencies_unchanged: z.literal(true),
	cleanup: z.object({
		completed: z.literal(true),
		failures: z.array(z.unknown()).max(0),
		roots: z
			.array(
				z.object({
					pid: z.number().int().positive(),
					reaped: z.literal(true),
				})
			)
			.max(1024),
	}),
});

/**
 * Whether a failed static audit may run again without restarting QCut.
 *
 * Only a job that never started, or one that reported its own failure or honoured
 * a user cancellation without SIGKILL, qualifies — and the latter two only when
 * this job's lease-bound report proves every native root was reaped and its
 * dependencies were unchanged. Every other outcome keeps the restart latch.
 */
export async function beautyLabLiveFailureAllowsRetry({
	error,
	directory,
	lease,
	verify,
}: {
	error: unknown;
	directory: string;
	lease: string;
	verify: () => Promise<void>;
}): Promise<boolean> {
	const failure = beautyLabLiveJobFailure({ error });
	if (!failure || failure.forced) return false;
	if (!["not-started", "cancelled", "exit-code"].includes(failure.kind))
		return false;
	try {
		if (failure.kind !== "not-started") {
			const { value } = await readJson({
				snapshot: createSnapshot(),
				root: await pinRoot({ root: directory }),
				relativePath: "audit/report.json",
				maximum: 8 * 1024 ** 2,
				schema: cleanFailureReceipt,
			});
			if (value.native_launch_lease !== lease) return false;
		}
		await verify();
		return true;
	} catch {
		return false;
	}
}
