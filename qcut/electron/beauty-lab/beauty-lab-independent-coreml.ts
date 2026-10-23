import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { z } from "zod";
import { runIndependentBeautyJob } from "./beauty-lab-independent-process.js";
import { independentBeautyEnvironment } from "./beauty-lab-runtime-environment.js";

export const INDEPENDENT_COREML_PROFILE = "swing-coreml-v1";
export const independentBodyVideoProfileSchema = z.literal(
	INDEPENDENT_COREML_PROFILE
);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z
	.object({
		schemaVersion: z.literal(1),
		profile: independentBodyVideoProfileSchema,
		identity: z
			.object({
				execution: z
					.object({ profile: independentBodyVideoProfileSchema })
					.passthrough(),
				helper: z
					.object({ sourceSha256: sha256Schema, binarySha256: sha256Schema })
					.strict(),
				python: z.string().min(1),
				hardwareModel: z.string().min(1).max(256),
			})
			.strict(),
	})
	.strict();

export async function inspectIndependentCoreML({
	engineRoot,
	runtimeRoot,
	python,
	environment,
	platform = process.platform,
	signal = new AbortController().signal,
	runJob = runIndependentBeautyJob,
}: {
	engineRoot: string;
	runtimeRoot: string;
	python: string;
	environment: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	signal?: AbortSignal;
	runJob?: typeof runIndependentBeautyJob;
}) {
	let directory: string | undefined;
	try {
		signal.throwIfAborted();
		if (platform !== "darwin")
			throw new Error("CoreML body video requires macOS");
		if (!environment.QCUT_BODY_COREML_MODEL_ROOT)
			throw new Error(
				"Set QCUT_BODY_COREML_MODEL_ROOT to the validated external coarse/refine models"
			);
		directory = await mkdtemp(
			path.join(os.tmpdir(), "qcut-body-coreml-inspect-")
		);
		const output = path.join(directory, "identity.json");
		await runJob({
			python,
			cwd: engineRoot,
			environment: independentBeautyEnvironment({ environment }),
			signal,
			timeoutMs: 60_000,
			args: [
				"-B",
				path.join(engineRoot, "research/body_coreml_capability.py"),
				"--runtime",
				runtimeRoot,
				"--output",
				output,
			],
		});
		signal.throwIfAborted();
		if ((await stat(output)).size > 64 * 1024)
			throw new Error("CoreML capability identity exceeds its budget");
		const bytes = await readFile(output);
		if (bytes.length > 64 * 1024)
			throw new Error("CoreML capability identity exceeds its budget");
		const receipt = receiptSchema.parse(JSON.parse(bytes.toString("utf8")));
		if (Object.hasOwn(receipt.identity.execution, "generation"))
			throw new Error(
				"CoreML capability identity must not contain a session generation"
			);
		return {
			available: true as const,
			message:
				"CoreML body video is available; external models and owned execution sources validated",
			identitySha256: createHash("sha256")
				.update(JSON.stringify(receipt.identity))
				.digest("hex"),
			identity: receipt.identity,
		};
	} catch (error) {
		signal.throwIfAborted();
		return { available: false as const, message: String(error) };
	} finally {
		if (directory) await rm(directory, { recursive: true, force: true });
	}
}

export function coreMLSequenceIdentity({
	profile,
	sequence,
}: {
	profile: string | undefined;
	sequence?: {
		executionProfile?: string;
		executionGeneration?: string;
		executionIdentitySha256?: string;
	};
}) {
	if (!profile) {
		if (
			sequence?.executionProfile ||
			sequence?.executionGeneration ||
			sequence?.executionIdentitySha256
		)
			throw new Error(
				"Body execution fields require an explicit CoreML adjustment profile"
			);
		return;
	}
	if (
		profile !== INDEPENDENT_COREML_PROFILE ||
		sequence?.executionProfile !== profile ||
		!sequence.executionGeneration ||
		!sequence.executionIdentitySha256
	)
		throw new Error(
			"CoreML body video requires a profiled sequence with a validated execution identity"
		);
}

export function verifyCoreMLSequenceReceipt({
	stages,
	generation,
	execution,
}: {
	stages: unknown;
	generation: string;
	execution: Record<string, unknown>;
}) {
	const matches = z
		.array(
			z
				.object({
					script: z.string().optional(),
					receipt: z.unknown().optional(),
				})
				.passthrough()
		)
		.parse(stages)
		.filter((stage) => stage.script === "body_smart_render.py");
	if (matches.length !== 1)
		throw new Error(
			"CoreML body sequence receipt is missing its smart-body stage"
		);
	const receipt = z
		.object({
			executionIdentity: z.record(z.string(), z.unknown()),
			executionRoutes: z.array(
				z
					.object({
						network: z.enum(["coarse", "refine"]),
						backend: z.enum(["cpu", "coreml"]),
					})
					.strict()
			),
		})
		.passthrough()
		.parse(matches[0].receipt);
	const expected = { ...execution, generation };
	if (!isDeepStrictEqual(receipt.executionIdentity, expected))
		throw new Error("CoreML body sequence execution identity mismatch");
}
