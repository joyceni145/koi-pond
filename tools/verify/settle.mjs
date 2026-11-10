// Time strip: before / during / after a stir to show the distortion appearing and settling.
import path from "node:path";
import { launch, openPond, advance, pause, shot, sleep } from "./lib.mjs";
const browser = await launch();
try {
  const page = await openPond(browser, { query: "debug", width: 1280, height: 800, dpr: 1 });
  await pause(page);
  await advance(page, 3);
  const rect = await page.evaluate(() => { const c = document.querySelector(".pond-canvas").getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
  const at = (u, v) => ({ x: rect.x + u * rect.w, y: rect.y + v * rect.h });
  const clip = { x: rect.x + rect.w * 0.2, y: rect.y + rect.h * 0.25, width: rect.w * 0.6, height: rect.h * 0.5 };
  await shot(page, "settle-0-before.png", clip);
  const s = at(0.3, 0.45); await page.mouse.move(s.x, s.y);
  for (let i = 0; i <= 30; i++) { const t = i / 30; const p = at(0.3 + 0.35 * t, 0.45 + 0.1 * Math.sin(t * 6)); await page.mouse.move(p.x, p.y); await sleep(16); await advance(page, 1 / 60, 60); }
  await shot(page, "settle-1-during.png", clip);
  for (const [i, dt] of [[2, 0.5], [3, 1.0], [4, 2.0]]) { await advance(page, dt, 60); await shot(page, `settle-${i}-after.png`, clip); }
  console.log("ok");
} finally { await browser.close(); }
