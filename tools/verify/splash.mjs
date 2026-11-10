// What does a tap do to the water? Shows refraction-only difference maps (amplified) over time.
import { launch, openPond, advance, pause, shot } from "./lib.mjs";
const browser = await launch();
try {
  const page = await openPond(browser, { query: "debug&solo", width: 1280, height: 800, dpr: 1 });
  await pause(page);
  await advance(page, 2);
  await page.evaluate(() => { const e = window.__pond; for (const k of e.koi) { k.dying = true; k.dead = true; } for (const p of e.plants) { p.dying = true; p.dead = true; } e.step(1 / 60); });
  const rect = await page.evaluate(() => { const c = document.querySelector(".pond-canvas").getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
  const clip = { x: rect.x + rect.w * 0.3, y: rect.y + rect.h * 0.25, width: rect.w * 0.4, height: rect.h * 0.5 };
  await page.evaluate(() => { const e = window.__pond; e.setRefraction(1, 0); e.pushSplat({ x: 0.8, y: 0.5, vx: 0, vy: 0, flow: 0, height: -0.21, radius: 0.075 }); });
  for (const [i, t] of [[0, 0.15], [1, 0.3], [2, 0.5], [3, 0.9]]) {
    await advance(page, i === 0 ? t : t - [0.15, 0.3, 0.5][i - 1], 60);
    await page.evaluate(() => { const e = window.__pond; e.setRefraction(1, 0); e.render(); });
    await shot(page, `splash-${i}-on.png`, clip);
    await page.evaluate(() => { const e = window.__pond; e.setRefraction(0, 0); e.render(); });
    await shot(page, `splash-${i}-off.png`, clip);
  }
  console.log("ok");
} finally { await browser.close(); }
