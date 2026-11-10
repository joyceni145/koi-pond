// Stage 2 review: one koi swimming. Captures frames following the fish, a contact sheet,
// and numeric spine metrics (wave travels head->tail, amplitude grows toward the tail).
import fs from "node:fs";
import path from "node:path";
import { launch, openPond, advance, pause, OUT } from "./lib.mjs";

const SECONDS = Number(process.env.SECONDS || 14);
const FPS = Number(process.env.FPS || 12);
const browser = await launch();
try {
  const page = await openPond(browser, { query: "debug&solo", width: 1280, height: 800, dpr: 1.5 });
  await pause(page);
  await advance(page, 2.5);
  const dir = path.join(OUT, "stage2-frames");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const metrics = [];
  const n = SECONDS * FPS;
  for (let i = 0; i < n; i++) {
    await advance(page, 1 / FPS, 60);
    const info = await page.evaluate(() => {
      const e = window.__pond;
      const c = document.querySelector(".pond-canvas").getBoundingClientRect();
      const k = e.koi[0];
      const W = { x0: -0.1, y0: -0.1, w: 1.8, h: 1.2 };
      const toPx = (p) => ({ x: c.x + ((p.x - W.x0) / W.w) * c.width, y: c.y + ((p.y - W.y0) / W.h) * c.height });
      const spine = k.getSpine();
      return { head: toPx({ x: k.x, y: k.y }), spine, L: k.params.length, heading: k.heading, canvas: { w: c.width } };
    });
    const R = 230;
    await page.screenshot({
      path: path.join(dir, `f${String(i).padStart(4, "0")}.png`),
      clip: { x: Math.max(0, info.head.x - R), y: Math.max(0, info.head.y - R * 0.8), width: R * 2, height: R * 1.6 },
    });
    // metrics: lateral deviation of each joint from the straight head->tail chord
    const s = info.spine;
    const a = s[0], b = s[s.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    const dev = s.map((p) => ((p.x - a.x) * -dy + (p.y - a.y) * dx) / d / info.L);
    metrics.push({ t: (i + 1) / FPS, dev, chord: d / info.L });
  }
  // wave amplitude per body station over the whole run
  const stations = metrics[0].dev.length;
  const amp = Array.from({ length: stations }, (_, j) => {
    const v = metrics.map((m) => m.dev[j]);
    return Math.max(...v) - Math.min(...v);
  });
  console.log("peak-to-peak lateral amplitude / body length at stations head->tail:");
  console.log(amp.filter((_, j) => j % 5 === 0 || j === stations - 1).map((v) => v.toFixed(3)).join("  "));
  console.log("chord/length min,max:", Math.min(...metrics.map((m) => m.chord)).toFixed(3), Math.max(...metrics.map((m) => m.chord)).toFixed(3));
  fs.writeFileSync(path.join(OUT, "stage2-metrics.json"), JSON.stringify({ amp, metrics }, null, 0));
  console.log("frames:", n);
} finally {
  await browser.close();
}
