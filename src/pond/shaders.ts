export const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}
`;

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Layered painted water. The generated watercolor wash is sampled at three scales and
 * rotations so pigment blooms never repeat, then given granulation and slow drift.
 */
export const WATER_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tWater;
uniform float uTime;
uniform vec2 uWorld;
uniform vec2 uPx;
varying vec2 vUv;
${NOISE_GLSL}

void main(){
  float ca = uWorld.x / uWorld.y;
  float ia = 1.7778;
  vec2 q = vec2((vUv.x - 0.5) * ca / ia + 0.5, vUv.y);
  float t = uTime;

  vec2 d1 = vec2(sin(t * 0.021), cos(t * 0.017)) * 0.012;
  vec2 d2 = vec2(cos(t * 0.015 + 1.0), sin(t * 0.019)) * 0.016;
  vec2 d3 = vec2(sin(t * 0.011 + 2.0), cos(t * 0.013 + 4.0)) * 0.02;

  vec3 a = texture2D(tWater, (q - 0.5) * 0.90 + 0.5 + d1).rgb;
  vec2 r2 = mat2(0.8, -0.6, 0.6, 0.8) * (q - 0.5);
  vec3 b = texture2D(tWater, r2 * 0.62 + 0.5 + vec2(0.12, 0.05) + d2).rgb;
  vec2 r3 = mat2(0.5, 0.866, -0.866, 0.5) * (q - 0.5);
  vec3 c = texture2D(tWater, r3 * 0.38 + vec2(0.31, 0.62) + d3).rgb;

  float la = dot(a, vec3(0.3, 0.59, 0.11));
  float lb = dot(b, vec3(0.3, 0.59, 0.11));
  float lc = dot(c, vec3(0.3, 0.59, 0.11));

  // Layer the three glazes of the wash, then read its pigment density.
  vec3 col = a;
  col = mix(col, col * (0.6 + 1.3 * lb), 0.45);
  col = mix(col, b, 0.30);
  col += (lc - 0.32) * vec3(0.10, 0.20, 0.16);

  float dens = dot(col, vec3(0.08, 0.46, 0.46));
  dens = clamp((dens - 0.30) / 0.24, 0.0, 1.0);
  dens = mix(dens, 0.52, 0.22);

  // Pigment ramp: deep indigo-blue pools -> watery mid blue -> luminous teal veils.
  vec3 deep  = vec3(0.075, 0.215, 0.355);
  vec3 mid   = vec3(0.165, 0.385, 0.510);
  vec3 light = vec3(0.215, 0.495, 0.570);
  vec3 ramp = dens < 0.5 ? mix(deep, mid, dens * 2.0) : mix(mid, light, (dens - 0.5) * 2.0);

  // Keep a measure of the painting's own hue drift and fine blooms.
  col = ramp + (col - vec3(0.03, 0.31, 0.46)) * vec3(0.55, 0.30, 0.22);
  col += (la - 0.30) * 0.10;

  // Soft large-scale tonal drift, like water laid on a damp page.
  float cloud = fbm(vUv * vec2(3.0, 2.0) + vec2(t * 0.004, -t * 0.003));
  col *= 0.95 + cloud * 0.12;

  // Paper-tooth granulation: pigment settles in the grain of the paper.
  vec2 px = vUv * uPx;
  float g1 = hash21(floor(px * 0.62));
  float g2 = vnoise(px * 0.22);
  float grain = (g1 - 0.5) * 0.075 + (g2 - 0.5) * 0.06;
  col *= 1.0 + grain * (1.2 - 0.6 * dot(col, vec3(0.33)));

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const KOI_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Submerged koi: markings are untouched, but contrast and saturation are softened. */
export const KOI_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tMap;
uniform float uFade;
uniform float uDepth;
uniform vec3 uTint;
varying vec2 vUv;
void main(){
  vec4 tex = texture2D(tMap, vUv);
  vec3 c = tex.rgb;
  float lum = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(c, vec3(lum), 0.05 + 0.10 * uDepth);
  c = mix(c, uTint, 0.09 + 0.17 * uDepth);
  c *= 1.0 - 0.10 * uDepth;
  float a = tex.a * uFade * (0.96 - 0.10 * uDepth);
  gl_FragColor = vec4(c, a);
}
`;

export const SPRITE_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SPRITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tMap;
uniform float uFade;
varying vec2 vUv;
void main(){
  vec4 tex = texture2D(tMap, vUv);
  gl_FragColor = vec4(tex.rgb, tex.a * uFade);
}
`;

/** Soft contact shadow cast by a floating plant onto the water (blurred via mip bias). */
export const SHADOW_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tMap;
uniform float uFade;
uniform float uStrength;
varying vec2 vUv;
void main(){
  float a = texture2D(tMap, vUv, 3.6).a;
  gl_FragColor = vec4(vec3(0.015, 0.075, 0.13), a * uFade * uStrength);
}
`;

