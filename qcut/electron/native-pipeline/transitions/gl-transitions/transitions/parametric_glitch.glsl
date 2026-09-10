// Author: Yoni Maltsman @friendlyspinach
// License: MIT



uniform float ampx; // =1.0
uniform float ampy; //=1.0

vec4 transition (vec2 uv) {
  vec4 from = getFromColor(uv);
  vec4 to = getToColor(uv);
  float r = from.r;
  float g = from.g;
  float b = from.b;
  float sphere = r*r + g*g + b*b - 1.0; //3 to 1
  float spiralX = cos(sphere - uv.x/(progress + .01));
  float spiralY = sin(sphere - uv.y/(progress+.01));
  vec2 st = uv;
  st.x = fract(ampx*st.x*spiralX); //1 to 2
  st.y = fract(ampy*st.y*spiralY);
  vec2 diff = uv - st;
  from = getFromColor(uv + progress*diff);
  return mix(from, to, progress);
}
