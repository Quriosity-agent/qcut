import type {
	CanvasDimensions,
	CanvasTextContext,
} from "@/lib/text/text-canvas-primitives";

export function resolveExportProjectCanvas({
	project,
	frame,
}: {
	project?: CanvasDimensions;
	frame: CanvasDimensions;
}): { canvas: CanvasDimensions; scale: number } {
	if (
		!project ||
		!Number.isFinite(project.width) ||
		!Number.isFinite(project.height) ||
		project.width <= 0 ||
		project.height <= 0
	) {
		return { canvas: frame, scale: 1 };
	}
	const scale = Math.min(
		frame.width / project.width,
		frame.height / project.height
	);
	return {
		canvas: { width: frame.width / scale, height: frame.height / scale },
		scale,
	};
}

function scaledCanvasPaintContext<Context extends CanvasTextContext>({
	ctx,
	scale,
}: {
	ctx: Context;
	scale: number;
}): Context {
	const paintLengths = new Set([
		"shadowBlur",
		"shadowOffsetX",
		"shadowOffsetY",
	]);
	const methods = new Map<PropertyKey, unknown>();
	// Canvas transforms scale glyphs and strokes, but shadows and filter lengths
	// remain device pixels. Keep those properties in the same project units.
	return new Proxy(ctx, {
		get(target, key) {
			const value: unknown = Reflect.get(target, key, target);
			if (typeof key === "string" && paintLengths.has(key)) {
				return Number(value) / scale;
			}
			if (typeof value !== "function") return value;
			if (!methods.has(key)) methods.set(key, value.bind(target));
			return methods.get(key);
		},
		set(target, key, value: unknown) {
			let scaledValue = value;
			if (typeof key === "string" && paintLengths.has(key)) {
				scaledValue = Number(value) * scale;
			}
			if (key === "filter" && typeof value === "string") {
				scaledValue = value.replace(
					/(-?(?:\d*\.)?\d+)px\b/g,
					(_match, length: string) => `${Number(length) * scale}px`
				);
			}
			return Reflect.set(target, key, scaledValue, target);
		},
	});
}

export function drawExportProjectLayer<Context extends CanvasTextContext>({
	ctx,
	frame,
	project,
	draw,
}: {
	ctx: Context;
	frame: CanvasDimensions;
	project?: CanvasDimensions;
	draw: ({ ctx, canvas }: { ctx: Context; canvas: CanvasDimensions }) => void;
}): void {
	const { canvas, scale } = resolveExportProjectCanvas({ project, frame });
	if (scale === 1) {
		draw({ ctx, canvas });
		return;
	}
	ctx.save();
	ctx.scale(scale, scale);
	try {
		draw({ ctx: scaledCanvasPaintContext({ ctx, scale }), canvas });
	} finally {
		ctx.restore();
	}
}
