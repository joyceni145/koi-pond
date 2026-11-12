/**
 * World space: x right, y down. The pond rectangle runs from (0, 0) to (POND.w, POND.h);
 * the canvas covers the whole viewport, so the world extends `pad` beyond the pond on every
 * side (exactly EDGE_PX of paper) and the soft, irregular edge bleeds into that margin.
 *
 * The pond is laid out to fill the viewport, so these values are live: `layoutWorld`
 * mutates them whenever the canvas is resized. Read them at use, never cache them.
 */

/** Paper left between the viewport edge and the pond, in CSS pixels. */
export const EDGE_PX = 40;

/** Smallest / largest number of CSS pixels that one world unit may span. */
const UNIT_MIN = 190;
const UNIT_MAX = 800;
/** One world unit is this fraction of the pond's shorter side: lower it to make everything on the pond smaller. */
const UNIT_SCALE = 0.8;

export const POND = { w: 1.6, h: 1.0 };

export const WORLD = {
  x0: 0,
  y0: 0,
  x1: 1.6,
  y1: 1.0,
  w: 1.6,
  h: 1.0,
  /** CSS pixels per world unit. Fish and plants are sized in world units, so this sets their on-screen size. */
  unit: 800,
  /** The paper margin in world units. */
  pad: EDGE_PX / 800,
};

/**
 * Fit the world to a canvas of `cssW` x `cssH` CSS pixels. The pond fills the canvas minus
 * EDGE_PX on every side. One world unit follows the pond's shorter side (up to a cap), so fish
 * keep a sensible size on a phone and on a very large display alike.
 */
export function layoutWorld(cssW: number, cssH: number) {
  const pondW = Math.max(1, cssW - 2 * EDGE_PX);
  const pondH = Math.max(1, cssH - 2 * EDGE_PX);
  const unit = Math.min(UNIT_MAX, Math.max(UNIT_MIN, Math.min(pondW, pondH) * UNIT_SCALE));
  const pad = EDGE_PX / unit;
  POND.w = pondW / unit;
  POND.h = pondH / unit;
  WORLD.unit = unit;
  WORLD.pad = pad;
  WORLD.x0 = -pad;
  WORLD.y0 = -pad;
  WORLD.x1 = POND.w + pad;
  WORLD.y1 = POND.h + pad;
  WORLD.w = POND.w + 2 * pad;
  WORLD.h = POND.h + 2 * pad;
}

/** Inset from the pond rectangle inside which the painting is fully opaque. */
export const SAFE_INSET = {
  /** Koi heads stay inside this inset. */
  fish: 0.17,
  /** Floating plants (centre minus their radius) stay inside this inset. */
  plant: 0.07,
  /** Taps outside this inset are ignored (the faded edge is not "water"). */
  tap: 0.02,
};

export const CAPS = {
  koi: 12,
  pads: 14,
  lotus: 6,
};

export const SPAWN_ODDS = { koi: 0.65, pad: 0.25, lotus: 0.1 };

export const FADE_IN_SECONDS = 1.6;
export const FADE_OUT_SECONDS = 1.1;

/** Mid water tone used to push submerged fish toward the pond colour. */
export const WATER_TINT: [number, number, number] = [0.1, 0.3, 0.42];

export const KOI_VARIANTS = ["kohaku", "sanke", "showa", "gold", "calico", "white"] as const;
export type KoiVariant = (typeof KOI_VARIANTS)[number];
