/**
 * World space: x right, y down. The pond itself is POND_W x POND_H units; the canvas
 * extends MARGIN beyond it on every side so the soft, irregular edge has room to fade.
 */
export const POND_W = 1.6;
export const POND_H = 1.0;
export const MARGIN = 0.1;

export const WORLD = {
  x0: -MARGIN,
  y0: -MARGIN,
  x1: POND_W + MARGIN,
  y1: POND_H + MARGIN,
  w: POND_W + 2 * MARGIN,
  h: POND_H + 2 * MARGIN,
};

/** Inset from the pond rectangle inside which the painting is fully opaque. */
export const SAFE_INSET = {
  /** Koi heads stay inside this inset. */
  fish: 0.15,
  /** Floating plants (centre minus their radius) stay inside this inset. */
  plant: 0.11,
  /** Taps outside this inset are ignored (the faded edge is not "water"). */
  tap: 0.045,
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
