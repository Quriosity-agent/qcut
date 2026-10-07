import { readFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./runtime.js";

export interface PipelineSelection {
	cardId: string;
	intensity: number;
}
export interface PipelineAdjustments {
	values: Record<string, number>;
	makeup: Record<string, PipelineSelection>;
}
interface NumericControl {
	name: string;
	title: string;
	min: number;
	max: number;
	group: "face" | "features" | "skin";
	stage: string;
}
interface MakeupControl {
	id: string;
	title: string;
	category: string;
	min: number;
	max: number;
	script: string;
	flag: string;
	scale: number;
	parameters: string[];
}
interface StageDefinition {
	id: string;
	kind: "scalar" | "controls" | "gan";
	script: string;
	controls: string[];
	bindings?: { name: string; flag: string; scale: number }[];
}
interface PipelineCatalog {
	version: 1;
	controls: NumericControl[];
	stages: StageDefinition[];
	makeup: MakeupControl[];
	limitations: string[];
	makeupGroups?: { id: string; script: string; cards: string[] }[];
}
export interface PipelineStage {
	id: string;
	kind: string;
	script: string;
	parameters: string[];
	controls:
		| Record<string, number>
		| PipelineSelection
		| Record<string, PipelineSelection>;
}
export interface IndependentPipelinePlan {
	version: 1;
	adjustments: PipelineAdjustments;
	stages: PipelineStage[];
}

const catalog = JSON.parse(
	readFileSync(
		path.join(PROJECT_ROOT, "research", "independent-pipeline-catalog.json"),
		"utf8"
	)
) as PipelineCatalog;

function record({
	value,
	label,
}: {
	value: unknown;
	label: string;
}): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label}必须是对象`);
	return value as Record<string, unknown>;
}

function allowedKeys({
	value,
	keys,
	label,
}: {
	value: Record<string, unknown>;
	keys: string[];
	label: string;
}) {
	for (const key of Object.keys(value)) {
		if (!keys.includes(key)) throw new Error(`${label}不接受 ${key}`);
	}
}

function strength({
	value,
	min,
	max,
	label,
}: {
	value: unknown;
	min: number;
	max: number;
	label: string;
}) {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < min ||
		value > max
	) {
		throw new Error(`${label}必须是 ${min}..${max} 的数字`);
	}
	return Object.is(value, -0) ? 0 : value;
}

export function independentPipelineCatalog() {
	return {
		version: catalog.version,
		controls: catalog.controls.map(({ name, title, min, max, group }) => ({
			name,
			title,
			min,
			max,
			group,
		})),
		makeup: catalog.makeup.map(({ id, title, category, min, max }) => ({
			id,
			title,
			category,
			min,
			max,
		})),
		limitations: catalog.limitations,
	};
}

export function independentPipelineAdjustments({
	value,
}: {
	value: unknown;
}): PipelineAdjustments {
	const input = record({ value, label: "复合参数" });
	allowedKeys({ value: input, keys: ["values", "makeup"], label: "复合参数" });
	const requestedValues = record({
		value: input.values === undefined ? {} : input.values,
		label: "values",
	});
	const values: Record<string, number> = {};
	for (const [rawName, raw] of Object.entries(requestedValues)) {
		const name = rawName.startsWith("face_adjust_")
			? rawName.slice("face_adjust_".length)
			: rawName;
		const control = catalog.controls.find((entry) => entry.name === name);
		if (!control) throw new Error(`自研复合暂不支持 ${rawName}`);
		if (Object.hasOwn(values, name)) throw new Error(`参数 ${name} 被重复指定`);
		values[name] = strength({
			value: raw,
			min: control.min,
			max: control.max,
			label: control.title,
		});
	}
	const requestedMakeup = record({
		value: input.makeup === undefined ? {} : input.makeup,
		label: "makeup",
	});
	const makeup: Record<string, PipelineSelection> = {};
	for (const [category, raw] of Object.entries(requestedMakeup)) {
		const selection = record({ value: raw, label: `美妆 ${category}` });
		allowedKeys({
			value: selection,
			keys: ["cardId", "intensity"],
			label: "美妆参数",
		});
		const card = catalog.makeup.find(
			(entry) => entry.id === selection.cardId && entry.category === category
		);
		if (!card)
			throw new Error(
				`自研美妆卡 ${String(selection.cardId)} 不属于 ${category}`
			);
		makeup[category] = {
			cardId: card.id,
			intensity: strength({
				value: selection.intensity,
				min: 0,
				max: 100,
				label: card.title,
			}),
		};
	}
	return {
		values: Object.fromEntries(
			catalog.controls
				.filter(({ name }) => Object.hasOwn(values, name))
				.map(({ name }) => [name, values[name]])
		),
		makeup: Object.fromEntries(
			catalog.makeup
				.filter(({ id, category }) => makeup[category]?.cardId === id)
				.map(({ category }) => [category, makeup[category]])
		),
	};
}

export function independentPipelinePlan({
	value,
}: {
	value: unknown;
}): IndependentPipelinePlan {
	const adjustments = independentPipelineAdjustments({ value });
	const stages: PipelineStage[] = [];
	for (const definition of catalog.stages) {
		const controls = Object.fromEntries(
			definition.controls
				.filter((name) => (adjustments.values[name] ?? 0) !== 0)
				.map((name) => [name, adjustments.values[name]])
		);
		if (Object.keys(controls).length === 0) continue;
		const parameters =
			definition.kind === "controls"
				? ["--controls", JSON.stringify(controls)]
				: (definition.bindings ?? []).flatMap(({ name, flag, scale }) => [
						flag,
						String((adjustments.values[name] ?? 0) * scale),
					]);
		stages.push({
			id: definition.id,
			kind: definition.kind,
			script: definition.script,
			parameters,
			controls,
		});
	}
	const selectedMakeup = Object.entries(adjustments.makeup).filter(
		([, selection]) => selection.intensity !== 0
	);
	const sharedGroup =
		selectedMakeup.length > 1
			? catalog.makeupGroups?.find(({ cards }) =>
					selectedMakeup.every(([, selection]) =>
						cards.includes(selection.cardId)
					)
				)
			: undefined;
	if (sharedGroup) {
		const selections = Object.fromEntries(selectedMakeup);
		stages.push({
			id: sharedGroup.id,
			kind: "makeup-group",
			script: sharedGroup.script,
			parameters: ["--selections", JSON.stringify(selections)],
			controls: selections,
		});
		return { version: 1, adjustments, stages };
	}
	for (const card of catalog.makeup) {
		const selection = adjustments.makeup[card.category];
		if (!selection || selection.cardId !== card.id || selection.intensity === 0)
			continue;
		stages.push({
			id: `makeup:${card.id}`,
			kind: "makeup",
			script: card.script,
			parameters: [
				...card.parameters,
				card.flag,
				String(selection.intensity * card.scale),
			],
			controls: selection,
		});
	}
	return { version: 1, adjustments, stages };
}

if (import.meta.main) {
	const [requestFile, ...extra] = process.argv.slice(2);
	if (!requestFile || extra.length > 0)
		throw new Error(
			"用法：bun src/independent-pipeline-plan.ts <request.json>"
		);
	const source = readFileSync(requestFile, "utf8");
	if (Buffer.byteLength(source) > 64 * 1024)
		throw new Error("复合参数超出64KiB上限");
	console.log(
		JSON.stringify(independentPipelinePlan({ value: JSON.parse(source) }))
	);
}
