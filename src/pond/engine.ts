import * as THREE from "three";
import type { Assets } from "./assets";
import { CAPS, KOI_VARIANTS, POND_H, POND_W, SAFE_INSET, SPAWN_ODDS, WORLD } from "./constants";
import { FluidSim, MAX_SPLATS, type Splat } from "./fluid";
import { attachPointerInput } from "./input";
import { Koi, randomKoiParams } from "./koi";
import { clamp, mulberry32, range, type Rng } from "./math";
import { Plant, type PlantKind } from "./plants";
import { COMPOSITE_FRAG, FULLSCREEN_VERT, MASK_APPLY_FRAG, MASK_FRAG, WATER_FRAG } from "./shaders";

export interface EngineOptions {
  reducedMotion: boolean;
  /** Freeze all motion at the painted rest pose (used for composition review). */
  still?: boolean;
  /** Debug: a single koi and no plants, for reviewing swimming in isolation. */
  solo?: boolean;
}

export type SpawnKind = "koi" | "pad" | "lotus";

const MAX_PIXEL_RATIO = 2;
const MAX_PIXELS = 3_400_000;

function fullscreenQuad(material: THREE.ShaderMaterial, order: number) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}

export class PondEngine {
  readonly renderer: THREE.WebGLRenderer;
  private readonly assets: Assets;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.OrthographicCamera;
  private readonly underScene = new THREE.Scene();
  private readonly mainScene = new THREE.Scene();
  private underTarget: THREE.WebGLRenderTarget;
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly maskMaterial: THREE.ShaderMaterial;
  private readonly maskBakeMaterial: THREE.ShaderMaterial;
  private readonly maskBakeScene = new THREE.Scene();
  private maskTarget: THREE.WebGLRenderTarget;
  private readonly fluid: FluidSim;
  private splats: Splat[] = [];
  private detachInput: (() => void) | null = null;
  private wakeClock = 0;

  readonly koi: Koi[] = [];
  readonly plants: Plant[] = [];

