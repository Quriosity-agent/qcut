import { TRANSITION_LAB_VERTEX_SHADER } from "../../../../../electron/native-pipeline/transitions/transition-lab-shader";

/**
 * Runs a Transition Lab fragment shader over two already-rendered frames.
 *
 * Both the timeline preview overlay and the canvas export feed it the `from`
 * and `to` clips exactly as they would land on the stage, so the shader sees
 * full frames (letterboxing included) and its output can be drawn straight
 * onto the destination. Programs are cached per recipe; textures are reused
 * across frames because uploading is the only per-frame cost that matters.
 */
export interface ShaderTransitionFrame {
	/** Cache key for the compiled program — the recipe id. */
	programKey: string;
	fragmentSource: string;
	from: TexImageSource;
	to: TexImageSource;
	/** 0 shows only `from`; 1 shows only `to`. */
	progress: number;
	intensity?: number;
	width: number;
	height: number;
}

export interface ShaderTransitionCompositor {
	/** Renders the frame and returns the WebGL canvas holding the result. */
	render(frame: ShaderTransitionFrame): HTMLCanvasElement;
	dispose(): void;
}

interface CompiledProgram {
	program: WebGLProgram;
	position: number;
	from: WebGLUniformLocation | null;
	to: WebGLUniformLocation | null;
	progress: WebGLUniformLocation | null;
	intensity: WebGLUniformLocation | null;
	resolution: WebGLUniformLocation | null;
	/** Only the adapted gl-transitions declare it; null elsewhere is fine. */
	ratio: WebGLUniformLocation | null;
}

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

function compileShader({
	gl,
	source,
	type,
}: {
	gl: WebGLRenderingContext;
	source: string;
	type: number;
}): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("Unable to allocate a WebGL shader");
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader) || "Unknown shader error";
		gl.deleteShader(shader);
		throw new Error(`Shader transition compilation failed: ${message}`);
	}
	return shader;
}

function linkProgram({
	gl,
	fragmentSource,
}: {
	gl: WebGLRenderingContext;
	fragmentSource: string;
}): CompiledProgram {
	const vertex = compileShader({
		gl,
		source: TRANSITION_LAB_VERTEX_SHADER,
		type: gl.VERTEX_SHADER,
	});
	const fragment = compileShader({
		gl,
		source: fragmentSource,
		type: gl.FRAGMENT_SHADER,
	});
	const program = gl.createProgram();
	if (!program) throw new Error("Unable to allocate a WebGL program");
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) || "Unknown link error";
		gl.deleteProgram(program);
		throw new Error(`Shader transition linking failed: ${message}`);
	}
	return {
		program,
		position: gl.getAttribLocation(program, "aPosition"),
		from: gl.getUniformLocation(program, "uFrom"),
		to: gl.getUniformLocation(program, "uTo"),
		progress: gl.getUniformLocation(program, "uProgress"),
		intensity: gl.getUniformLocation(program, "uIntensity"),
		resolution: gl.getUniformLocation(program, "uResolution"),
		ratio: gl.getUniformLocation(program, "uRatio"),
	};
}

function createTexture({ gl }: { gl: WebGLRenderingContext }): WebGLTexture {
	const texture = gl.createTexture();
	if (!texture) throw new Error("Unable to allocate a WebGL texture");
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	return texture;
}

function uploadTexture({
	gl,
	texture,
	unit,
	source,
}: {
	gl: WebGLRenderingContext;
	texture: WebGLTexture;
	unit: number;
	source: TexImageSource;
}): void {
	gl.activeTexture(gl.TEXTURE0 + unit);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	// gl-transitions address uv with y up; every DOM source is top-down.
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}

/** Returns null where WebGL1 is unavailable (jsdom, blocked GPU). */
export function createShaderTransitionCompositor(): ShaderTransitionCompositor | null {
	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	const gl = canvas.getContext("webgl", {
		alpha: true,
		premultipliedAlpha: false,
		antialias: false,
		preserveDrawingBuffer: true,
	});
	if (!gl) return null;
	const buffer = gl.createBuffer();
	if (!buffer) return null;
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
	const fromTexture = createTexture({ gl });
	const toTexture = createTexture({ gl });
	const programs = new Map<string, CompiledProgram>();
	// Bound alias: biome reads `gl.useProgram` as a React hook call.
	const activateProgram = gl.useProgram.bind(gl);
	let disposed = false;

	return {
		render(frame) {
			if (disposed) throw new Error("Shader transition compositor is disposed");
			const width = Math.max(1, Math.round(frame.width));
			const height = Math.max(1, Math.round(frame.height));
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
			}
			let compiled = programs.get(frame.programKey);
			if (!compiled) {
				compiled = linkProgram({ gl, fragmentSource: frame.fragmentSource });
				programs.set(frame.programKey, compiled);
			}
			gl.viewport(0, 0, width, height);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			activateProgram(compiled.program);
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.enableVertexAttribArray(compiled.position);
			gl.vertexAttribPointer(compiled.position, 2, gl.FLOAT, false, 0, 0);
			uploadTexture({ gl, texture: fromTexture, unit: 0, source: frame.from });
			uploadTexture({ gl, texture: toTexture, unit: 1, source: frame.to });
			gl.uniform1i(compiled.from, 0);
			gl.uniform1i(compiled.to, 1);
			gl.uniform1f(compiled.progress, Math.min(1, Math.max(0, frame.progress)));
			gl.uniform1f(compiled.intensity, frame.intensity ?? 1);
			gl.uniform2f(compiled.resolution, width, height);
			gl.uniform1f(compiled.ratio, width / height);
			gl.drawArrays(gl.TRIANGLES, 0, 6);
			return canvas;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const compiled of programs.values())
				gl.deleteProgram(compiled.program);
			programs.clear();
			gl.deleteTexture(fromTexture);
			gl.deleteTexture(toTexture);
			gl.deleteBuffer(buffer);
			gl.getExtension("WEBGL_lose_context")?.loseContext();
		},
	};
}
