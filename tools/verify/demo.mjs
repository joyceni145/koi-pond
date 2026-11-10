// Scripted end-to-end session with real mouse events, rendered frame-by-frame into out/demo.mp4.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launch, openPond, advance, pause, OUT, sleep } from "./lib.mjs";

const FPS = 20;
const W = 1100, H = 720;
const dir = path.join(OUT, "demo-frames");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const browser = await launch();
try {
  const page = await openPond(browser, { query: "debug", width: W, height: H, dpr: 1 });
  await pause(page);
  const rect = await page.evaluate(() => { const c = document.querySelector(".pond-canvas").getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
  const at = (u, v) => ({ x: rect.x + u * rect.w, y: rect.y + v * rect.h });
  // pond-space (0..1.6 x 0..1) -> canvas fraction
  const pond = (x, y) => at((x + 0.1) / 1.8, (y + 0.1) / 1.2);
  const resetBtn = await page.evaluate(() => { const b = document.querySelector(".reset").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });

  const kinds = [];
  await page.evaluate(() => { const e = window.__pond; window.__kindQueue = []; const orig = e.spawn.bind(e); e.spawnRandom = (x, y) => { const k = window.__kindQueue.shift() || "koi"; orig(k, x, y); return k; }; });

  let frame = 0;
  const label = { text: "" };
  const snap = async () => {
    await page.evaluate((t) => { window.__pond.render(); }, label.text);
    await page.screenshot({ path: path.join(dir, `f${String(frame).padStart(4, "0")}.png`) });
    fs.appendFileSync(path.join(dir, "labels.txt"), `${frame}\t${label.text}\n`);
    frame++;
  };
  const idle = async (sec, text) => { label.text = text; for (let i = 0; i < sec * FPS; i++) { await advance(page, 1 / FPS, 60); await snap(); } };
  const moveAlong = async (sec, fn, text) => {
    label.text = text;
    const n = Math.round(sec * FPS);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const t = (i * 3 + k) / (n * 3);
        const p = fn(t);
        await page.mouse.move(p.x, p.y);
        await sleep(16);
      }
      await advance(page, 1 / FPS, 60);
      await snap();
    }
  };

  await idle(2.5, "three koi swimming");
  await page.mouse.move(...Object.values(pond(0.2, 0.5)));
  await moveAlong(3.2, (t) => pond(0.2 + 1.2 * t, 0.5 + 0.22 * Math.sin(t * Math.PI * 3)), "moving over the water stirs it (no click)");
  await idle(2.0, "the water settles");

  const tap = async (u, v, kind, text) => {
    page.evaluate((k) => window.__kindQueue.push(k), kind);
    const p = pond(u, v);
    await page.mouse.click(p.x, p.y);
    await idle(2.4, text);
  };
  await tap(0.45, 0.62, "koi", "tap: a new koi fades in and swims off");
  await tap(1.05, 0.38, "pad", "tap: a lily pad drifts in");
  await tap(0.8, 0.7, "lotus", "tap: an open lotus floats in");
  await moveAlong(2.2, (t) => pond(1.35 - 0.9 * t, 0.3 + 0.4 * t), "drag across the plants: they stay legible and drift");
  await idle(1.5, "");
  label.text = "Reset pond";
  await page.mouse.click(resetBtn.x, resetBtn.y);
  await idle(3.5, "Reset pond restores the starting scene");
  console.log("frames", frame);
} finally { await browser.close(); }

// captions
execFileSync("python3", ["-c", `
from PIL import Image, ImageDraw
import os
d='${dir}'
labels={}
for line in open(os.path.join(d,'labels.txt')):
    i,t=line.rstrip('\\n').split('\\t',1) if '\\t' in line else (line.strip(),'')
    labels[int(i)]=t
for i,t in labels.items():
    if not t: continue
    p=os.path.join(d,'f%04d.png'%i)
    im=Image.open(p).convert('RGB'); dr=ImageDraw.Draw(im)
    w=dr.textlength(t)
    dr.rectangle((14,12,14+w+16,34),fill=(250,247,240))
    dr.text((22,17),t,fill=(70,64,54))
    im.save(p)
`]);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", path.join(OUT, "demo.mp4")]);
console.log("wrote", path.join(OUT, "demo.mp4"));
