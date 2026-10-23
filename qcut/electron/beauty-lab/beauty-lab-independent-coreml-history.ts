import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { INDEPENDENT_COREML_PROFILE } from "./beauty-lab-independent-coreml.js";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const MAX_JOURNAL_BYTES = 16 * 1024 ** 2;
const journalSchema = z
	.object({
		version: z.literal(1),
		session: sha256,
		identity: z.record(z.string(), z.unknown()),
		frames: z.array(
			z
				.object({
					frame: z.number().int().nonnegative(),
					input: sha256,
					routes: z
						.array(
							z
								.object({
									network: z.enum(["coarse", "refine"]),
									backend: z.enum(["cpu", "coreml"]),
								})
								.strict()
						)
						.min(1)
						.max(8),
				})
				.strict()
		),
	})
	.strict();
const guardSchema = z
	.object({
		version: z.literal(1),
		session: sha256,
		profile: z.literal(INDEPENDENT_COREML_PROFILE),
		executionGeneration: sha256,
		resourceIdentitySha256: sha256,
		frames: z.number().int().positive(),
		prefixSha256: sha256,
	})
	.strict();
const writers = new Map<string, Promise<void>>();
async function readBounded({ file, limit }: { file: string; limit: number }) {
	try {
		if ((await stat(file)).size > limit)
			throw new Error("CoreML session history exceeds its byte budget");
		const bytes = await readFile(file);
		if (bytes.length > limit)
			throw new Error("CoreML session history exceeds its byte budget");
		return JSON.parse(bytes.toString("utf8")) as unknown;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

/** Retains the completed route prefix outside the disposable checkpoint directories. */
export function createCoreMLHistoryGuard({
	sessionsDirectory,
	session,
	resourceIdentitySha256,
	execution,
}: {
	sessionsDirectory: string;
	session: string;
	resourceIdentitySha256: string;
	execution: Record<string, unknown>;
}) {
	sha256.parse(session);
	sha256.parse(resourceIdentitySha256);
	const journalPath = path.join(
		sessionsDirectory,
		session,
		"execution-routes-v1.json"
	);
	const guardDirectory = path.join(sessionsDirectory, ".coreml-history");
	const guardPath = path.join(guardDirectory, `${session}.json`);
	const header = {
		version: 1 as const,
		session,
		profile: INDEPENDENT_COREML_PROFILE,
		executionGeneration: session,
		resourceIdentitySha256,
	};
	const expectedIdentity = { ...execution, generation: session };
	async function synchronize({
		requiredFrame,
	}: {
		requiredFrame?: number;
	} = {}) {
		const previous = writers.get(guardPath) ?? Promise.resolve();
		const operation = previous
			.catch(() => {})
			.then(async () => {
				const [rawJournal, rawGuard] = await Promise.all([
					readBounded({ file: journalPath, limit: MAX_JOURNAL_BYTES }),
					readBounded({ file: guardPath, limit: 4096 }),
				]);
				const guard =
					rawGuard === undefined ? undefined : guardSchema.parse(rawGuard);
				if (guard) {
					const {
						frames: _frames,
						prefixSha256: _prefix,
						...savedHeader
					} = guard;
					if (!isDeepStrictEqual(savedHeader, header))
						throw new Error("CoreML session history guard identity mismatch");
				}
				if (rawJournal === undefined) {
					if (guard || requiredFrame !== undefined)
						throw new Error(
							"CoreML completed session history is missing; cached pixels cannot be reused or regenerated"
						);
					return;
				}
				const journal = journalSchema.parse(rawJournal);
				if (
					journal.session !== session ||
					!isDeepStrictEqual(journal.identity, expectedIdentity)
				)
					throw new Error("CoreML session journal execution identity mismatch");
				const active = new Set<string>();
				for (const [index, frame] of journal.frames.entries()) {
					if (frame.frame !== index)
						throw new Error(
							"CoreML session journal frame history is not contiguous"
						);
					for (const route of frame.routes) {
						if (route.backend === "coreml") active.add(route.network);
						else if (active.has(route.network))
							throw new Error(
								"CoreML session journal substitutes CPU after activation"
							);
					}
				}
				const prefix = ({ frames }: { frames: number }) =>
					createHash("sha256")
						.update(JSON.stringify(journal.frames.slice(0, frames)))
						.digest("hex");
				if (
					guard &&
					(journal.frames.length < guard.frames ||
						prefix({ frames: guard.frames }) !== guard.prefixSha256)
				)
					throw new Error(
						"CoreML completed session history was truncated or rewritten"
					);
				if (requiredFrame !== undefined && !journal.frames[requiredFrame])
					throw new Error("CoreML cached frame has no completed route history");
				if (!journal.frames.length || guard?.frames === journal.frames.length)
					return;
				await mkdir(guardDirectory, { recursive: true });
				const temporary = `${guardPath}.${randomUUID()}.tmp`;
				try {
					await writeFile(
						temporary,
						JSON.stringify({
							...header,
							frames: journal.frames.length,
							prefixSha256: prefix({ frames: journal.frames.length }),
						})
					);
					await rename(temporary, guardPath);
				} finally {
					await rm(temporary, { force: true });
				}
			});
		writers.set(guardPath, operation);
		try {
			await operation;
		} finally {
			if (writers.get(guardPath) === operation) writers.delete(guardPath);
		}
	}
	return { synchronize };
}
