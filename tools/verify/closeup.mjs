// Close-up frame strip of a single swimming koi at high zoom (sim-time stepped).
import fs from "node:fs";
import path from "node:path";
import { launch, openPond, advance, pause, OUT } from "./lib.mjs";

const START = Number(process.env.START || 6);
const COUNT = Number(process.env.COUNT || 8);
const DT = Number(process.env.DT || 0.14);
const browser = await launch();
try {
  const page = await openPond(browser, { query: process.env.QUERY || "debug&solo", width: 1280, height: 800, dpr: 2.5 });
  await pause(page);
  await advance(page, START);
  const dir = path.join(OUT, "closeup");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < COUNT; i++) {
    const info = await page.evaluate(() => {
      const e = window.__pond; const c = document.querySelector(".pond-canvas").getBoundingClientRect();
      const k = e.koi[0]; const sp = k.getSpine();
      const mid = sp[Math.floor(sp.length * Number(new URLSearchParams(location.search).get('at') || 0.5))];
      return { x: c.x + ((mid.x + 0.1) / 1.8) * c.width, y: c.y + ((mid.y + 0.1) / 1.2) * c.height, L: k.params.length * c.width / 1.8 };
    });
    const R = info.L * Number(process.env.ZOOM || 0.62);
    await page.screenshot({ path: path.join(dir, `c${i}.png`), clip: { x: info.x - R, y: info.y - R * 0.62, width: R * 2, height: R * 1.24 } });
    await advance(page, DT, 60);
  }
  console.log("ok");
} finally { await browser.close(); }
