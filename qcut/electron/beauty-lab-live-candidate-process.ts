import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import {
	createBeautyLabLiveJobError,
	type BeautyLabLiveJobFailureKind,
} from "./beauty-lab/beauty-lab-live-candidate-failure.js";

const OUTPUT_LIMIT = 1024 * 1024;
const JOB_TIMEOUT_MS = 300_000;
const CLEANUP_GRACE_MS = 30_000;
const ERROR_PREFIX = Buffer.from("QCUT_LIVE_CANDIDATE_ERROR=");
const ERROR_MESSAGE_LIMIT = 2000;
// Python's ASCII JSON encoding can use 12 bytes per non-BMP character.
const ERROR_LINE_LIMIT = 32 * 1024;

function parseErrorDetail({ line }: { line: Buffer }): string | undefined {
	try {
		const payload: unknown = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				line.subarray(ERROR_PREFIX.length)
			)
		);
		if (
			typeof payload !== "object" ||
			payload === null ||
			Array.isArray(payload) ||
			!("message" in payload) ||
			typeof payload.message !== "string"
		)
			return;
		return (
			stripVTControlCharacters(payload.message)
				.replace(/[\p{Cc}\p{Cf}]/gu, " ")
				.replace(/\s+/gu, " ")
				.trim()
				.slice(0, ERROR_MESSAGE_LIMIT)
				.replace(/[\uD800-\uDBFF]$/u, "") || undefined
		);
	} catch {
		return;
	}
}

function createErrorDetailReader() {
	const line = Buffer.alloc(ERROR_LINE_LIMIT);
	let length = 0;
	let discarding = false;
	let detail: string | undefined;
	const finishLine = () => {
		if (!discarding && length >= ERROR_PREFIX.length && !detail)
			detail = parseErrorDetail({ line: line.subarray(0, length) });
		length = 0;
		discarding = false;
	};
	return {
		consume({ data }: { data: Buffer }) {
			if (detail) return;
			for (const byte of data) {
				if (byte === 0x0a) {
					finishLine();
					if (detail) return;
					continue;
				}
				if (discarding) continue;
				const mismatchedPrefix =
					length < ERROR_PREFIX.length && byte !== ERROR_PREFIX[length];
				if (length === ERROR_LINE_LIMIT || mismatchedPrefix) {
					discarding = true;
					length = 0;
					continue;
				}
				// Decode only complete bounded lines, preserving UTF-8 across chunks.
				line[length] = byte;
				length += 1;
			}
		},
		finish() {
			finishLine();
			return detail;
		},
	};
}

export async function runBeautyLabLiveCandidateJob({
	python,
	args,
	cwd,
	signal,
}: {
	python: string;
	args: string[];
	cwd: string;
	signal?: AbortSignal;
}): Promise<void> {
	if (signal?.aborted)
		throw createBeautyLabLiveJobError({
			message: "Live candidate job cancelled",
			kind: "not-started",
			forced: false,
		});
	const env: NodeJS.ProcessEnv = { PYTHONDONTWRITEBYTECODE: "1" };
	for (const key of [
		"HOME",
		"PATH",
		"TMPDIR",
		"USER",
		"LOGNAME",
		"LANG",
		"LC_ALL",
		"LC_CTYPE",
		"QCUT_BEAUTY_LAB_SIGNING_IDENTITY",
	]) {
		if (process.env[key] !== undefined) env[key] = process.env[key];
	}
	await new Promise<void>((resolve, reject) => {
		const child = spawn(python, args, {
			cwd,
			env,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let failure:
			| { message: string; kind: BeautyLabLiveJobFailureKind }
			| undefined;
		let forced = false;
		let received = 0;
		const errorDetailReader = createErrorDetailReader();
		let grace: ReturnType<typeof setTimeout> | undefined;
		const stop = ({
			message,
			kind,
		}: {
			message: string;
			kind: BeautyLabLiveJobFailureKind;
		}) => {
			if (failure) return;
			failure = { message, kind };
			// Python's SIGTERM handler runs its identity-bound native ProcessScope cleanup.
			child.kill("SIGTERM");
			grace = setTimeout(() => {
				failure = {
					message: `${message}; Python cleanup deadline exceeded`,
					kind,
				};
				forced = true;
				child.kill("SIGKILL");
			}, CLEANUP_GRACE_MS);
		};
		const timer = setTimeout(
			() => stop({ message: "Live candidate job timed out", kind: "timeout" }),
			JOB_TIMEOUT_MS
		);
		const cancel = () =>
			stop({ message: "Live candidate job cancelled", kind: "cancelled" });
		const consume = ({ data }: { data: Buffer }) => {
			received += data.byteLength;
			if (received > OUTPUT_LIMIT)
				stop({
					message: "Live candidate process output exceeded budget",
					kind: "output-budget",
				});
		};
		child.stdout.on("data", (data: Buffer) => consume({ data }));
		child.stderr.on("data", (data: Buffer) => {
			consume({ data });
			if (!failure) errorDetailReader.consume({ data });
		});
		child.once("error", (error) => {
			failure = { message: error.message, kind: "process-error" };
		});
		child.once("close", (code, exitSignal) => {
			clearTimeout(timer);
			if (grace) clearTimeout(grace);
			signal?.removeEventListener("abort", cancel);
			if (failure) {
				reject(createBeautyLabLiveJobError({ ...failure, forced }));
				return;
			}
			if (code !== 0 || exitSignal) {
				const detail = errorDetailReader.finish();
				const reason = `Live candidate job failed (${code ?? exitSignal})`;
				reject(
					createBeautyLabLiveJobError({
						message: detail ? `${reason}: ${detail}` : reason,
						kind: exitSignal ? "exit-signal" : "exit-code",
						forced: false,
					})
				);
				return;
			}
			resolve();
		});
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) cancel();
	});
}
