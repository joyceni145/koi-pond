// Stage 3 review: real mouse drag across the pond. Measures how the water responds and settles
// (read back from the simulation) and saves with/without-refraction pairs to isolate the distortion.
import fs from "node:fs";
import path from "node:path";
import { launch, openPond, advance, pause, shot, sleep, OUT } from "./lib.mjs";

const browser = await launch();
try {
  const page = await openPond(browser, { query: "debug", width: 1280, height: 800, dpr: 1 });
  await pause(page);
  await advance(page, 3);
  const rect = await page.evaluate(() => { const c = document.querySelector(".pond-canvas").getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
  const at = (u, v) => ({ x: rect.x + u * rect.w, y: rect.y + v * rect.h });

  console.log("rest   :", JSON.stringify(await page.evaluate(() => window.__pond.fluidStats())));

  // Drag a smooth S-curve through the middle of the pond, ~60 Hz pointer events, stepping the sim in between.
  const start = at(0.3, 0.5);
  await page.mouse.move(start.x, start.y);
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = at(0.3 + 0.4 * t, 0.5 + 0.12 * Math.sin(t * Math.PI * 2));
    await page.mouse.move(p.x, p.y);
    await sleep(16);
    await advance(page, 1 / 60, 60);
  }
  const during = await page.evaluate(() => window.__pond.fluidStats());
  console.log("after drag:", JSON.stringify(during));
  const clip = { x: rect.x + rect.w * 0.2, y: rect.y + rect.h * 0.25, width: rect.w * 0.6, height: rect.h * 0.5 };
  await page.evaluate(() => window.__pond.setRefraction(1, 0)); await advance(page, 0.0001);
  await shot(page, "stage3-stirred.png", clip);
  await page.evaluate(() => window.__pond.setRefraction(0, 0)); await advance(page, 0.0001);
  await shot(page, "stage3-unrefracted.png", clip);
  await page.evaluate(() => window.__pond.setRefraction(1, 1));

  // Settling
  const series = [];
  for (let s = 0; s <= 8; s++) {
    const st = await page.evaluate(() => window.__pond.fluidStats());
    series.push({ t: s * 0.5, flow: +st.peakFlow.toFixed(4), wave: +st.peakWave.toFixed(5) });
    await advance(page, 0.5, 60);
  }
  console.log("settle (t after drag, peak flow uv/s, peak wave):");
  console.log(series.map((r) => `${r.t.toFixed(1)}s flow=${r.flow} wave=${r.wave}`).join("\n"));
  fs.writeFileSync(path.join(OUT, "stage3-settle.json"), JSON.stringify(series));
} finally { await browser.close(); }
