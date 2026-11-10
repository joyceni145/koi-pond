// Put a lily pad and a lotus directly over swimming koi, then compare the same frame with the
// plants hidden vs shown: the fish must continue underneath, and the plants must fully cover it.
import { launch, openPond, advance, pause, shot } from "./lib.mjs";
const browser = await launch();
try {
  const page = await openPond(browser, { query: "debug", width: 1280, height: 800, dpr: 2 });
  await pause(page);
  await advance(page, 2);
  const info = await page.evaluate(() => {
    const e = window.__pond;
    // remove the initial plants so only the test plants cover fish
    for (const p of e.plants) p.dying = true;
    for (let i = 0; i < 90; i++) e.step(1 / 30);
    const k = e.koi[0];
    const sp = k.getSpine();
    const mid = sp[11];
    let pad = e.spawn("pad", mid.x, mid.y);
    while (pad.radius < 0.1) { pad.dying = true; pad = e.spawn("pad", mid.x, mid.y); }
    pad.fade = 1;
    pad.x = mid.x + 0.02; pad.y = mid.y - 0.01;
    e.step(1 / 1000);
    const c = document.querySelector(".pond-canvas").getBoundingClientRect();
    const toPx = (p) => ({ x: c.x + ((p.x + 0.1) / 1.8) * c.width, y: c.y + ((p.y + 0.1) / 1.2) * c.height });
    return { k1: k.getSpine().map(toPx), k2: k.getSpine().map(toPx), pad: toPx(pad), lot: toPx(pad), L: c.width / 1.8 };
  });
  const bbox = (pts, pad) => ({ x: Math.min(...pts.map((p) => p.x)) - pad, y: Math.min(...pts.map((p) => p.y)) - pad, width: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) + 2 * pad, height: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) + 2 * pad });
  const clip1 = bbox(info.k1, info.L * 0.14);
  const clip2 = bbox(info.k2, info.L * 0.14);
  await page.evaluate(() => window.__pond.render());
  await shot(page, "occl-pad-shown.png", clip1);
  await shot(page, "occl-lotus-shown.png", clip2);
  await page.evaluate(() => { for (const p of window.__pond.plants) { p.mesh.visible = false; p.shadow.visible = false; } window.__pond.render(); });
  await shot(page, "occl-pad-hidden.png", clip1);
  await shot(page, "occl-lotus-hidden.png", clip2);
  console.log("ok");
} finally { await browser.close(); }
