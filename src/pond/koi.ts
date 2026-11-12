import * as THREE from "three";
import type { KoiAsset } from "./assets";
import { FADE_IN_SECONDS, FADE_OUT_SECONDS, POND, SAFE_INSET, WATER_TINT } from "./constants";
import { angleDiff, clamp, smoothstep, TAU, type Rng, range } from "./math";
import { KOI_FRAG, KOI_VERT } from "./shaders";

/** Mesh resolution: columns run head -> tail along the spine, rows run across the body. */
const NX = 72;
const NY = 30;
/** Joints in the simulated spine chain. */
const NJ = 26;
/** Spacing of recorded head-path points (world units). */
const TRAIL_STEP = 0.005;

export interface KoiParams {
  length: number;
  speed: number;
  /** Tail-beat frequency in Hz at cruising speed. */
  beat: number;
  phase: number;
  depth: number;
  waveCycles: number;
}

export interface KoiContext {
  /** 0..1 scale for all motion (reduced-motion preference). */
  motion: number;
  others: Koi[];
}

interface ColumnRest {
  s: number;
  spineY: number;
  halfWidth: number;
}

/**
 * A koi is a textured, deformable mesh. The painting is mapped onto a grid whose columns
 * follow a simulated spine (head -> tail) and whose rows are offsets from that spine, so
 * every marking stays pinned to the same place on the body as it bends.
 */
export class Koi {
  readonly kind = "koi" as const;
  readonly asset: KoiAsset;
  readonly params: KoiParams;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  x: number;
  y: number;
  heading: number;
  speed: number;
  turnRate = 0;

  age = 0;
  fade = 0;
  dying = false;
  dead = false;

  /** Simulated chain (head first) and the same chain after the swimming wave is added. */
  private readonly joints = new Float32Array(NJ * 2);
  private readonly waved = new Float32Array(NJ * 2);
  private readonly segLen: number;
  /** Recorded head path (oldest first). Joints are placed at fixed arc lengths back along it. */
  private trailX: number[] = [];
  private trailY: number[] = [];
  private clock: number;
  private wanderA: number;
  private wanderB: number;
  private wanderC: number;
  private speedPhase: number;

  private readonly cols: ColumnRest[];
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly pxToWorld: number;
  private readonly lengthPx: number;
  private readonly rowY: Float32Array;

  /** Per-column curve samples for the current frame (position + right-hand normal). */
  private readonly colP = new Float32Array((NX + 1) * 2);
  private readonly colF = new Float32Array((NX + 1) * 2);

