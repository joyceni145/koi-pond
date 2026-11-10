#!/usr/bin/env python3
"""Turn the raw generated paintings in tools/raw into transparent, game-ready assets.

Keying is done by colour unmixing against a flat chroma background rather than a hard
threshold, so translucent koi fins and soft watercolor edges keep their partial alpha.

Usage: python3 tools/process_assets.py [--preview]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "tools" / "raw"
OUT = ROOT / "public" / "assets"

KOI = ["kohaku", "sanke", "showa", "gold", "calico", "white"]

# Indices of lily pad components (see tools/_preview/pads_index.png) that are single,
# non-overlapping pads. Clusters of touching pads in the raw sheet are skipped.
PAD_KEEP = None  # filled automatically: components that look like single pads


def load(name):
    return np.asarray(Image.open(RAW / name).convert("RGB")).astype(np.float32)


def key_green(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    excess = g - np.maximum(r, b)
    border = np.concatenate([excess[:12].ravel(), excess[-12:].ravel(), excess[:, :12].ravel(), excess[:, -12:].ravel()])
    bg_excess = float(np.median(border))
    bg = np.median(
        np.concatenate([rgb[:12].reshape(-1, 3), rgb[-12:].reshape(-1, 3)]), axis=0
    )
    alpha = 1.0 - np.clip(excess / bg_excess, 0, 1)
    return alpha, bg


def key_magenta(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    excess = np.minimum(r, b) - g
    border = np.concatenate([excess[:12].ravel(), excess[-12:].ravel(), excess[:, :12].ravel(), excess[:, -12:].ravel()])
    bg_excess = float(np.median(border))
    bg = np.median(
        np.concatenate([rgb[:12].reshape(-1, 3), rgb[-12:].reshape(-1, 3)]), axis=0
    )
    alpha = 1.0 - np.clip(excess / bg_excess, 0, 1)
    return alpha, bg


def finish_alpha(alpha):
    # Squash JPEG noise in the background and the faintest halo, keep soft translucency.
    a = np.clip((alpha - 0.05) / 0.9, 0, 1)
    return a


def unmix(rgb, alpha, bg):
    a = np.maximum(alpha, 1e-3)[..., None]
    fg = (rgb - (1.0 - alpha[..., None]) * bg) / a
    return np.clip(fg, 0, 255)


def bleed(fg, alpha):
    """Fill colour under transparent pixels with the nearest opaque colour (no halos)."""
    solid = alpha > 0.5
    idx = ndi.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    return fg[idx[0], idx[1]]


def despill(fg, mode):
    """Remove residual key-colour contamination from edge pixels."""
    r, g, b = fg[..., 0], fg[..., 1], fg[..., 2]
    if mode == "magenta":
        m = np.maximum(np.minimum(r, b) - g, 0)
        r, b = r - m, b - m
    elif mode == "reed":
        # Thin botanical strokes are mostly edge pixels: force an olive/sepia palette.
        m = np.maximum(np.minimum(r, b) - g, 0)
        r, b = r - m, b - m
        b = np.minimum(b, g * 0.92)
        r = np.minimum(r, g * 1.45)
    else:
        gx = np.maximum(g - np.maximum(r, b), 0)
        g = g - gx
    return np.clip(np.dstack([r, g, b]), 0, 255)


def to_rgba(rgb, alpha, mode="green"):
    fg = unmix(rgb, alpha, BG_CACHE)
    fg = despill(fg, mode)
    fg = bleed(fg, alpha)
    out = np.dstack([fg, alpha * 255.0])
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


BG_CACHE = None


def keyed(name, mode):
    global BG_CACHE
    rgb = load(name)
    alpha, bg = (key_green if mode == "green" else key_magenta)(rgb)
    alpha = finish_alpha(alpha)
    BG_CACHE = bg
    return rgb, alpha


def bbox_of(mask, pad):
    ys, xs = np.where(mask)
    h, w = mask.shape
    return (
        max(xs.min() - pad, 0),
        max(ys.min() - pad, 0),
        min(xs.max() + pad + 1, w),
        min(ys.max() + pad + 1, h),
    )


def clean_mask(alpha, min_area):
    lab, n = ndi.label(alpha > 0.15, structure=np.ones((3, 3)))
    if n == 0:
        return alpha, lab, n
    areas = ndi.sum(np.ones_like(alpha), lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    for i, ar in enumerate(areas, start=1):
        keep[i] = ar >= min_area
    kill = ~keep[lab]
    alpha = alpha.copy()
    alpha[kill & (alpha < 0.9)] = 0
    alpha[kill] = 0
    return alpha, lab, n


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)


def process_koi():
    manifest = {}
    for name in KOI:
        rgb, alpha = keyed(f"koi_{name}_raw.jpg", "green")
        alpha, _, _ = clean_mask(alpha, 3000)
        # keep only the main fish (largest component) incl. detached fin tips nearby
        lab, n = ndi.label(ndi.binary_dilation(alpha > 0.15, iterations=6))
        sizes = ndi.sum(alpha > 0.15, lab, range(1, n + 1))
        main = 1 + int(np.argmax(sizes))
        alpha = np.where(lab == main, alpha, 0)
        img = to_rgba(rgb, alpha, "green")
        x0, y0, x1, y1 = bbox_of(alpha > 0.2, 6)
        img = img.crop((x0, y0, x1, y1))
        a = np.asarray(img)[..., 3].astype(np.float32) / 255.0
        h, w = a.shape

        # Column spans of the solid body
        solid = a > 0.5
        cols = np.arange(w)
        top = np.full(w, np.nan)
        bot = np.full(w, np.nan)
        for x in cols:
            ys = np.where(solid[:, x])[0]
            if ys.size:
                top[x], bot[x] = ys.min(), ys.max()
        valid = ~np.isnan(top)
        mid = np.where(valid, (top + bot) / 2, np.nan)
        half = np.where(valid, (bot - top) / 2, np.nan)
        # interpolate gaps
        def fill(v):
            ok = ~np.isnan(v)
            return np.interp(cols, cols[ok], v[ok])
        mid, half = fill(mid), fill(half)

        # Opening (min then max) removes fin bumps from the half-width, leaving the body.
        win = int(w * 0.10)
        body_half = ndi.maximum_filter1d(ndi.minimum_filter1d(half, win), win)
        body_half = ndi.uniform_filter1d(body_half, int(w * 0.04))

        # Spine: centre line from the body only (columns with no fin bump), then smoothed.
        is_body = half < body_half * 1.18
        spine = np.where(is_body, mid, np.nan)
        ok = ~np.isnan(spine)
        spine = np.interp(cols, cols[ok], spine[ok])
        spine = ndi.gaussian_filter1d(spine, w * 0.03)

        # Head is on the right in the paintings; find the real head tip and tail tip
        x_head = float(np.max(np.where(valid)))
        x_tail = float(np.min(np.where(valid)))
        L = x_head - x_tail

        n = 64
        s = np.linspace(0, 1, n)  # 0 = head, 1 = tail
        xs = x_head - s * L
        spine_s = np.interp(xs, cols, spine)
        half_s = np.interp(xs, cols, body_half)

        # Downscale for delivery
        target_w = 1100
        scale = min(1.0, target_w / w)
        out = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
        save(out, OUT / "koi" / f"{name}.png")
        manifest[name] = {
            "file": f"koi/{name}.png",
            "width": out.width,
            "height": out.height,
            "xHead": x_head * scale,
            "xTail": x_tail * scale,
            "spine": [round(float(v) * scale, 2) for v in spine_s],
            "halfWidth": [round(float(v) * scale, 2) for v in half_s],
        }
        print("koi", name, out.size)
    return manifest


def split_sheet(rgb, alpha, min_area, pad_frac=0.12, mode="green", merge=2, opening=2):
    solid = alpha > 0.5
    if opening:
        solid = ndi.binary_opening(solid, iterations=opening)
    lab, n = ndi.label(ndi.binary_dilation(solid, iterations=merge))
    img = to_rgba(rgb, alpha, mode)
    arr = np.asarray(img)
    pieces = []
    for i in range(1, n + 1):
        m = lab == i
        area = int(m.sum())
        if area < min_area:
            continue
        ys, xs = np.where(m)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        bw, bh = x1 - x0, y1 - y0
        pad = int(max(bw, bh) * pad_frac)
        px0, py0 = max(x0 - 4, 0), max(y0 - 4, 0)
        px1, py1 = min(x1 + 4, arr.shape[1]), min(y1 + 4, arr.shape[0])
        piece = arr[py0:py1, px0:px1].copy()
        # Remove other components' leftovers inside this crop
        mm = ndi.binary_dilation(m, iterations=6)[py0:py1, px0:px1]
        piece[..., 3] = np.where(mm, piece[..., 3], 0)
        im = Image.fromarray(piece, "RGBA")
        canvas = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
        # keep RGB bleed in the margin to avoid dark halos when mipmapped
        canvas.paste(im, (pad, pad))
        pieces.append((x0, y0, area, bw, bh, canvas))
    pieces.sort(key=lambda p: (p[1] // 150, p[0]))
    return pieces


def solidity(m):
    # area / convex-hull-ish via bbox ellipse ratio; clusters score high bbox/area ratios
    return m


def process_sheet(raw, mode, prefix, min_area, max_size, keep=None, preview=False, **kw):
    key_mode = "magenta" if mode == "reed" else mode
    rgb, alpha = keyed(raw, key_mode)
    pieces = split_sheet(rgb, alpha, min_area, mode=mode, **kw)
    meta = []
    prev = []
    for i, (x0, y0, area, bw, bh, canvas) in enumerate(pieces):
        prev.append((i, canvas, area, bw, bh))
    if preview:
        pdir = ROOT / "tools" / "_preview"
        pdir.mkdir(exist_ok=True)
        cell = 220
        cols = 6
        rows = (len(prev) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell, rows * cell), (60, 90, 120))
        from PIL import ImageDraw
        d = ImageDraw.Draw(sheet)
        for i, canvas, area, bw, bh in prev:
            t = canvas.copy()
            t.thumbnail((cell - 20, cell - 30))
            cx, cy = (i % cols) * cell, (i // cols) * cell
            sheet.paste(t, (cx + 10, cy + 20), t)
            d.text((cx + 6, cy + 4), f"#{i} a={area} {bw}x{bh}", fill=(255, 255, 255))
        sheet.save(pdir / f"{prefix}_index.png")
    out_meta = []
    count = 0
    for i, canvas, area, bw, bh in prev:
        if keep is not None and i not in keep:
            continue
        s = min(1.0, max_size / max(canvas.size))
        out = canvas.resize((max(1, round(canvas.width * s)), max(1, round(canvas.height * s))), Image.LANCZOS)
        name = f"{prefix}-{count}.png"
        save(out, OUT / prefix / name)
        # `bodyWidth` is the visible (unpadded) size in pixels, used to size sprites.
        pad_ratio = (canvas.width - bw) / canvas.width
        out_meta.append({
            "file": f"{prefix}/{name}",
            "width": out.width,
            "height": out.height,
            "visibleWidth": round(bw * s, 1),
            "visibleHeight": round(bh * s, 1),
        })
        count += 1
    print(prefix, count, "of", len(prev))
    return out_meta


def process_water():
    img = Image.open(RAW / "water_raw.jpg").convert("RGB")
    OUT.joinpath("water").mkdir(parents=True, exist_ok=True)
    img.save(OUT / "water" / "water.jpg", quality=92, optimize=True)
    print("water", img.size)


def make_paper():
    """Tileable warm paper grain used as a multiply overlay (fibres + tooth)."""
    rng = np.random.default_rng(7)
    n = 512
    def layer(sigma, amp):
        f = ndi.gaussian_filter(rng.standard_normal((n, n)), sigma, mode="wrap")
        return f / f.std() * amp
    tooth = layer(0.8, 1.0) * 0.55 + layer(2.2, 1.0) * 0.35 + layer(9.0, 1.0) * 0.25
    fibres = ndi.gaussian_filter(rng.standard_normal((n, n)), (0.6, 7.0), mode="wrap")
    fibres += ndi.gaussian_filter(rng.standard_normal((n, n)), (7.0, 0.6), mode="wrap")
    fibres = fibres / fibres.std() * 0.35
    v = 0.994 + (tooth + fibres) * 0.0085
    v = np.clip(v, 0.93, 1.0)
    rgb = np.dstack([v * 1.0, v * 0.985, v * 0.955])
    Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB").save(OUT / "paper.png", optimize=True)
    print("paper", n)


def main():
    preview = "--preview" in sys.argv
    manifest = {"koi": process_koi()}
    keep = json.loads((ROOT / "tools" / "keep.json").read_text()) if (ROOT / "tools" / "keep.json").exists() else {}
    manifest["pads"] = process_sheet("lilypads_raw.jpg", "magenta", "pads", 3500, 520, keep.get("pads"), preview)
    manifest["lotus"] = process_sheet("lotus_raw.jpg", "green", "lotus", 20000, 520, keep.get("lotus"), preview)
    manifest["reeds"] = process_sheet("reeds_raw.jpg", "reed", "reeds", 3000, 640, keep.get("reeds"), preview, merge=16, opening=0)
    process_water()
    make_paper()
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print("wrote manifest")


if __name__ == "__main__":
    main()