/**
 * Surface pass. Refracts the submerged scene by the fluid flow + wave gradient and a
 * very gentle ambient swell, then lays a faint water tint and sheen over the fish.
 */
export const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tUnder;
uniform sampler2D tFlow;
uniform vec2 uFlowTexel;
uniform float uTime;
uniform float uAmbient;
uniform float uStrength;
uniform vec2 uWorld;
varying vec2 vUv;
${NOISE_GLSL}

void main(){
  vec4 f = texture2D(tFlow, vUv);
  vec2 flow = f.xy;
  float hC = f.z;
  float hL = texture2D(tFlow, vUv - vec2(uFlowTexel.x, 0.0)).z;
  float hR = texture2D(tFlow, vUv + vec2(uFlowTexel.x, 0.0)).z;
  float hD = texture2D(tFlow, vUv - vec2(0.0, uFlowTexel.y)).z;
  float hU = texture2D(tFlow, vUv + vec2(0.0, uFlowTexel.y)).z;
  vec2 grad = vec2(hR - hL, hU - hD);

  float t = uTime;
  vec2 p = vUv * uWorld;
  vec2 amb = vec2(
    sin(p.y * 9.0 + t * 0.55) + sin((p.x + p.y) * 6.0 - t * 0.37) + vnoise(p * 5.0 + t * 0.07) - 0.5,
    cos(p.x * 8.0 + t * 0.47) + cos((p.y - p.x) * 7.0 + t * 0.31) + vnoise(p * 5.0 - t * 0.06 + 11.0) - 0.5
  ) * 0.00085 * uAmbient;

  vec2 off = (flow * 0.032 + grad * 0.42) * uStrength + amb;

  // Faint dispersion: the three channels refract a hair apart.
  vec3 col;
  col.r = texture2D(tUnder, vUv + off * 1.07).r;
  col.g = texture2D(tUnder, vUv + off).g;
  col.b = texture2D(tUnder, vUv + off * 0.93).b;

  // Water body tint over everything submerged.
  col = mix(col, vec3(0.10, 0.34, 0.46), 0.05);

  // Soft sheen where the surface tilts toward the light, plus a trace of ambient glint.
  vec2 n2 = grad * 14.0 * uStrength + amb * 90.0;
  float sheen = smoothstep(0.02, 0.35, dot(n2, normalize(vec2(-0.6, 0.8))));
  float shade = smoothstep(0.02, 0.35, -dot(n2, normalize(vec2(-0.6, 0.8))));
  col += vec3(0.55, 0.85, 0.9) * sheen * 0.075;
  col *= 1.0 - shade * 0.05;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/** Multiplies the finished pond by an irregular, watercolor-bled transparency mask. */
export const MASK_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uWorld;
uniform vec2 uOrigin;
uniform vec2 uPond;
uniform vec2 uPx;
varying vec2 vUv;
${NOISE_GLSL}

float sdRoundBox(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main(){
  vec2 w = uOrigin + vec2(vUv.x, 1.0 - vUv.y) * uWorld;
  vec2 p = w - uPond * 0.5;

  float d = sdRoundBox(p, uPond * 0.5 - vec2(0.045), 0.17);

  // Irregular edge: slow undulation + mid-scale bleeds + fine pigment tooth.
  float n  = (fbm(w * 2.2 + 3.0) - 0.5) * 0.070;
  float n2 = (fbm(w * 7.0 + 19.0) - 0.5) * 0.026;
  float n3 = (vnoise(w * 40.0) - 0.5) * 0.012;
  float edge = d + n + n2 + n3;

  float a = 1.0 - smoothstep(-0.075, 0.040, edge);
  // Blotchy, transparent-wash fade rather than a clean gradient.
  float mottle = fbm(w * 14.0 + 40.0);
  a *= mix(1.0, 0.82 + 0.35 * mottle, smoothstep(0.0, 0.5, 1.0 - a) * smoothstep(1.0, 0.4, a));
  a = clamp(a, 0.0, 1.0);
  gl_FragColor = vec4(a, a, a, a);
}
`;

/** Per-frame mask application: one texture read of the pre-baked irregular mask. */
export const MASK_APPLY_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tMask;
varying vec2 vUv;
void main(){
  float a = texture2D(tMask, vUv).r;
  gl_FragColor = vec4(a, a, a, a);
}
`;
