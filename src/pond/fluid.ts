import * as THREE from "three";
import { WORLD } from "./constants";
import { FULLSCREEN_VERT } from "./shaders";

export const MAX_SPLATS = 8;

/** A localized disturbance of the water, in world units. */
export interface Splat {
  x: number;
  y: number;
  /** Velocity of whatever stirred the water, world units per second. */
  vx: number;
  vy: number;
  /** Scales the flow that is injected. */
  flow: number;
  /** Signed height displacement injected into the wave field. */
  height: number;
  /** Gaussian radius in world units. */
  radius: number;
}

const SIM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tState;
uniform vec2 uTexel;
uniform float uDt;
uniform vec2 uWorld;
uniform vec4 uSplatA[${MAX_SPLATS}];
uniform vec4 uSplatB[${MAX_SPLATS}];
varying vec2 vUv;

void main(){
  vec4 s = texture2D(tState, vUv);

  // --- Flow: semi-Lagrangian self-advection, light diffusion, steady decay.
  vec2 back = vUv - s.xy * uDt;
  vec2 flow = texture2D(tState, back).xy;
  vec2 fL = texture2D(tState, vUv - vec2(uTexel.x, 0.0)).xy;
  vec2 fR = texture2D(tState, vUv + vec2(uTexel.x, 0.0)).xy;
  vec2 fD = texture2D(tState, vUv - vec2(0.0, uTexel.y)).xy;
  vec2 fU = texture2D(tState, vUv + vec2(0.0, uTexel.y)).xy;
  flow = mix(flow, (fL + fR + fD + fU) * 0.25, 0.22);
  flow *= exp(-uDt * 1.55);

  // --- Surface waves: damped wave equation on a height field.
  float h = s.z;
  float hp = s.w;
  float hL = texture2D(tState, vUv - vec2(uTexel.x, 0.0)).z;
  float hR = texture2D(tState, vUv + vec2(uTexel.x, 0.0)).z;
  float hD = texture2D(tState, vUv - vec2(0.0, uTexel.y)).z;
  float hU = texture2D(tState, vUv + vec2(0.0, uTexel.y)).z;
  float lap = hL + hR + hD + hU - 4.0 * h;
  float hn = h + (h - hp) * 0.955 + 0.26 * lap;
  // Viscosity: smears the wave crest so a disturbance blooms and dissolves instead of
  // travelling outward as a crisp ring.
  hn = mix(hn, (hL + hR + hD + hU) * 0.25, 0.30);
  hn *= 0.998;

  // --- Stirring. Height is added to both time levels so a splat is a pure displacement.
  float inject = 0.0;
  for (int i = 0; i < ${MAX_SPLATS}; i++) {
    vec4 a = uSplatA[i];
    vec4 b = uSplatB[i];
    if (b.x <= 0.0) continue;
    vec2 d = (vUv - a.xy) * uWorld;
    float g = exp(-dot(d, d) / (b.x * b.x));
    flow += a.zw * g * b.y;
    inject += g * b.z;
  }
  hn += inject;

  // The faded border absorbs motion so nothing is reflected back as a ring.
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.0, 0.07, min(e.x, e.y));
  flow *= edge;
  hn *= mix(0.85, 1.0, edge);

  gl_FragColor = vec4(flow, hn, h + inject);
}
`;

/**
 * GPU fluid: a self-advecting flow field plus a damped wave field. The surface pass
 * reads both to refract the submerged scene.
 */
export class FluidSim {
  readonly width: number;
  readonly height: number;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private read = 0;
  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private accumulator = 0;
  private readonly splatA = Array.from({ length: MAX_SPLATS }, () => new THREE.Vector4());
  private readonly splatB = Array.from({ length: MAX_SPLATS }, () => new THREE.Vector4());

  constructor(private readonly renderer: THREE.WebGLRenderer, width = 320) {
    this.width = width;
    this.height = Math.round((width * WORLD.h) / WORLD.w);
    const make = () =>
      new THREE.WebGLRenderTarget(this.width, this.height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
      });
    this.targets = [make(), make()];

    this.material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: SIM_FRAG,
      uniforms: {
        tState: { value: this.targets[0].texture },
        uTexel: { value: new THREE.Vector2(1 / this.width, 1 / this.height) },
        uDt: { value: 1 / 60 },
        uWorld: { value: new THREE.Vector2(WORLD.w, WORLD.h) },
        uSplatA: { value: this.splatA },
        uSplatB: { value: this.splatB },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.clear();
  }

  get texture() {
    return this.targets[this.read].texture;
  }

  clear() {
    const prev = this.renderer.getRenderTarget();
    const color = new THREE.Color();
    this.renderer.getClearColor(color);
    const alpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    for (const t of this.targets) {
      this.renderer.setRenderTarget(t);
      this.renderer.clear();
    }
    this.renderer.setClearColor(color, alpha);
    this.renderer.setRenderTarget(prev);
    this.accumulator = 0;
  }

  /** Advance the fixed 60 Hz simulation; splats are injected on the first sub-step only. */
  step(dt: number, splats: Splat[]) {
    this.accumulator = Math.min(this.accumulator + dt, 1 / 20);
    const STEP = 1 / 60;
    let first = true;
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.pass(first ? splats : []);
      first = false;
    }
    if (first && splats.length) this.pass(splats);
  }

  private pass(splats: Splat[]) {
    for (let i = 0; i < MAX_SPLATS; i++) {
      const s = splats[i];
      if (!s) {
        this.splatB[i].set(0, 0, 0, 0);
        continue;
      }
      const u = (s.x - WORLD.x0) / WORLD.w;
      const v = 1 - (s.y - WORLD.y0) / WORLD.h;
      this.splatA[i].set(u, v, s.vx / WORLD.w, -s.vy / WORLD.h);
      this.splatB[i].set(s.radius, s.flow, s.height, 0);
    }
    this.material.uniforms.tState.value = this.targets[this.read].texture;
    const write = 1 - this.read;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.targets[write]);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
    this.read = write;
  }

  /** Debug read-back: peak flow speed and peak wave height currently in the field. */
  stats() {
    const buf = new Uint16Array(this.width * this.height * 4);
    this.renderer.readRenderTargetPixels(this.targets[this.read], 0, 0, this.width, this.height, buf);
    let flow = 0;
    let wave = 0;
    let energy = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const fx = THREE.DataUtils.fromHalfFloat(buf[i]);
      const fy = THREE.DataUtils.fromHalfFloat(buf[i + 1]);
      const h = THREE.DataUtils.fromHalfFloat(buf[i + 2]);
      flow = Math.max(flow, Math.hypot(fx, fy));
      wave = Math.max(wave, Math.abs(h));
      energy += fx * fx + fy * fy;
    }
    return { peakFlow: flow, peakWave: wave, flowEnergy: energy };
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.material.dispose();
  }
}
