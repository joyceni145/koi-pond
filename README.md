# Koi Pond

A quiet, interactive watercolor koi pond for the web, built with React, TypeScript and WebGL (three.js).
No backend, accounts or database.

- Painted, transparent watercolor artwork: water, six koi varieties, lily pads, lotus flowers and reeds.
- Koi are **deformable textured meshes**: the painting itself bends, so markings stay attached to the body.
- Pointer movement stirs a **GPU fluid simulation** that refracts the water *and* the submerged koi together.
- Floating pads and lotus flowers sit above everything, hide the fish beneath them and stay legible.
- Tap to add a koi (65%), lily pad (25%) or opened lotus (10%). Reset restores the opening scene.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-checks, then builds to dist/ (relative base: GitHub Pages friendly)
npm run preview
```

Query flags for development: `?debug` exposes `window.__pond`, `?solo` shows one koi and no plants,
`?still` freezes everything at the painted rest pose.

## How it is built

Render order (back to front), in `src/pond/engine.ts`:

1. **Underwater pass** (to an offscreen texture): layered painted water + animated koi meshes.
2. **Surface pass**: samples that texture through the fluid's flow and wave gradient (refraction), adds a faint
   water tint, a trace of chromatic dispersion and a soft sheen.
3. **Floating plants**: soft contact shadow, then the lily pad / lotus sprite, unrefracted.
4. **Pond mask**: an irregular, watercolor-bled transparency mask (baked once per resize) fades the pond into the paper.

The page paper tone and grain are CSS; reeds are painted sprites placed in the DOM with a very slow sway.

| Path | Role |
| --- | --- |
| `src/pond/koi.ts` | Koi mesh deformation, steering and spine model |
| `src/pond/fluid.ts` | Ping-pong half-float flow + damped wave field |
| `src/pond/plants.ts` | Floating lily pads and lotus flowers |
| `src/pond/engine.ts` | Renderer, passes, spawning, caps, input hooks |
| `src/pond/input.ts` | Pointer handling, tap vs drag |
| `src/pond/shaders.ts` | All GLSL (water, koi, composite, mask) |
| `src/components/` | React shell (canvas host, reeds) |
| `tools/process_assets.py` | Keys and slices the raw paintings into transparent assets |
| `tools/raw/` | The original generated paintings (inputs to the script) |
| `tools/verify/` | Browser-driven verification scripts (see below) |

### Koi animation

Each koi is a 73 x 31 vertex grid textured with the painting. Columns follow a spine that runs head to tail;
rows are offsets from that spine, so the painting is re-laid along a curve instead of being rotated as a rigid image.

- **Path**: the head wanders on a relaxed curve (two slow, incommensurate sinusoids) and steers away from the edge using
  a look-ahead probe sized from the fish's turning radius. Path curvature is capped relative to body length so the
  body always bends into a smooth arc. Every joint sits a fixed arc length behind the head along the head's own path, so the tail can never
  swing outside where the head has been.
- **Body wave**: a sinusoid travels toward the tail with amplitude `0.035 + 0.965 s^1.85`, so the head is nearly still and the tail sweeps.
- **Fins**: vertices outside the body width (found from the painting's extracted half-width profile) get extra
  displacement. Pectoral and pelvic fins open and close and sweep back, the caudal fin lags the spine and ripples at its edge.
- **Variation**: each koi has its own size, cruising speed, beat frequency, wave phase and depth. Depth sets draw order and how
  strongly the fish is tinted toward the water colour (submerged, softer contrast).

### Water interaction

`fluid.ts` keeps a 320 x 213 RGBA half-float field: flow velocity (self-advected, diffused, decaying) and a damped
wave-height field with extra viscosity so a disturbance blooms and dissolves instead of travelling as a crisp ring.
Pointer motion injects flow along its direction; strength follows pointer speed and is normalised by canvas size so a phone and a desktop feel alike.
The surface pass displaces the underwater image by the flow and wave gradient. Floating plants are drawn after it, so they are not refracted; they get
a small physical nudge from nearby stirring instead. Koi tails add a barely-there wake.

Tap vs drag: a press that ends within ~550 ms and a few pixels of its start (6 px mouse, 10 px touch) is a tap and adds an item.
Anything that travels further is a drag and only stirs. Mouse hover also stirs. Taps on the faded margin are ignored.

### Caps and motion preferences

Caps: 12 koi, 14 lily pads, 6 lotus flowers. At a cap, the oldest item of that kind fades out as the new one fades in.
The pixel ratio is capped (2x, ~3.4 MP) and steps down automatically if the frame rate stays low.
With `prefers-reduced-motion`, koi swim at 40% speed with a gentler wave, ambient shimmer is off, refraction and stirring are weaker, plants stop bobbing and reeds stop swaying.
The canvas is keyboard-focusable: Enter or Space adds an item.

## Artwork

All artwork was generated with an image model from prompts modelled on the supplied reference sheet, then processed locally:
koi and lotus were painted on flat green, lily pads and reeds on flat magenta. `tools/process_assets.py` keys them by **colour unmixing**
(not a hard threshold), so translucent fins and soft pigment edges keep partial alpha. It also despills the key colour, bleeds edge colour,
slices the sheets into individual cut-outs (dropping touching pads), and extracts each koi's spine and body-width profile.
Re-run it with `npm run assets` (needs Python with Pillow, NumPy and SciPy).

No reference sheet, grey background, labels or rectangular crops are displayed.

## Verification

`tools/verify/*.mjs` drive a real headless Chrome through `puppeteer-core` (set `CHROME=/path/to/chrome`, start `npm run dev`):

| Script | Checks |
| --- | --- |
| `stage1.mjs`, `zoom.mjs` | Static composition and artwork fidelity at several sizes |
| `closeup.mjs`, `stage2.mjs` | Frame strips of a swimming koi (bending, markings attached, tail) |
| `wave.mjs` | Numeric: wave amplitude grows head to tail, phase lag travels toward the tail, segment length stays constant, joint kink angle |
| `bounds.mjs` | 5 simulated minutes with 3 and 12 koi: heads and bodies stay inside the opaque water |
| `occlusion.mjs` | A pad and lotus placed over swimming koi, compared with the plants hidden |
| `stage3.mjs`, `settle.mjs`, `splash.mjs` | Fluid response, settling curve, refraction-only difference maps |
| `interaction.mjs` | Real mouse and touch events: tap, drag, long press, odds, caps, margin, reset, reduced motion |
| `practical.mjs` | Layouts for phone/tablet/wide viewports, live resize, CPU cost at the caps |
| `demo.mjs` | Scripted end-to-end session rendered to `out/demo.mp4` |

## Known limitations

- Verified in headless Chrome using **software WebGL (SwiftShader)**, so GPU frame rates were not measured. The simulation, skinning and
  scene update cost about 1.5 ms of JavaScript per frame at the object caps; the GPU work is five full-canvas passes at most plus a 320 x 213 simulation.
- The generated koi, lotus and pad art is fixed-resolution (koi 1100 px long, lotus about 280 px across); very large or high-DPI displays will show it softly.
- The lotus paintings are three-quarter views, not strictly top-down, and are only rotated a little so they stay upright.
- On landscape phones the pond is small because the layout is height-limited.
- Distortion of fish and water is intentionally subtle; it is best judged in motion rather than in stills.
