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
  // The wash is mapped in world units (isotropic), so it keeps the same scale at any pond shape.
  // The texture mirrors at its edges, which lets wide or tall ponds read beyond one painting.
  vec2 q = vec2(0.5 + (vUv.x - 0.5) * uWorld.x * 0.467, 0.5 + (vUv.y - 0.5) * uWorld.y * 0.833);
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
  float cloud = fbm(vUv * uWorld * 1.67 + vec2(t * 0.004, -t * 0.003));
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
 * Surface pass. Reads the wave height field, derives the surface normal from it and refracts the
 * submerged scene by that normal (the jQuery Ripples model), plus a thin specular glint on the
 * slopes that face the light. A very faint ambient swell keeps still water from looking frozen.
 */
export const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tUnder;
uniform sampler2D tFlow;      // R = wave height, G = velocity
uniform vec2 uFlowTexel;
uniform float uTime;
uniform float uAmbient;
uniform float uStrength;
uniform vec2 uWorld;
varying vec2 vUv;
${NOISE_GLSL}

// How far (world units) a steep ripple slope bends the view of the water beneath.
const float PERTURBANCE = 0.022;
// Cell size used to turn height differences into slopes (1 / 512, as in jQuery Ripples).
const float CELL = 0.001953125;

void main(){
  float hC = texture2D(tFlow, vUv).x;
  float hR = texture2D(tFlow, vUv + vec2(uFlowTexel.x, 0.0)).x;
  float hU = texture2D(tFlow, vUv + vec2(0.0, uFlowTexel.y)).x;
  float a = hR - hC;
  float b = hU - hC;
  // normalize(cross(ddy, ddx)).xz, written out: the slope direction, saturating on steep crests.
  vec2 offset = vec2(a, b) / sqrt(a * a + b * b + CELL * CELL);

  float t = uTime;
  vec2 p = vUv * uWorld;
  vec2 amb = vec2(
    sin(p.y * 9.0 + t * 0.55) + sin((p.x + p.y) * 6.0 - t * 0.37) + vnoise(p * 5.0 + t * 0.07) - 0.5,
    cos(p.x * 8.0 + t * 0.47) + cos((p.y - p.x) * 7.0 + t * 0.31) + vnoise(p * 5.0 - t * 0.06 + 11.0) - 0.5
  ) * 0.00085 * uAmbient;

  vec2 shift = (offset * PERTURBANCE * uStrength) / uWorld + amb;
  vec3 col = texture2D(tUnder, vUv + shift).rgb;

  // Water body tint over everything submerged.
  col = mix(col, vec3(0.10, 0.34, 0.46), 0.05);

  // Specular glint, lit from the upper left; pale blue-white so it reads as light on wet pigment.
  float spec = pow(max(0.0, dot(offset, normalize(vec2(-0.6, 1.0)))), 4.0) * uStrength;
  float shade = pow(max(0.0, dot(offset, normalize(vec2(0.6, -1.0)))), 3.0) * uStrength;
  col *= 1.0 - shade * 0.15;
  col += vec3(0.78, 0.94, 1.0) * spec * 0.55;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/**
 * Multiplies the finished pond by an irregular, watercolor-bled transparency mask.
 * Everything is sized in screen pixels (via uUnit) so the deckled edge is the same
 * handful of pixels wide on a phone and on a large display, and never crosses the paper margin.
 */
export const MASK_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uWorld;
uniform vec2 uOrigin;
uniform vec2 uPond;
uniform vec2 uPx;
uniform float uUnit;
varying vec2 vUv;
${NOISE_GLSL}

float sdRoundBox(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main(){
  float pu = 1.0 / uUnit;                       // world units per screen pixel
  vec2 w = uOrigin + vec2(vUv.x, 1.0 - vUv.y) * uWorld;
  vec2 p = w - uPond * 0.5;

  // Generously rounded corners: a pond that was painted, not a cropped rectangle.
  float d = sdRoundBox(p, uPond * 0.5, min(0.30, min(uPond.x, uPond.y) * 0.22));

  // Irregular edge: slow undulation + mid-scale bleeds + fine pigment tooth.
  float n  = (fbm(w * 2.4 + 3.0) - 0.5) * 38.0 * pu;
  float n2 = (fbm(w * 7.5 + 19.0) - 0.5) * 16.0 * pu;
  float n3 = (vnoise(w * 40.0) - 0.5) * 5.0 * pu;
  float edge = d + n + n2 + n3;

  // Pigment soaks into the paper over a soft, damp band: fully opaque 20px inside the edge,
  // gone 7px outside it (the margin is 40px, so the paper always shows beyond).
  float a = 1.0 - smoothstep(-20.0 * pu, 7.0 * pu, edge);
  // Blotchy, transparent-wash fade rather than a clean gradient.
  float mottle = fbm(w * 14.0 + 40.0);
  a *= mix(1.0, 0.80 + 0.40 * mottle, smoothstep(0.0, 0.5, 1.0 - a) * smoothstep(1.0, 0.4, a));
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
