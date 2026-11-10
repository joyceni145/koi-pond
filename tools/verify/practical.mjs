// CPU cost of the simulation at the object caps, and responsive layout across viewports.
import { launch, openPond, advance, pause, shot } from "./lib.mjs";
const browser = await launch();
try {
  const page = await openPond(browser, { query: "debug", width: 1280, height: 800 });
  await pause(page);
  const r = await page.evaluate(() => {
    const e = window.__pond;
    for (let i = 0; i < 40; i++) e.spawnRandom(0.3 + Math.random() * 1.0, 0.25 + Math.random() * 0.5);
    for (let i = 0; i < 300; i++) e.step(1 / 60);
    const counts = { koi: e.koi.length, plants: e.plants.length };
    const t0 = performance.now();
    const N = 600;
    for (let i = 0; i < N; i++) e.step(1 / 60);
    const stepMs = (performance.now() - t0) / N;
    // vertex count being skinned per frame
    const verts = e.koi.length * 73 * 31;
    return { counts, stepMs, verts };
  });
  console.log(`at caps: ${JSON.stringify(r.counts)}  ->  simulation+skinning+fluid dispatch ≈ ${r.stepMs.toFixed(2)} ms/frame of JS (software GL, ${r.verts} skinned vertices)`);

  for (const [name, w, h, dpr, mobile] of [["phone-portrait", 390, 844, 3, true], ["phone-landscape", 844, 390, 3, true], ["tablet", 820, 1180, 2, true], ["wide", 1920, 1080, 1, false]]) {
    const p = await openPond(browser, { query: "debug", width: w, height: h, dpr, mobile, touch: mobile });
    await pause(p);
    await advance(p, 3);
    const m = await p.evaluate(() => { const c = document.querySelector(".pond-canvas").getBoundingClientRect(); const cap = document.querySelector(".caption").getBoundingClientRect(); const b = window.__pond.bufferSize; return { canvas: [Math.round(c.width), Math.round(c.height)], captionBottom: Math.round(cap.bottom), vh: innerHeight, scrollW: document.documentElement.scrollWidth, vw: innerWidth, buffer: [b.w, b.h, b.pixelRatio] }; });
    console.log(name.padEnd(16), JSON.stringify(m), m.captionBottom <= m.vh ? "fits" : "OVERFLOWS", m.scrollW <= m.vw ? "no h-scroll" : "H-SCROLL");
    await shot(p, `layout-${name}.png`);
    await p.close();
  }

  // live resize
  const page2 = await openPond(browser, { query: "debug", width: 1200, height: 800 });
  await pause(page2);
  await page2.setViewport({ width: 700, height: 900 });
  await advance(page2, 0.5);
  const after = await page2.evaluate(() => { const c = document.querySelector(".pond-canvas"); const b = window.__pond.bufferSize; const r = c.getBoundingClientRect(); return { css: [Math.round(r.width), Math.round(r.height)], buffer: [b.w, b.h], aspectCss: +(r.width / r.height).toFixed(3), aspectBuf: +(b.w / b.h).toFixed(3) }; });
  console.log("after live resize:", JSON.stringify(after));
} finally { await browser.close(); }
