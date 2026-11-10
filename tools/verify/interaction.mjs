// Interaction verification with real input events. Prints PASS/FAIL per check.
import { launch, openPond, advance, pause, sleep } from "./lib.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const counts = (page) =>
  page.evaluate(() => {
    const e = window.__pond;
    const live = (a) => a.filter((x) => !x.dying).length;
    return { koi: live(e.koi), pads: live(e.plants.filter((p) => p.kind === "pad")), lotus: live(e.plants.filter((p) => p.kind === "lotus")), koiTotal: e.koi.length, plantsTotal: e.plants.length };
  });
const rectOf = (page) => page.evaluate(() => { const c = document.querySelector(".pond-canvas").getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });

const browser = await launch();
try {
  // ---------------------------------------------------------------- mouse
  {
    const page = await openPond(browser, { query: "debug", width: 1280, height: 800 });
    await pause(page);
    await advance(page, 2);
    const r = await rectOf(page);
    const at = (u, v) => ({ x: r.x + u * r.w, y: r.y + v * r.h });

    const c0 = await counts(page);
    check("starts with three koi and a few lily pads", c0.koi === 3 && c0.pads >= 3 && c0.pads <= 6 && c0.lotus === 0, JSON.stringify(c0));

    // hover only: no spawn, but the water responds
    const e0 = await page.evaluate(() => window.__pond.fluidStats().flowEnergy);
    const a = at(0.35, 0.5);
    await page.mouse.move(a.x, a.y);
    for (let i = 0; i < 20; i++) { const p = at(0.35 + i * 0.01, 0.5); await page.mouse.move(p.x, p.y); await sleep(16); await advance(page, 1 / 60, 60); }
    const e1 = await page.evaluate(() => window.__pond.fluidStats().flowEnergy);
    const c1 = await counts(page);
    check("hovering stirs the water without adding anything", e1 > e0 * 3 && c1.koi + c1.pads + c1.lotus === c0.koi + c0.pads + c0.lotus, `flow energy ${e0.toFixed(2)} -> ${e1.toFixed(2)}`);

    // click inside: exactly one item at that spot
    const before = await counts(page);
    const spot = at(0.5, 0.5);
    await page.mouse.click(spot.x, spot.y);
    const after = await counts(page);
    const delta = after.koi + after.pads + after.lotus - (before.koi + before.pads + before.lotus);
    check("a click on the water adds exactly one item", delta === 1, JSON.stringify(after));

    // newly added item starts transparent and fades in
    const fadeInfo = await page.evaluate(() => { const e = window.__pond; const all = [...e.koi, ...e.plants]; const n = all.reduce((a, b) => (a.age < b.age ? a : b)); return { fade: n.fade, kind: n.kind }; });
    check("new item begins invisible, then fades in", fadeInfo.fade < 0.2, `fade=${fadeInfo.fade.toFixed(2)}`);
    await advance(page, 2);
    const fadedIn = await page.evaluate(() => { const e = window.__pond; const all = [...e.koi, ...e.plants]; return all.reduce((a, b) => (a.age < b.age ? a : b)).fade; });
    check("…and is fully opaque after ~2 s", fadedIn > 0.99, `fade=${fadedIn.toFixed(2)}`);

    // click in the faded margin: ignored
    const m0 = await counts(page);
    const margin = { x: r.x + r.w * 0.012, y: r.y + r.h * 0.5 };
    await page.mouse.click(margin.x, margin.y);
    const m1 = await counts(page);
    check("a click on the faded margin is ignored", m1.koi + m1.pads + m1.lotus === m0.koi + m0.pads + m0.lotus);

    // mouse press + drag: no spawn
    const d0 = await counts(page);
    const p0 = at(0.3, 0.3);
    await page.mouse.move(p0.x, p0.y); await page.mouse.down();
    for (let i = 1; i <= 15; i++) { const p = at(0.3 + i * 0.02, 0.3 + i * 0.01); await page.mouse.move(p.x, p.y); await sleep(16); }
    await page.mouse.up();
    const d1 = await counts(page);
    check("press-and-drag with the mouse stirs but does not add an item", d1.koi + d1.pads + d1.lotus === d0.koi + d0.pads + d0.lotus);

    // spawn odds (65/25/10)
    const odds = await page.evaluate(() => { const e = window.__pond; const tally = { koi: 0, pad: 0, lotus: 0 }; const N = 4000; for (let i = 0; i < N; i++) tally[e.spawnRandom(0.8, 0.5)]++; return { koi: tally.koi / N, pad: tally.pad / N, lotus: tally.lotus / N }; });
    check("spawn odds ≈ 65% koi / 25% pad / 10% lotus", Math.abs(odds.koi - 0.65) < 0.03 && Math.abs(odds.pad - 0.25) < 0.03 && Math.abs(odds.lotus - 0.1) < 0.02, JSON.stringify(odds));

    // caps
    await advance(page, 3);
    const cap = await counts(page);
    check("object counts are capped (koi ≤ 12, pads ≤ 14, lotus ≤ 6)", cap.koi <= 12 && cap.pads <= 14 && cap.lotus <= 6, JSON.stringify(cap));
    check("retired items are removed once faded (no unbounded growth)", cap.koiTotal <= 12 && cap.plantsTotal <= 20, `koi meshes=${cap.koiTotal}, plant meshes=${cap.plantsTotal}`);

    // floating objects stay inside the pond even after being stirred hard
    await page.evaluate(() => { const e = window.__pond; for (let i = 0; i < 40; i++) e.stirSegment(0.1, 0.5, 1.5, 0.5, 0.05), e.stirSegment(1.5, 0.2, 0.1, 0.8, 0.05); for (let i = 0; i < 20 * 60; i++) e.step(1 / 60); });
    const inside = await page.evaluate(() => window.__pond.plants.every((p) => p.x > 0.08 && p.x < 1.52 && p.y > 0.08 && p.y < 0.92));
    check("floating plants stay inside the pond after strong stirring", inside);

    // reset
    await page.click(".reset");
    await advance(page, 3);
    const rs = await counts(page);
    check("Reset restores the starting scene (3 koi, same pads, no lotus)", rs.koi === 3 && rs.pads === c0.pads && rs.lotus === 0 && rs.koiTotal === 3 && rs.plantsTotal === c0.pads, JSON.stringify(rs));
    await page.close();
  }

  // ---------------------------------------------------------------- touch
  {
    const page = await openPond(browser, { query: "debug", width: 412, height: 800, dpr: 2, mobile: true, touch: true });
    await pause(page);
    await advance(page, 2);
    const r = await rectOf(page);
    const at = (u, v) => ({ x: r.x + u * r.w, y: r.y + v * r.h });
    const tot = async () => { const c = await counts(page); return c.koi + c.pads + c.lotus; };

    const t0 = await tot();
    const p = at(0.5, 0.5);
    await page.touchscreen.tap(p.x, p.y);
    check("a touch tap on the water adds one item", (await tot()) === t0 + 1);

    const e0 = await page.evaluate(() => window.__pond.fluidStats().flowEnergy);
    const n0 = await tot();
    const s = at(0.3, 0.4);
    const touch = await page.touchscreen.touchStart(s.x, s.y);
    for (let i = 1; i <= 14; i++) { const q = at(0.3 + i * 0.03, 0.4 + i * 0.008); await touch.move(q.x, q.y); await sleep(16); await advance(page, 1 / 60, 60); }
    await touch.end();
    const e1 = await page.evaluate(() => window.__pond.fluidStats().flowEnergy);
    check("a touch drag stirs the water", e1 > e0 * 3, `flow energy ${e0.toFixed(2)} -> ${e1.toFixed(2)}`);
    check("…and a touch drag is not treated as a tap", (await tot()) === n0);
    const scrolled = await page.evaluate(() => window.scrollY);
    check("dragging on the pond does not scroll the page", scrolled === 0);

    // tiny wobble under the slop is still a tap
    const n1 = await tot();
    const w = at(0.6, 0.55);
    const t2 = await page.touchscreen.touchStart(w.x, w.y);
    await t2.move(w.x + 3, w.y + 2);
    await t2.end();
    check("a tap with a few pixels of finger wobble still counts as a tap", (await tot()) === n1 + 1);

    // long press is not a tap
    const n2 = await tot();
    const lp = at(0.4, 0.6);
    const t3 = await page.touchscreen.touchStart(lp.x, lp.y);
    await sleep(800);
    await t3.end();
    check("a long press is not treated as a tap", (await tot()) === n2);
    await page.close();
  }

  // ------------------------------------------------------- reduced motion
  {
    const page = await openPond(browser, { query: "debug", width: 1000, height: 700, reducedMotion: true });
    await pause(page);
    const info = await page.evaluate(() => { const e = window.__pond; return { motion: e.motion, ambient: e.compositeMaterial.uniforms.uAmbient.value, strength: e.compositeMaterial.uniforms.uStrength.value }; });
    check("prefers-reduced-motion calms swimming, ambient shimmer and refraction", info.motion < 0.5 && info.ambient === 0 && info.strength < 1, JSON.stringify(info));
    const plantsStatic = await page.evaluate(() => { const e = window.__pond; const p = e.plants[0]; const m0 = p.mesh.scale.x; for (let i = 0; i < 300; i++) e.step(1 / 30); return Math.abs(p.mesh.scale.x - m0) < 1e-6; });
    check("…and floating plants no longer bob", plantsStatic);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll interaction checks passed");
process.exit(failures ? 1 : 0);
