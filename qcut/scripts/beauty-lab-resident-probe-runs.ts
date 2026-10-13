import { writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { createBeautyLabIndependentProvider } from "../electron/beauty-lab/beauty-lab-independent";
import type { BeautyLabIndependentResult } from "../electron/beauty-lab/beauty-lab-independent-contract";
import type { MediaPortraitAdjustments } from "../electron/jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract";
import {
	exactOutput,
	median,
	requireProbe,
	residentIdentity,
	serial,
	sha256,
	writeJson,
	type ProbeFrame,
} from "./beauty-lab-resident-probe-utils";
type OwnedProvider = ReturnType<typeof createBeautyLabIndependentProvider>;
interface ProbeCase {
	name: string;
	adjustments: MediaPortraitAdjustments;
}
export async function timedRender({
	provider,
	frame,
	adjustments,
	name,
	directory,
}: {
	provider: OwnedProvider;
	frame: ProbeFrame;
	adjustments: MediaPortraitAdjustments;
	name: string;
	directory: string;
}) {
	const started = performance.now();
	const result = await provider.render({
		request: {
			...frame,
			requestId: name,
			sourceKey: "resident-probe",
			adjustments,
		},
	});
	const milliseconds = performance.now() - started;
	await Promise.all([
		writeFile(path.join(directory, `${name}.png`), result.png),
		writeJson({
			directory,
			name,
			value: {
				milliseconds,
				inputSha256: result.inputSha256,
				outputSha256: result.outputSha256,
				pngSha256: sha256({ bytes: result.png }),
				report: result.report,
			},
		}),
	]);
	return { result, milliseconds };
}

export async function benchmark({
	test,
	frame,
	oneShot,
	resident,
	directory,
}: {
	test: ProbeCase;
	frame: ProbeFrame;
	oneShot: OwnedProvider;
	resident: OwnedProvider;
	directory: string;
}) {
	const timings = { oneShot: [] as number[], resident: [] as number[] };
	const runs: Record<string, unknown>[] = [];
	let reference: BeautyLabIndependentResult | undefined;
	let last: BeautyLabIndependentResult | undefined;
	await serial({
		entries: ["oneShot", "resident"] as const as (keyof typeof timings)[],
		run: async (mode) => {
			await serial({
				entries: [0, 1, 2],
				run: async (iteration) => {
					const name = `${test.name}-${mode}-${iteration}`;
					const { result, milliseconds } = await timedRender({
						provider: mode === "oneShot" ? oneShot : resident,
						frame,
						adjustments: test.adjustments,
						name,
						directory,
					});
					reference ??= result;
					const equality = exactOutput({ actual: result, expected: reference });
					const runtime =
						mode === "resident" ? residentIdentity({ result }) : null;
					timings[mode].push(milliseconds);
					runs.push({ name, milliseconds, equality, runtime });
					last = result;
					console.log(
						JSON.stringify({
							phase: "benchmark",
							name,
							milliseconds,
							equality,
							runtime,
						})
					);
				},
			});
		},
	});
	requireProbe({
		condition: Boolean(reference && last),
		message: "Benchmark produced no frames",
	});
	const oneShotMedianMs = median({ values: timings.oneShot });
	const residentWarmMedianMs = median({ values: timings.resident.slice(1) });
	const exact = runs.every((run) =>
		Object.values(run.equality as Record<string, boolean>).every(Boolean)
	);
	return {
		reference: reference as BeautyLabIndependentResult,
		last: last as BeautyLabIndependentResult,
		summary: {
			name: test.name,
			adjustments: test.adjustments,
			exact,
			runs,
			oneShotMedianMs,
			residentFirstMs: timings.resident[0],
			residentWarmMedianMs,
			speedup: oneShotMedianMs / residentWarmMedianMs,
		},
	};
}

export async function interruption({
	mode,
	provider,
	frame,
	reference,
	prior,
	adjustments,
	directory,
}: {
	mode: "cancel" | "crash";
	provider: OwnedProvider;
	frame: ProbeFrame;
	reference: BeautyLabIndependentResult;
	prior: BeautyLabIndependentResult;
	adjustments: MediaPortraitAdjustments;
	directory: string;
}) {
	const requestId = `interrupt-${mode}`,
		previousPid = residentIdentity({ result: prior }).pid;
	let settled = false,
		intervention: Record<string, unknown> = { attempted: false };
	const started = performance.now();
	const pending = provider
		.render({
			request: {
				...frame,
				requestId,
				sourceKey: "resident-probe",
				adjustments,
			},
		})
		.then(
			(result) => {
				settled = true;
				return { rejected: false, result, error: null };
			},
			(error: unknown) => {
				settled = true;
				return { rejected: true, result: null, error: String(error) };
			}
		);
	const timer = setTimeout(() => {
		intervention = {
			attempted: !settled,
			elapsedMs: performance.now() - started,
			previousPid,
		};
		if (settled) return;
		try {
			if (mode === "cancel")
				intervention.cancelled = provider.cancel({
					request: { requestId },
				}).cancelled;
			else {
				process.kill(previousPid, "SIGKILL");
				intervention.signal = "SIGKILL";
			}
		} catch (error) {
			intervention.error = String(error);
		}
	}, 500);
	const outcome = await pending.finally(() => clearTimeout(timer));
	await writeJson({
		directory,
		name: `${requestId}-outcome`,
		value: {
			...intervention,
			rejected: outcome.rejected,
			error: outcome.error,
			milliseconds: performance.now() - started,
		},
	});
	const recovered = await timedRender({
		provider,
		frame,
		adjustments,
		name: `${mode}-recovered`,
		directory,
	});
	const recoveryRuntime = residentIdentity({ result: recovered.result });
	const equality = exactOutput({
		actual: recovered.result,
		expected: reference,
	});
	const actionSucceeded =
		mode === "cancel"
			? intervention.cancelled === true
			: intervention.signal === "SIGKILL";
	const passed =
		actionSucceeded &&
		outcome.rejected &&
		recoveryRuntime.pid !== previousPid &&
		Object.values(equality).every(Boolean);
	const summary = {
		mode,
		passed,
		intervention,
		rejected: outcome.rejected,
		error: outcome.error,
		recoveredRuntime: recoveryRuntime,
		equality,
		recoveryMilliseconds: recovered.milliseconds,
	};
	await writeJson({ directory, name: `${mode}-recovery`, value: summary });
	console.log(JSON.stringify({ phase: "recovery", ...summary }));
	return { result: recovered.result, summary };
}
