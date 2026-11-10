// Close-up of the still composition at 2x DPR to inspect artwork fidelity.
import { launch, openPond, shot, advance, pause } from "./lib.mjs";
const browser = await launch();
try {
  const page = await openPond(browser, { query: "debug&still", width: 1280, height: 800, dpr: 2 });
  await pause(page);
  await advance(page, 3);
  const r = await page.evaluate(() => { const c = document.querySelector(".pond-canvas").getBoundingClientRect(); return {x:c.x,y:c.y,w:c.width,h:c.height}; });
  console.log(await shot(page, "zoom-koi.png", { x: r.x + r.w*0.22, y: r.y + r.h*0.33, width: r.w*0.5, height: r.h*0.5 }));
} finally { await browser.close(); }
