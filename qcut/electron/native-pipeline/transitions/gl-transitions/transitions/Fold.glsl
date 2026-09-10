// Author: nwoeanhinnogaehr
// License: MIT
// Ported from https://gist.github.com/nwoeanhinnogaehr/f6fc39f4cfcbb97f96a6

vec4 transition(vec2 uv) {
  vec4 a = getFromColor((uv - vec2(progress, 0.0)) / vec2(1.0 - progress, 1.0));
  vec4 b = getToColor(uv / vec2(progress, 1.0));
  return mix(a, b, step(uv.x, progress));
}