  constructor(asset: KoiAsset, params: KoiParams, x: number, y: number, heading: number, rng: Rng) {
    this.asset = asset;
    this.params = params;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = params.speed;
    this.clock = params.phase * 3.7;
    this.wanderA = rng() * TAU;
    this.wanderB = rng() * TAU;
    this.wanderC = rng() * TAU;
    this.speedPhase = rng() * TAU;

    this.segLen = params.length / (NJ - 1);
    this.lengthPx = asset.xHead - asset.xTail;
    this.pxToWorld = params.length / this.lengthPx;

    for (let i = 0; i < NJ; i++) {
      this.joints[i * 2] = x - Math.cos(heading) * this.segLen * i;
      this.joints[i * 2 + 1] = y - Math.sin(heading) * this.segLen * i;
    }
    this.waved.set(this.joints);
    const back = params.length * 1.25;
    for (let d = back; d > 0; d -= TRAIL_STEP) {
      this.trailX.push(x - Math.cos(heading) * d);
      this.trailY.push(y - Math.sin(heading) * d);
    }

    // Rest-pose column table, sampled from the extracted spine/body profile.
    const sMin = (asset.xHead - asset.width) / this.lengthPx;
    const sMax = asset.xHead / this.lengthPx;
    this.cols = [];
    for (let c = 0; c <= NX; c++) {
      const s = sMin + ((sMax - sMin) * c) / NX;
      const sc = clamp(s, 0, 1) * 63;
      const i0 = Math.min(62, Math.floor(sc));
      const f = sc - i0;
      this.cols.push({
        s,
        spineY: asset.spine[i0] * (1 - f) + asset.spine[i0 + 1] * f,
        halfWidth: asset.halfWidth[i0] * (1 - f) + asset.halfWidth[i0 + 1] * f,
      });
    }
    this.rowY = new Float32Array(NY + 1);
    for (let r = 0; r <= NY; r++) this.rowY[r] = (asset.height * r) / NY;

    const vertCount = (NX + 1) * (NY + 1);
    this.positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    for (let r = 0; r <= NY; r++) {
      for (let c = 0; c <= NX; c++) {
        const i = r * (NX + 1) + c;
        const px = asset.xHead - this.cols[c].s * this.lengthPx;
        uvs[i * 2] = px / asset.width;
        uvs[i * 2 + 1] = 1 - this.rowY[r] / asset.height;
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < NY; r++) {
      for (let c = 0; c < NX; c++) {
        const a = r * (NX + 1) + c;
        const b = a + 1;
        const d = a + (NX + 1);
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", posAttr);
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(idx);

    this.material = new THREE.ShaderMaterial({
      vertexShader: KOI_VERT,
      fragmentShader: KOI_FRAG,
      uniforms: {
        tMap: { value: asset.texture },
        uFade: { value: 0 },
        uDepth: { value: params.depth },
        uTint: { value: new THREE.Vector3(...WATER_TINT) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10 + Math.round((1 - params.depth) * 20);

    this.writeMesh(0, 1);
  }

  /** Advance the swimming simulation: steering, spine chain, fade. */
  update(dt: number, ctx: KoiContext) {
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

    const m = ctx.motion;
    const t = this.age;
    const p = this.params;

    // Relaxed wandering: two slow, incommensurate sinusoids drive the turn rate.
    let want =
      0.42 * Math.sin(t * 0.21 + this.wanderA) +
      0.28 * Math.sin(t * 0.37 + this.wanderB) +
      0.12 * Math.sin(t * 0.83 + this.wanderC);

    // Keep a courteous distance from other koi that swim at a similar depth.
    for (const o of ctx.others) {
      if (o === this || o.dying) continue;
      const dx = o.x - this.x;
      const dy = o.y - this.y;
      const d = Math.hypot(dx, dy);
      const sameLayer = 0.4 + 0.6 * (1 - smoothstep(0.15, 0.55, Math.abs(o.params.depth - p.depth)));
      const R = 0.2 + (p.length + o.params.length) * 0.3;
      if (d < R && d > 1e-4 && sameLayer > 0) {
        const rel = angleDiff(this.heading, Math.atan2(dy, dx));
        if (Math.abs(rel) < 2.1) {
          const push = (1 - d / R) * 1.6 * sameLayer;
          want += (rel >= 0 ? -1 : 1) * push;
        }
      }
    }
    want = clamp(want, -0.95, 0.95);

    // Steer away from the faded edge. A probe point ahead of the head lets the fish begin a
    // wide, relaxed turn early; this takes priority over wandering and courtesy.
    const inset = SAFE_INSET.fish;
    const bx0 = inset, bx1 = POND.w - inset, by0 = inset, by1 = POND.h - inset;
    const turnRadius = p.length / 2.1;
    const look = turnRadius * 1.55 + 0.1;
    const px = this.x + Math.cos(this.heading) * look;
    const py = this.y + Math.sin(this.heading) * look;
    const penAhead = Math.max(bx0 - px, px - bx1, by0 - py, py - by1, 0);
    const penHere = Math.max(bx0 - this.x, this.x - bx1, by0 - this.y, this.y - by1, 0);
    const wall = Math.max(smoothstep(0, 0.06, penAhead), smoothstep(0, 0.04, penHere));
    if (wall > 0) {
      const toCenter = Math.atan2(POND.h * 0.5 - this.y, POND.w * 0.5 - this.x);
      const diff = angleDiff(this.heading, toCenter);
      want = want * (1 - wall) + clamp(diff * 2.4, -1.5, 1.5) * wall;
    }
    // A koi's body can only bend so far: cap path curvature relative to body length so the
    // spine always bends into a smooth arc instead of folding into a C.
    const kappa = (1.35 + 0.75 * wall) / p.length;
    const maxRate = Math.max(0.1, Math.max(this.speed, p.speed * 0.6) * kappa);
    want = clamp(want, -maxRate, maxRate);
    // Angular inertia makes turns begin and end smoothly.
    this.turnRate += (want - this.turnRate) * Math.min(1, dt * (1.6 + 3.0 * wall));
    this.heading += this.turnRate * dt * m;

    // Speed breathes gently and eases off through tight turns.
    const breathe = 1 + 0.16 * Math.sin(t * 0.33 + this.speedPhase);
    const tight = 1 - 0.28 * Math.min(1, Math.abs(this.turnRate) / 0.95);
    const target = p.speed * breathe * tight * m;
    this.speed += (target - this.speed) * Math.min(1, dt * 1.2);

    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;
    // Soft backstop: a spring eases the head back inside the safe zone if steering (e.g. in a
    // crowded pond) ever lets it drift out, so no fish ever reaches the faded boundary.
    const pull = Math.min(1, dt * 4.5);
    this.x += (clamp(this.x, bx0, bx1) - this.x) * pull;
    this.y += (clamp(this.y, by0, by1) - this.y) * pull;

    // Beat frequency follows swimming speed so a faster fish flicks its tail faster.
    const speedRatio = p.speed > 0 ? clamp(this.speed / p.speed, 0.2, 1.4) : 1;
    this.clock += dt * p.beat * (0.55 + 0.45 * speedRatio) * m;

    this.updateChain();
  }

  /**
   * The pond changed shape (window resize or rotation): carry the fish along with it, keeping its
   * relative place in the water. Joints are re-derived from the trail every frame, so the body
   * re-lays itself along the scaled path.
   */
  remap(fx: number, fy: number) {
    this.x *= fx;
    this.y *= fy;
    this.heading = Math.atan2(Math.sin(this.heading) * fy, Math.cos(this.heading) * fx);
    for (let i = 0; i < this.trailX.length; i++) {
      this.trailX[i] *= fx;
      this.trailY[i] *= fy;
    }
    this.updateChain();
  }

  /**
   * The body follows the exact path the head has swum: each joint sits a fixed arc length
   * behind the head along that path, so the tail can never swing outside where the head went.
   */
  private updateChain() {
    const J = this.joints;
    const tx = this.trailX, ty = this.trailY;
    let n = tx.length;
    const lastX = n ? tx[n - 1] : this.x, lastY = n ? ty[n - 1] : this.y;
    if (Math.hypot(this.x - lastX, this.y - lastY) >= TRAIL_STEP) {
      tx.push(this.x);
      ty.push(this.y);
      n++;
    }
    J[0] = this.x;
    J[1] = this.y;
    let px = this.x, py = this.y;
    let k = n - 1;
    let carried = 0;
    for (let i = 1; i < NJ; i++) {
      const target = this.segLen * i;
      for (;;) {
        if (k < 0) {
          // Ran out of recorded path (only possible right after spawning): hold the oldest point.
          J[i * 2] = px;
          J[i * 2 + 1] = py;
          break;
        }
        const qx = tx[k], qy = ty[k];
        const d = Math.hypot(qx - px, qy - py);
        if (carried + d >= target) {
          const f = d > 1e-9 ? (target - carried) / d : 0;
          J[i * 2] = px + (qx - px) * f;
          J[i * 2 + 1] = py + (qy - py) * f;
          break;
        }
        carried += d;
        px = qx;
        py = qy;
        k--;
      }
      // continue the search from this joint's position
      px = J[i * 2];
      py = J[i * 2 + 1];
      carried = target;
      // `k` already points at the first trail point behind px,py (or the one just consumed)
    }
    // Drop path older than the body needs.
    const keepLen = this.params.length * 1.3;
    let acc = 0;
    let cut = 0;
    for (let q = n - 1; q > 0; q--) {
      acc += Math.hypot(tx[q] - tx[q - 1], ty[q] - ty[q - 1]);
      if (acc > keepLen) {
        cut = q - 1;
        break;
      }
    }
    if (cut > 0) {
      tx.splice(0, cut);
      ty.splice(0, cut);
    }
    // One light smoothing pass removes the faceting of the polyline path.
    for (let i = 1; i < NJ - 1; i++) {
      J[i * 2] = J[i * 2] * 0.5 + (J[(i - 1) * 2] + J[(i + 1) * 2]) * 0.25;
      J[i * 2 + 1] = J[i * 2 + 1] * 0.5 + (J[(i - 1) * 2 + 1] + J[(i + 1) * 2 + 1]) * 0.25;
    }
  }

  /** Catmull-Rom sample of the waved spine at fractional joint index `f` in [0, NJ-1]. */
  private sampleSpine(f: number, outP: Float32Array, outF: Float32Array, o: number) {
    const W = this.waved;
    const i1 = Math.min(NJ - 2, Math.max(0, Math.floor(f)));
    const u = f - i1;
    const i0 = Math.max(0, i1 - 1);
    const i2 = i1 + 1;
    const i3 = Math.min(NJ - 1, i2 + 1);
    const u2 = u * u;
    const u3 = u2 * u;
    for (let k = 0; k < 2; k++) {
      const p0 = W[i0 * 2 + k], p1 = W[i1 * 2 + k], p2 = W[i2 * 2 + k], p3 = W[i3 * 2 + k];
      outP[o * 2 + k] = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
      // derivative wrt f; spine runs head -> tail so the fish's forward direction is its negative
      const d = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u2);
      outF[o * 2 + k] = -d;
    }
    const fx = outF[o * 2], fy = outF[o * 2 + 1];
    const l = Math.hypot(fx, fy) || 1;
    outF[o * 2] = fx / l;
    outF[o * 2 + 1] = fy / l;
  }

  /**
   * Rebuild the vertex positions for this frame. `time` drives fin flutter; `motion`
   * (0..1) scales every oscillation for reduced-motion users.
   */
  writeMesh(time: number, motion: number) {
    const L = this.params.length;
    const p = this.params;
    const J = this.joints;
    const Wv = this.waved;

    // 1) Add the travelling body wave. Quiet near the head, strong toward the tail.
    for (let i = 0; i < NJ; i++) {
      const a = J[Math.max(0, i - 1) * 2] - J[Math.min(NJ - 1, i + 1) * 2];
      const b = J[Math.max(0, i - 1) * 2 + 1] - J[Math.min(NJ - 1, i + 1) * 2 + 1];
      const l = Math.hypot(a, b) || 1;
      const fx = a / l, fy = b / l;
      const s = i / (NJ - 1);
      const env = 0.035 + 0.965 * Math.pow(s, 1.85);
      const amp = L * 0.082 * env * motion;
      const off = amp * Math.sin(TAU * (p.waveCycles * s - this.clock) + p.phase);
      // right-hand normal of forward direction (y-down world)
      Wv[i * 2] = J[i * 2] - fy * off;
      Wv[i * 2 + 1] = J[i * 2 + 1] + fx * off;
    }

    // 2) Evaluate the curve once per mesh column.
    for (let c = 0; c <= NX; c++) {
      const s = this.cols[c].s;
      if (s < 0) {
        // beyond the head: extend straight along the head's forward direction
        this.sampleSpine(0, this.colP, this.colF, c);
        this.colP[c * 2] -= this.colF[c * 2] * s * L;
        this.colP[c * 2 + 1] -= this.colF[c * 2 + 1] * s * L;
      } else if (s > 1) {
        this.sampleSpine(NJ - 1, this.colP, this.colF, c);
        this.colP[c * 2] -= this.colF[c * 2] * (s - 1) * L;
        this.colP[c * 2 + 1] -= this.colF[c * 2 + 1] * (s - 1) * L;
      } else {
        this.sampleSpine(s * (NJ - 1), this.colP, this.colF, c);
      }
    }

    // 3) Lay out vertices: spine point + signed offset along the right-hand normal, with
    //    extra, localised displacement on the fins so they flutter independently.
    const k = this.pxToWorld;
    const H = this.asset.height;
    const tt = time * motion;
    const pos = this.positions;
    const flap = 0.5;
    const tailBeat = this.clock * TAU;
    for (let r = 0; r <= NY; r++) {
      const yPx = this.rowY[r];
      for (let c = 0; c <= NX; c++) {
        const col = this.cols[c];
        const vPx = yPx - col.spineY;
        const fx = this.colF[c * 2], fy = this.colF[c * 2 + 1];
        const rx = -fy, ry = fx;
        let dxw = rx * vPx * k;
        let dyw = ry * vPx * k;

        const absV = Math.abs(vPx);
        const out = absV - col.halfWidth * 1.12;
        if (out > 0 && motion > 0) {
          const finW = smoothstep(0, 14, out);
          const reach = Math.min(1, out / (H * 0.32));
          const side = vPx > 0 ? 1 : -1;
          const s = col.s;
          // Pectoral and pelvic fins: slow open/close flap plus a little backward sweep.
          const wFin = smoothstep(0.06, 0.16, s) * (1 - smoothstep(0.62, 0.74, s));
          // Caudal fin: lags the tail and ripples at its trailing edge.
          const wTail = smoothstep(0.74, 0.9, s);
          let dn = 0;
          let dtan = 0;
          if (wFin > 0) {
            const ph = TAU * flap * tt + side * 1.35 + s * 6.0;
            dn += side * reach * L * 0.055 * Math.sin(ph) * wFin;
            dtan += -reach * L * 0.04 * Math.sin(ph + 0.9) * wFin;
          }
          if (wTail > 0) {
            dn += reach * L * 0.032 * Math.sin(tailBeat - TAU * p.waveCycles * s - 0.9 + p.phase) * wTail;
            dtan += reach * L * 0.012 * Math.sin(tailBeat * 2 - 1.2 + out * 0.08) * wTail;
          }
          // Fine edge ripple on all translucent fin tissue.
          dn += side * L * 0.008 * Math.sin(TAU * 1.5 * tt + out * 0.11 + s * 9 + side) * reach;
          dxw += (rx * dn + fx * dtan) * finW;
          dyw += (ry * dn + fy * dtan) * finW;
        }

        const i = (r * (NX + 1) + c) * 3;
        pos[i] = this.colP[c * 2] + dxw;
        pos[i + 1] = this.colP[c * 2 + 1] + dyw;
        pos[i + 2] = 0;
      }
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.material.uniforms.uFade.value = this.fade;
  }

  /** Head, mid and tail positions of the animated spine (used by tests/telemetry). */
  getSpine(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < NJ; i++) out.push({ x: this.waved[i * 2], y: this.waved[i * 2 + 1] });
    return out;
  }

  /** The follow-the-leader chain before the body wave is added. */
  getBaseSpine(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < NJ; i++) out.push({ x: this.joints[i * 2], y: this.joints[i * 2 + 1] });
    return out;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export function randomKoiParams(rng: Rng, length?: number): KoiParams {
  // A mixed school: mostly young and middling fish, with the odd big old one.
  const len = length ?? 0.15 + 0.32 * Math.pow(rng(), 1.3);
  return {
    length: len,
    // Larger koi cruise a touch faster in absolute terms, but slower relative to length.
    speed: range(rng, 0.07, 0.12) * (0.85 + len),
    beat: range(rng, 0.8, 1.15),
    phase: rng() * TAU,
    depth: range(rng, 0.0, 1.0),
    waveCycles: range(rng, 0.72, 0.95),
  };
}