  private time = 0;
  private lastFrame = 0;
  private raf = 0;
  private running = false;
  private pixelRatio = 1;
  private cssW = 1;
  private cssH = 1;
  private resizeObserver?: ResizeObserver;
  private frameMs = 16;
  private slowFrames = 0;
  private lastVariant = "";
  private readonly opts: EngineOptions;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, assets: Assets, opts: EngineOptions) {
    this.canvas = canvas;
    this.assets = assets;
    this.opts = opts;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = true;

    // y-down world: top = y0, bottom = y1.
    this.camera = new THREE.OrthographicCamera(WORLD.x0, WORLD.x1, WORLD.y0, WORLD.y1, -10, 10);

    this.underTarget = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    this.fluid = new FluidSim(this.renderer);

    this.waterMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        tWater: { value: assets.water },
        uTime: { value: 0 },
        uWorld: { value: new THREE.Vector2(WORLD.w, WORLD.h) },
        uPx: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.underScene.add(fullscreenQuad(this.waterMaterial, 0));

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tUnder: { value: this.underTarget.texture },
        tFlow: { value: this.fluid.texture },
        uFlowTexel: { value: new THREE.Vector2(1 / this.fluid.width, 1 / this.fluid.height) },
        uTime: { value: 0 },
        uAmbient: { value: opts.reducedMotion ? 0 : 1 },
        uStrength: { value: opts.reducedMotion ? 0.4 : 1 },
        uWorld: { value: new THREE.Vector2(WORLD.w, WORLD.h) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.mainScene.add(fullscreenQuad(this.compositeMaterial, 0));

    // The irregular pond mask never changes, so it is painted once per resize into a texture.
    this.maskTarget = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    this.maskBakeMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: MASK_FRAG,
      uniforms: {
        uWorld: { value: new THREE.Vector2(WORLD.w, WORLD.h) },
        uOrigin: { value: new THREE.Vector2(WORLD.x0, WORLD.y0) },
        uPond: { value: new THREE.Vector2(POND_W, POND_H) },
        uPx: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.maskBakeScene.add(fullscreenQuad(this.maskBakeMaterial, 0));

    this.maskMaterial = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: MASK_APPLY_FRAG,
      uniforms: { tMask: { value: this.maskTarget.texture } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.SrcAlphaFactor,
    });
    this.mainScene.add(fullscreenQuad(this.maskMaterial, 1000));

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);

    this.populateStartingScene();
    this.detachInput = attachPointerInput(canvas, this);
  }

  /* ------------------------------------------------------------------ sizing */

  get motion() {
    return this.opts.still ? 0 : this.opts.reducedMotion ? 0.4 : 1;
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.applyPixelRatio();
  }

  private applyPixelRatio() {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    let pr = Math.min(dpr, MAX_PIXEL_RATIO, this.pixelRatioCeiling());
    pr = Math.max(0.75, pr);
    this.pixelRatio = pr;
    const w = Math.max(2, Math.round(this.cssW * pr));
    const h = Math.max(2, Math.round(this.cssH * pr));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.underTarget.setSize(w, h);
    this.waterMaterial.uniforms.uPx.value.set(w, h);
    this.maskBakeMaterial.uniforms.uPx.value.set(w, h);
    this.maskTarget.setSize(w, h);
    this.renderer.setRenderTarget(this.maskTarget);
    this.renderer.render(this.maskBakeScene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  private qualityCap = MAX_PIXEL_RATIO;
  private pixelRatioCeiling() {
    const byPixels = Math.sqrt(MAX_PIXELS / (this.cssW * this.cssH));
    return Math.min(this.qualityCap, byPixels);
  }

  /** Current drawing-buffer size, for diagnostics. */
  get bufferSize() {
    const s = new THREE.Vector2();
    this.renderer.getSize(s);
    return { w: s.x, h: s.y, pixelRatio: this.pixelRatio };
  }

  /* ----------------------------------------------------------------- scenes */

  private makeKoi(variant: string, x: number, y: number, heading: number, rng: Rng, length?: number) {
    const asset = this.assets.koi[variant];
    const koi = new Koi(asset, randomKoiParams(rng, length), x, y, heading, rng);
    this.underScene.add(koi.mesh);
    this.koi.push(koi);
    return koi;
  }

  private makePlant(kind: PlantKind, index: number, diameter: number, x: number, y: number, rng: Rng) {
    const list = kind === "pad" ? this.assets.pads : this.assets.lotus;
    const asset = list[index % list.length];
    const plant = new Plant(kind, asset, diameter, x, y, rng);
    this.mainScene.add(plant.shadow);
    this.mainScene.add(plant.mesh);
    this.plants.push(plant);
    return plant;
  }

  /** The fixed opening scene: three koi and a few lily pads. Reset restores exactly this. */
  private populateStartingScene() {
    const rng = mulberry32(20240611);
    this.makeKoi("kohaku", 0.62, 0.5, -0.5, rng, 0.42);
    const k2 = this.makeKoi("showa", 1.0, 0.64, Math.PI * 0.85, rng, 0.36);
    const k3 = this.makeKoi("gold", 0.86, 0.3, 0.25, rng, 0.31);
    if (this.opts.solo) {
      for (const k of [k2, k3]) this.removeNow(k);
      return;
    }
    const pad = (i: number, d: number, x: number, y: number) => this.makePlant("pad", i, d, x, y, rng);
    pad(0, 0.3, 0.38, 0.3);
    pad(7, 0.16, 1.24, 0.3);
    pad(9, 0.21, 1.02, 0.78);
    pad(2, 0.17, 0.52, 0.76);
    pad(11, 0.075, 1.3, 0.62);
  }

  private removeNow(k: Koi) {
    this.underScene.remove(k.mesh);
    k.dispose();
    this.koi.splice(this.koi.indexOf(k), 1);
  }

  private clearAll(fastFade: boolean) {
    for (const k of this.koi) {
      k.dying = true;
      if (fastFade) k.fade = Math.min(k.fade, 0.4);
    }
    for (const p of this.plants) {
      p.dying = true;
      if (fastFade) p.fade = Math.min(p.fade, 0.4);
    }
  }

  reset() {
    this.clearAll(true);
    this.populateStartingScene();
    this.splats = [];
    this.fluid.clear();
  }

  private liveCount(list: { dying: boolean }[]) {
    let n = 0;
    for (const i of list) if (!i.dying) n++;
    return n;
  }

  private retireOldest<T extends { dying: boolean; age: number }>(list: T[]) {
    let oldest: T | null = null;
    for (const item of list) if (!item.dying && (!oldest || item.age > oldest.age)) oldest = item;
    if (oldest) oldest.dying = true;
  }

  /** Creates one item at a world position; the oldest of that kind retires when capped. */
  spawn(kind: SpawnKind, x: number, y: number, rng: Rng = Math.random) {
    if (kind === "koi") {
      if (this.liveCount(this.koi) >= CAPS.koi) this.retireOldest(this.koi);
      const choices = KOI_VARIANTS.filter((v) => v !== this.lastVariant);
      const variant = choices[Math.floor(rng() * choices.length)];
      this.lastVariant = variant;
      const m = SAFE_INSET.fish + 0.04;
      const cx = clamp(x, m, POND_W - m);
      const cy = clamp(y, m, POND_H - m);
      const toCenter = Math.atan2(POND_H / 2 - cy, POND_W / 2 - cx);
      const heading = toCenter + (rng() - 0.5) * 1.8;
      return this.makeKoi(variant, cx, cy, heading, rng);
    }
    if (kind === "pad") {
      if (this.liveCount(this.plants.filter((p) => p.kind === "pad")) >= CAPS.pads) {
        this.retireOldest(this.plants.filter((p) => p.kind === "pad"));
      }
      const idx = Math.floor(rng() * this.assets.pads.length);
      const asset = this.assets.pads[idx];
      const d = clamp(asset.visibleWidth * 0.0009 * range(rng, 0.88, 1.12), 0.07, 0.3);
      return this.makePlant("pad", idx, d, x, y, rng);
    }
    if (this.liveCount(this.plants.filter((p) => p.kind === "lotus")) >= CAPS.lotus) {
      this.retireOldest(this.plants.filter((p) => p.kind === "lotus"));
    }
    const idx = Math.floor(rng() * this.assets.lotus.length);
    return this.makePlant("lotus", idx, range(rng, 0.19, 0.26), x, y, rng);
  }

  /** Probabilistic spawn used by taps: 65% koi, 25% lily pad, 10% lotus. */
  spawnRandom(x: number, y: number, rng: Rng = Math.random): SpawnKind {
    const r = rng();
    const kind: SpawnKind = r < SPAWN_ODDS.koi ? "koi" : r < SPAWN_ODDS.koi + SPAWN_ODDS.pad ? "pad" : "lotus";
    this.spawn(kind, x, y, rng);
    return kind;
  }

  /** True when a world position is on the (opaque) water, not in the faded margin. */
  isWater(x: number, y: number) {
    const t = SAFE_INSET.tap;
    return x >= t && x <= POND_W - t && y >= t && y <= POND_H - t;
  }

  clientToWorld(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: WORLD.x0 + ((clientX - rect.left) / rect.width) * WORLD.w,
      y: WORLD.y0 + ((clientY - rect.top) / rect.height) * WORLD.h,
    };
  }

  /* -------------------------------------------------------------- main loop */

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(now: number) {
    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const dt = clamp(rawDt, 0, 1 / 20);
    this.frameMs += (rawDt * 1000 - this.frameMs) * 0.05;
    this.adaptQuality();
    this.step(dt);
    this.render();
  }

  /** If the device cannot hold ~40fps, trade resolution (never artwork) for smoothness. */
  private adaptQuality() {
    if (this.frameMs > 26 && this.pixelRatio > 1) {
      this.slowFrames++;
      if (this.slowFrames > 45) {
        this.slowFrames = 0;
        this.qualityCap = Math.max(1, this.pixelRatio - 0.25);
        this.applyPixelRatio();
        this.frameMs = 16;
      }
    } else {
      this.slowFrames = 0;
    }
  }

  /** Advance simulation by dt seconds (also callable from tests to step deterministically). */
  step(dt: number) {
    const m = this.motion;
    this.time += dt;
    const ctx = { motion: m, others: this.koi };
    for (const k of this.koi) k.update(dt, ctx);
    for (const p of this.plants) p.update(dt, this.opts.reducedMotion || this.opts.still ? 0 : 1);
    for (const k of this.koi) k.writeMesh(this.time, m);
    this.addKoiWakes(dt);
    this.fluid.step(dt, this.splats.splice(0, MAX_SPLATS));
    this.compositeMaterial.uniforms.tFlow.value = this.fluid.texture;
    this.sweepDead();
  }

  /* ------------------------------------------------------------ interaction */

  /** Queue one disturbance of the water (also nudges nearby floating plants). */
  private pushSplat(s: Splat) {
    if (this.opts.still) return;
    const k = this.opts.reducedMotion ? 0.4 : 1;
    this.splats.push({ ...s, flow: s.flow * k, height: s.height * k });
    if (this.splats.length > MAX_SPLATS * 3) this.splats.splice(0, this.splats.length - MAX_SPLATS * 3);
  }

  /**
   * Stir the water along a pointer segment. Strength follows pointer speed, so a slow
   * hover barely moves the surface and a quick drag sets up a wider current and wake.
   */
  stirSegment(x0: number, y0: number, x1: number, y1: number, dt: number) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-5) return;
    // Normalise by on-screen size so the same finger speed stirs equally on a phone and a desktop.
    const screenScale = this.cssW / 900;
    const speed = Math.min((dist / Math.max(dt, 1 / 240)) * screenScale, 2.4);
    const vx = (dx / dist) * speed;
    const vy = (dy / dist) * speed;
    const radius = (0.05 + 0.03 * Math.min(1, speed / 1.5)) * clamp(900 / this.cssW, 1, 1.7);
    const n = Math.min(4, Math.max(1, Math.ceil(dist / (radius * 0.9))));
    const power = Math.min(1, speed / 1.2);
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const x = x0 + dx * f;
      const y = y0 + dy * f;
      if (x < 0.02 || x > POND_W - 0.02 || y < 0.02 || y > POND_H - 0.02) continue;
      this.pushSplat({ x, y, vx, vy, flow: 0.55 * power / Math.sqrt(n), height: -0.075 * power / Math.sqrt(n), radius });
    }
    const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    for (const p of this.plants) {
      const ddx = p.x - mid.x;
      const ddy = p.y - mid.y;
      const d = Math.hypot(ddx, ddy);
      const reach = p.radius + 0.1;
      if (d < reach) {
        const f = 1 - d / reach;
        p.nudge(vx * 0.05 * f, vy * 0.05 * f, ((ddx * vy - ddy * vx) / (d + 0.05)) * 0.12 * f);
      }
    }
  }

  /** A tap: gentle splash where the new item arrives, then create the item. */
  tap(x: number, y: number) {
    const kind = this.spawnRandom(x, y);
    this.pushSplat({ x, y, vx: 0, vy: 0, flow: 0, height: kind === "koi" ? -0.2 : -0.14, radius: 0.06 });
    return kind;
  }

  /** Keyboard / assistive path: add one item at a random spot on the water. */
  tapRandom() {
    return this.tap(range(Math.random, 0.3, POND_W - 0.3), range(Math.random, 0.25, POND_H - 0.25));
  }

  /** Swimming koi disturb the water very slightly, tying fish and surface together. */
  private addKoiWakes(dt: number) {
    if (this.motion === 0) return;
    this.wakeClock += dt;
    if (this.wakeClock < 0.12) return;
    this.wakeClock = 0;
    for (const k of this.koi) {
      if (k.dying || k.fade < 0.8) continue;
      const spine = k.getSpine();
      const tail = spine[spine.length - 5];
      const vx = Math.cos(k.heading) * k.speed;
      const vy = Math.sin(k.heading) * k.speed;
      this.pushSplat({ x: tail.x, y: tail.y, vx, vy, flow: 0.1, height: -0.012, radius: 0.045 });
    }
  }

  private sweepDead() {
    for (let i = this.koi.length - 1; i >= 0; i--) {
      const k = this.koi[i];
      if (k.dead) {
        this.underScene.remove(k.mesh);
        k.dispose();
        this.koi.splice(i, 1);
      }
    }
    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i];
      if (p.dead) {
        this.mainScene.remove(p.mesh);
        this.mainScene.remove(p.shadow);
        p.dispose();
        this.plants.splice(i, 1);
      }
    }
  }

  render() {
    const t = this.opts.still ? 0 : this.time;
    this.waterMaterial.uniforms.uTime.value = t;
    this.compositeMaterial.uniforms.uTime.value = t;

    this.renderer.setRenderTarget(this.underTarget);
    this.renderer.render(this.underScene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.mainScene, this.camera);
  }

  /** Debug: current peak flow / wave height in the water simulation. */
  fluidStats() {
    return this.fluid.stats();
  }

  /** Debug: scale the refraction (0 disables it) to isolate its effect in comparisons. */
  setRefraction(strength: number, ambient: number) {
    this.compositeMaterial.uniforms.uStrength.value = strength;
    this.compositeMaterial.uniforms.uAmbient.value = ambient;
  }

  /** Lightweight state snapshot for automated verification. */
  snapshot() {
    return {
      time: this.time,
      frameMs: this.frameMs,
      buffer: this.bufferSize,
      koi: this.koi.map((k) => ({
        dying: k.dying,
        fade: k.fade,
        x: k.x,
        y: k.y,
        heading: k.heading,
        length: k.params.length,
        spine: k.getSpine(),
        baseSpine: k.getBaseSpine(),
      })),
      plants: this.plants.map((p) => ({ kind: p.kind, dying: p.dying, fade: p.fade, x: p.x, y: p.y, r: p.radius })),
    };
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.resizeObserver?.disconnect();
    for (const k of this.koi) k.dispose();
    for (const p of this.plants) p.dispose();
    this.detachInput?.();
    this.fluid.dispose();
    this.underTarget.dispose();
    this.maskTarget.dispose();
    this.renderer.dispose();
  }
}
