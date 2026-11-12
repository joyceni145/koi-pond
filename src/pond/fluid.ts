import * as THREE from "three";
import { WORLD } from "./constants";
import { FULLSCREEN_VERT } from "./shaders";

export const MAX_SPLATS = 8;

/** Number of cells in the wave grid (cells are square, so the count follows the pond's shape). */
const CELLS = 512 * 340;

/** A drop falling on the water, in world units. */
export interface Splat {
  x: number;
  y: number;
  /** Radius of the drop in world units. */
  radius: number;
  /** Height added at the centre of the drop. */
  strength: number;
}

/**
 * A damped wave field in the style of jQuery Ripples: every cell is pulled toward the average of its
 * four neighbours, which sends crisp circular rings racing outward that slowly lose energy.
 * State: R = height, G = vertical velocity.
 */
const SIM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tState;
uniform vec2 uTexel;
uniform vec2 uWorld;
uniform vec2 uEdge;
uniform vec4 uSplat[${MAX_SPLATS}];
varying vec2 vUv;

const float PI = 3.14159265359;

void main(){
  vec2 s = texture2D(tState, vUv).xy;
  float hL = texture2D(tState, vUv - vec2(uTexel.x, 0.0)).x;
  float hR = texture2D(tState, vUv + vec2(uTexel.x, 0.0)).x;
  float hD = texture2D(tState, vUv - vec2(0.0, uTexel.y)).x;
  float hU = texture2D(tState, vUv + vec2(0.0, uTexel.y)).x;

  float avg = (hL + hR + hD + hU) * 0.25;
  // Gentler than jQuery Ripples (2.0, damping 0.995): slower rings that fade sooner. The lower pull
  // also keeps the fastest, checkerboard mode well inside the stability limit, so rounding noise in
  // half-float storage can never build up over a long session.
  float v = s.y + (avg - s.x) * 1.3;
  v *= 0.992;
  float h = s.x + v;
  // A touch of viscosity rounds off the crests, so rings are soft rather than sharp.
  h = mix(h, avg, 0.05);

  // Drops: a smooth cosine bump, as in jQuery Ripples.
  for (int i = 0; i < ${MAX_SPLATS}; i++) {
    vec4 d = uSplat[i];
    if (d.w == 0.0) continue;
    float t = max(0.0, 1.0 - length((vUv - d.xy) * uWorld) / d.z);
    t = 0.5 - cos(t * PI) * 0.5;
    h += t * d.w;
  }

  // Waves that run into the paper margin are soaked up, so nothing rings back out of the blank page.
  vec2 e = min(vUv, 1.0 - vUv) / uEdge;
  float edge = smoothstep(0.0, 1.0, min(e.x, e.y));
  v *= mix(0.86, 1.0, edge);
  h *= mix(0.97, 1.0, edge);

  gl_FragColor = vec4(clamp(h, -1.0, 1.0), clamp(v, -0.5, 0.5), 0.0, 1.0);
}
`;

/** GPU wave simulation. The surface pass reads its height field to refract the submerged scene. */
export class FluidSim {
  width = 0;
  height = 0;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private read = 0;
  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private accumulator = 0;
  private readonly splats = Array.from({ length: MAX_SPLATS }, () => new THREE.Vector4());

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.fitGrid();
    this.targets = [this.makeTarget(), this.makeTarget()];

    this.material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: SIM_FRAG,
      uniforms: {
        tState: { value: this.targets[0].texture },
        uTexel: { value: new THREE.Vector2(1 / this.width, 1 / this.height) },
        uWorld: { value: new THREE.Vector2(WORLD.w, WORLD.h) },
        uEdge: { value: new THREE.Vector2(1, 1) },
        uSplat: { value: this.splats },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.updateUniforms();
    this.clear();
  }

  /** Square cells at a roughly constant cell count, whatever the pond's shape. */
  private fitGrid() {
    const aspect = WORLD.w / WORLD.h;
    this.width = Math.max(64, Math.round(Math.sqrt(CELLS * aspect)));
    this.height = Math.max(64, Math.round(this.width / aspect));
  }

  private makeTarget() {
    return new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
    });
  }

  private updateUniforms() {
    const u = this.material.uniforms;
    u.uTexel.value.set(1 / this.width, 1 / this.height);
    u.uWorld.value.set(WORLD.w, WORLD.h);
    // The border that absorbs waves is a little wider than the paper margin, in uv.
    u.uEdge.value.set((WORLD.pad / WORLD.w) * 1.2, (WORLD.pad / WORLD.h) * 1.2);
  }

  /** Follow a new world shape (window resize). Reallocates only when the grid really changes. */
  resize() {
    const prevW = this.width;
    const prevH = this.height;
    this.fitGrid();
    if (Math.abs(this.width - prevW) > 8 || Math.abs(this.height - prevH) > 8) {
      for (const t of this.targets) t.dispose();
      this.targets = [this.makeTarget(), this.makeTarget()];
      this.read = 0;
      this.clear();
    } else {
      this.width = prevW;
      this.height = prevH;
    }
    this.updateUniforms();
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

  /** Advance the fixed 60 Hz simulation; drops are added on the first sub-step only. */
  step(dt: number, drops: Splat[]) {
    this.accumulator = Math.min(this.accumulator + dt, 1 / 20);
    const STEP = 1 / 60;
    let first = true;
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.pass(first ? drops : []);
      first = false;
    }
    if (first && drops.length) this.pass(drops);
  }

  private pass(drops: Splat[]) {
    for (let i = 0; i < MAX_SPLATS; i++) {
      const s = drops[i];
      if (!s) {
        this.splats[i].set(0, 0, 0, 0);
        continue;
      }
      const u = (s.x - WORLD.x0) / WORLD.w;
      const v = 1 - (s.y - WORLD.y0) / WORLD.h;
      this.splats[i].set(u, v, s.radius, s.strength);
    }
    this.material.uniforms.tState.value = this.targets[this.read].texture;
    const write = 1 - this.read;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.targets[write]);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
    this.read = write;
  }

  /** Debug read-back: peak vertical speed and peak wave height currently in the field. */
  stats() {
    const buf = new Uint16Array(this.width * this.height * 4);
    this.renderer.readRenderTargetPixels(this.targets[this.read], 0, 0, this.width, this.height, buf);
    let flow = 0;
    let wave = 0;
    let energy = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const h = THREE.DataUtils.fromHalfFloat(buf[i]);
      const v = THREE.DataUtils.fromHalfFloat(buf[i + 1]);
      flow = Math.max(flow, Math.abs(v));
      wave = Math.max(wave, Math.abs(h));
      energy += v * v;
    }
    return { peakFlow: flow, peakWave: wave, flowEnergy: energy };
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.material.dispose();
  }
}
