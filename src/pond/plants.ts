import * as THREE from "three";
import type { SpriteAsset } from "./assets";
import { FADE_IN_SECONDS, FADE_OUT_SECONDS, POND, SAFE_INSET } from "./constants";
import { clamp, TAU, type Rng } from "./math";
import { SHADOW_FRAG, SPRITE_FRAG, SPRITE_VERT } from "./shaders";

let sharedGeometry: THREE.BufferGeometry | null = null;

/** Unit quad in y-down world space with image-upright UVs. */
function spriteGeometry() {
  if (sharedGeometry) return sharedGeometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3),
  );
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  sharedGeometry = g;
  return g;
}

/** The fastest a plant drifts (world units / s) and turns (rad / s) when stirred. */
const MAX_DRIFT = 0.1;
const MAX_SPIN = 0.55;

export type PlantKind = "pad" | "lotus";

/** A lily pad or lotus flower that floats above the koi, bobbing and drifting softly. */
export class Plant {
  readonly kind: PlantKind;
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;

  /** Anchor position; the visible position adds a slow wander on top. */
  x: number;
  y: number;
  readonly radius: number;
  private vx = 0;
  private vy = 0;
  /** Push from the cursor that the plant's real velocity eases toward, so it starts to move softly. */
  private pushX = 0;
  private pushY = 0;
  private rot: number;
  private spin = 0;
  private readonly quadW: number;
  private readonly quadH: number;
  private readonly phase: number[];
  private readonly wander: number;
  private readonly material: THREE.ShaderMaterial;
  private readonly shadowMaterial: THREE.ShaderMaterial;

  age = 0;
  fade = 0;
  dying = false;
  dead = false;

  constructor(kind: PlantKind, asset: SpriteAsset, diameter: number, x: number, y: number, rng: Rng) {
    this.kind = kind;
    const k = diameter / asset.visibleWidth;
    this.quadW = asset.width * k;
    this.quadH = asset.height * k;
    this.radius = (Math.max(asset.visibleWidth, asset.visibleHeight) * k) / 2;
    this.rot = kind === "pad" ? rng() * TAU : (rng() - 0.5) * 0.7;
    this.phase = [rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU, rng() * TAU];
    this.wander = 0.5 + rng() * 0.7;

    this.material = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      uniforms: { tMap: { value: asset.texture }, uFade: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.shadowMaterial = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: {
        tMap: { value: asset.texture },
        uFade: { value: 0 },
        uStrength: { value: kind === "pad" ? 0.34 : 0.3 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(spriteGeometry(), this.material);
    this.shadow = new THREE.Mesh(spriteGeometry(), this.shadowMaterial);
    this.mesh.frustumCulled = false;
    this.shadow.frustumCulled = false;
    const order = kind === "lotus" ? 60 : 40;
    this.mesh.renderOrder = order + Math.floor(rng() * 10);
    this.shadow.renderOrder = 30;

    this.x = x;
    this.y = y;
    this.clampInside();
    this.apply(0, 1);
  }

  /** Push the plant (called when the water is stirred nearby). */
  nudge(dx: number, dy: number, spin: number) {
    this.pushX += dx;
    this.pushY += dy;
    // However hard or often the cursor sweeps past, the plant only ever drifts and turns slowly.
    const sp = Math.hypot(this.pushX, this.pushY);
    if (sp > MAX_DRIFT) {
      this.pushX *= MAX_DRIFT / sp;
      this.pushY *= MAX_DRIFT / sp;
    }
    this.spin = clamp(this.spin + spin, -MAX_SPIN, MAX_SPIN);
  }

  /** The pond changed shape: keep the plant at the same relative place in the water. */
  remap(fx: number, fy: number) {
    this.x *= fx;
    this.y *= fy;
    this.clampInside();
  }

  private clampInside() {
    const m = SAFE_INSET.plant + this.radius * 0.85;
    this.x = clamp(this.x, m, POND.w - m);
    this.y = clamp(this.y, m, POND.h - m);
  }

  update(dt: number, motion: number) {
    this.age += dt;
    if (this.dying) {
      this.fade -= dt / FADE_OUT_SECONDS;
      if (this.fade <= 0) {
        this.fade = 0;
        this.dead = true;
      }
    } else if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / FADE_IN_SECONDS);
    }

    // Stirred plants ease into a slow drift on the current, then gently come to rest.
    const ease = 1 - Math.exp(-dt * 3);
    this.vx += (this.pushX - this.vx) * ease;
    this.vy += (this.pushY - this.vy) * ease;
    const fadePush = Math.exp(-dt * 2.5);
    this.pushX *= fadePush;
    this.pushY *= fadePush;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const damp = Math.exp(-dt * 1.1);
    this.vx *= damp;
    this.vy *= damp;
    this.rot += this.spin * dt;
    this.spin *= Math.exp(-dt * 1.2);
    this.clampInside();
    this.apply(this.age, motion);
  }

  private apply(t: number, motion: number) {
    const ph = this.phase;
    const w = this.wander;
    const m = motion;
    const wx = (Math.sin(t * 0.17 * w + ph[0]) + 0.5 * Math.sin(t * 0.29 * w + ph[1])) * 0.0055 * m;
    const wy = (Math.cos(t * 0.15 * w + ph[2]) + 0.5 * Math.sin(t * 0.23 * w + ph[3])) * 0.0055 * m;
    const bob = Math.sin(t * (this.kind === "lotus" ? 0.62 : 0.5) + ph[4]);
    const sc = 1 + bob * 0.014 * m;
    const tilt = Math.sin(t * 0.21 * w + ph[1]) * 0.035 * m;

    const px = this.x + wx;
    const py = this.y + wy;
    this.mesh.position.set(px, py, 0);
    this.mesh.rotation.z = this.rot + tilt;
    this.mesh.scale.set(this.quadW * sc, this.quadH * sc, 1);

    // The shadow slides away from the light and softens as the plant bobs "up".
    const lift = 0.5 + 0.5 * bob;
    const off = 0.012 + 0.006 * lift * m;
    this.shadow.position.set(px + off * 0.7, py + off, 0);
    this.shadow.rotation.z = this.rot + tilt;
    this.shadow.scale.set(this.quadW * sc * 1.03, this.quadH * sc * 1.03, 1);

    this.material.uniforms.uFade.value = this.fade;
    this.shadowMaterial.uniforms.uFade.value = this.fade;
  }

  dispose() {
    this.material.dispose();
    this.shadowMaterial.dispose();
  }
}
