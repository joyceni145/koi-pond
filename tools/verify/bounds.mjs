// Long-run steering check: koi must stay inside the opaque water and not pile up.
import { launch, openPond, pause } from "./lib.mjs";
const browser = await launch();
try {
  const page = await openPond(browser, { query: "debug", width: 900, height: 600 });
  await pause(page);
  for (const count of [3, 12]) {
    const res = await page.evaluate((count) => {
      const e = window.__pond;
      while (e.koi.filter((k) => !k.dying).length < count) e.spawn("koi", 0.3 + Math.random() * 1.0, 0.25 + Math.random() * 0.5);
      for (let i = 0; i < 600; i++) e.step(1 / 30); // let fade/spawn settle
      let minEdge = 9, minHeadEdge = 9, minPair = 9, maxTurnDeg = 0, nSamples = 0;
      const W = 1.6, H = 1.0;
      for (let i = 0; i < 300 * 30; i++) {
        e.step(1 / 30);
        const ks = e.koi.filter((k) => !k.dying);
        for (const k of ks) {
          minHeadEdge = Math.min(minHeadEdge, k.x, W - k.x, k.y, H - k.y);
          for (const p of k.getSpine()) minEdge = Math.min(minEdge, p.x, W - p.x, p.y, H - p.y);
        }
        if (i % 15 === 0) for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) minPair = Math.min(minPair, Math.hypot(ks[a].x - ks[b].x, ks[a].y - ks[b].y));
      }
      return { count: e.koi.filter((k) => !k.dying).length, minHeadEdge, minBodyEdge: minEdge, minHeadSeparation: minPair };
    }, count);
    console.log(JSON.stringify(res));
  }
} finally { await browser.close(); }
