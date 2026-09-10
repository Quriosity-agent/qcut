/**
 * The GLSL contract every Transition Lab recipe is compiled against.
 *
 * Both the clean-room recipes and the adapted gl-transitions produce a
 * fragment shader through `fragmentShader()`, so the uniform names here are
 * the single source of truth for the WebGL hosts (lab preview, timeline
 * preview overlay, export compositor) that bind them.
 */

export const TRANSITION_LAB_VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
	vUv = aPosition * 0.5 + 0.5;
	gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export function fragmentShader({
	helpers = "",
	body,
}: {
	helpers?: string;
	body: string;
}): string {
	return `
precision highp float;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uProgress;
uniform float uIntensity;
uniform vec2 uResolution;
varying vec2 vUv;

${helpers}

void main() {
${body}
}
`;
}
