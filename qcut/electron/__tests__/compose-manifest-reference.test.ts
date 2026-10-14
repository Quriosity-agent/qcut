// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handleComposeSchema } from "../native-pipeline/cli/cli-handlers-compose.js";
import {
	composeManifestSchema,
	parseComposeManifest,
} from "../native-pipeline/compose/compose-manifest.js";
import {
	COMPOSE_MANIFEST_EXAMPLE,
	COMPOSE_MANIFEST_FIELDS,
} from "../native-pipeline/compose/compose-manifest-reference.js";

function unwrapped(schema: z.ZodTypeAny): z.ZodTypeAny {
	let current = schema;
	for (;;) {
		if (current instanceof z.ZodEffects) current = current.innerType();
		else if (current instanceof z.ZodDefault) current = current._def.innerType;
		else if (current instanceof z.ZodOptional) current = current.unwrap();
		else return current;
	}
}

function defaultOf(schema: z.ZodTypeAny): unknown {
	let current = schema;
	while (current instanceof z.ZodEffects) current = current.innerType();
	return current instanceof z.ZodDefault
		? current._def.defaultValue()
		: undefined;
}

/** Every field path in the schema, with whether it may be left out. */
function schemaFields({
	schema,
	prefix = "",
}: {
	schema: z.ZodTypeAny;
	prefix?: string;
}): Array<{ path: string; required: boolean; default: unknown }> {
	const shape = unwrapped(schema);
	if (shape instanceof z.ZodArray) {
		return schemaFields({ schema: shape.element, prefix: `${prefix}[]` });
	}
	if (!(shape instanceof z.ZodObject)) return [];
	return Object.entries(shape.shape as Record<string, z.ZodTypeAny>).flatMap(
		([key, child]) => {
			const path = prefix ? `${prefix}.${key}` : key;
			return [
				{ path, required: !child.isOptional(), default: defaultOf(child) },
				...schemaFields({ schema: child, prefix: path }),
			];
		}
	);
}

describe("compose manifest reference", () => {
	const fields = schemaFields({ schema: composeManifestSchema });

	it("documents every manifest field and nothing else", () => {
		expect(COMPOSE_MANIFEST_FIELDS.map(({ path }) => path).sort()).toEqual(
			fields.map(({ path }) => path).sort()
		);
	});

	it("states each field's requiredness and default as the schema does", () => {
		const documented = new Map(
			COMPOSE_MANIFEST_FIELDS.map((field) => [field.path, field])
		);
		for (const field of fields) {
			const entry = documented.get(field.path);
			expect({ path: field.path, required: entry?.required ?? false }).toEqual({
				path: field.path,
				required: field.required,
			});
			expect({ path: field.path, default: entry?.default }).toEqual({
				path: field.path,
				default: field.default,
			});
		}
	});

	it("ships an example that parses", () => {
		const manifest = parseComposeManifest({ value: COMPOSE_MANIFEST_EXAMPLE });
		expect(manifest.clips.map(({ id }) => id)).toEqual(["intro", "interview"]);
		expect(manifest.audio[0].volumeKeyframes).toHaveLength(5);
	});

	it("is what `compose schema` returns", () => {
		expect(handleComposeSchema()).toEqual({
			success: true,
			data: {
				schemaVersion: 1,
				fields: COMPOSE_MANIFEST_FIELDS,
				example: COMPOSE_MANIFEST_EXAMPLE,
			},
		});
	});
});
