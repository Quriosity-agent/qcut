/**
 * The timeline transaction around `editor timeline apply`: how long it may
 * stay open, and what really became of the timeline when the apply failed.
 *
 * @module electron/native-pipeline/editor/editor-timeline-apply-transaction
 */
import { createHash } from "node:crypto";
import type { EditorApiClient } from "./editor-api-client.js";
import {
	collectElements,
	type TimelineManifest,
	type TimelineSnapshot,
} from "./editor-timeline-manifest.js";

/** QCut ends a transaction nobody extended after this long (its own cap). */
export const MAX_TRANSACTION_TIMEOUT_MS = 5 * 60_000;
const BASE_TIMEOUT_MS = 60_000;
const PER_ELEMENT_MS = 1_000;
const PER_TRACK_MS = 1_000;
const PER_MEGABYTE_MS = 2_000;

/**
 * How long the apply's transaction may stay open. QCut's default is 30 s,
 * which a programme-length manifest outlives: the editor then rolled the
 * timeline back under the apply and the next request found its track gone.
 * The allowance grows with what the manifest asks for, up to QCut's cap.
 */
export function applyTransactionTimeoutMs({
	manifest,
}: {
	manifest: TimelineManifest;
}): number {
	const elements =
		collectElements(manifest).length + (manifest.updates?.length ?? 0);
	const tracks = manifest.tracks?.length ?? 0;
	const megabytes = JSON.stringify(manifest).length / (1024 * 1024);
	const allowance =
		BASE_TIMEOUT_MS +
		PER_ELEMENT_MS * elements +
		PER_TRACK_MS * tracks +
		PER_MEGABYTE_MS * megabytes;
	return Math.min(MAX_TRANSACTION_TIMEOUT_MS, Math.round(allowance));
}

/**
 * A digest of everything the timeline holds: every track with its settings,
 * clips and transitions, in order. Two reads with the same fingerprint are
 * the same timeline. Ids alone would not do: an apply that only patches
 * clips leaves every id where it was.
 *
 * `hasAlpha` is left out: it is read from the media file on each request and
 * is not part of what a transaction restores.
 */
export function timelineFingerprint({
	timeline,
}: {
	timeline: TimelineSnapshot;
}): string {
	const contents = JSON.stringify(timeline.tracks, (key, value) =>
		key === "hasAlpha" ? undefined : value
	);
	return createHash("sha256").update(contents).digest("hex");
}

export interface ApplyRollbackOutcome {
	/** The timeline is as it was before the apply. */
	rolledBack: boolean;
	/** How that is known, or why it is not. */
	rollback: {
		/** `requested`: this command rolled it back. `timeout`: QCut did, when the transaction expired. */
		by: "requested" | "timeout" | "none";
		transactionState?: string;
		/** The timeline read after the failure matched the one read before the apply. */
		timelineMatchesBefore?: boolean;
		detail?: string;
	};
}

interface TransactionStatus {
	state?: string;
	error?: string;
	createdAt?: number;
	expiresAt?: number;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Ends the apply's transaction after a failure and reports what the
 * timeline is now. A rollback QCut accepts settles it. When QCut refuses
 * (the transaction already ended, usually by its timeout), the timeline is
 * read back and compared with the one read before the apply, so
 * `rolledBack` says what is there instead of whether one request worked.
 */
export async function rollbackFailedApply({
	client,
	projectId,
	transactionId,
	reason,
	fingerprintBefore,
}: {
	client: EditorApiClient;
	projectId: string;
	transactionId: string;
	reason: string;
	fingerprintBefore?: string;
}): Promise<ApplyRollbackOutcome> {
	const transactionPath = `/api/claude/transaction/${encodeURIComponent(transactionId)}`;
	// Why this command's own rollback did not restore the timeline, if so.
	let notRestored: string;
	try {
		const answer = await client.post<{ orphaned?: boolean } | undefined>(
			`${transactionPath}/rollback`,
			{ reason }
		);
		if (answer?.orphaned !== true) {
			return {
				rolledBack: true,
				rollback: { by: "requested", transactionState: "rolledBack" },
			};
		}
		// An orphaned transaction is dropped where it stands, nothing restored.
		notRestored =
			"QCut no longer tracked the transaction and ended it without restoring the timeline";
	} catch (rollbackError) {
		notRestored = `QCut refused the rollback: ${messageOf(rollbackError)}`;
	}

	let status: TransactionStatus | undefined;
	try {
		status = await client.get<TransactionStatus>(transactionPath);
	} catch {
		// The comparison below still says what the timeline is.
	}
	const transactionState = status?.state;
	if (transactionState === "active") {
		return {
			rolledBack: false,
			rollback: {
				by: "none",
				transactionState,
				detail: `${notRestored}. End it with \`qcut editor transaction rollback --transaction-id ${transactionId}\`.`,
			},
		};
	}
	const by = transactionState === "timedOut" ? "timeout" : "none";
	const detail = status?.error ?? notRestored;
	if (fingerprintBefore === undefined) {
		// The apply failed before it read or changed the timeline.
		return {
			rolledBack: transactionState === "timedOut",
			rollback: { by, transactionState, detail },
		};
	}
	try {
		// The editor answers in order, so this read comes after a rollback
		// it was still working on when the transaction was marked ended.
		const timeline = await client.get<TimelineSnapshot>(
			`/api/claude/timeline/${encodeURIComponent(projectId)}`
		);
		const timelineMatchesBefore =
			timelineFingerprint({ timeline }) === fingerprintBefore;
		return {
			rolledBack: timelineMatchesBefore,
			rollback: {
				by: timelineMatchesBefore ? by : "none",
				transactionState,
				timelineMatchesBefore,
				detail,
			},
		};
	} catch (readError) {
		return {
			rolledBack: false,
			rollback: {
				by: "none",
				transactionState,
				detail: `The timeline could not be read back to confirm: ${messageOf(readError)}`,
			},
		};
	}
}

/**
 * The apply's own error, with the cause in front when QCut ended the
 * transaction first: what failed after that ("Track not found: …") is only
 * the first request to meet the rolled-back timeline.
 */
export function describeApplyFailure({
	message,
	outcome,
	timeoutMs,
}: {
	message: string;
	outcome: ApplyRollbackOutcome | undefined;
	timeoutMs: number;
}): string {
	if (outcome?.rollback.transactionState !== "timedOut") return message;
	const seconds = Math.round(timeoutMs / 1000);
	const state = outcome.rolledBack
		? "QCut rolled the timeline back to what it was before the apply"
		: "QCut ended the transaction, but the timeline could not be confirmed as rolled back; read it before applying again";
	return `The apply ran past its ${seconds} s timeline transaction (the manifest is too large or the editor too busy to finish in that time). ${state}. The request that failed after that: ${message}`;
}
