// Numeric check of the swimming model (no rendering): the body wave must
//  (1) be small at the head and grow toward the tail,
//  (2) travel head -> tail (phase lag increases with station), and
//  (3) keep adjacent joints a constant distance apart (no stretching/kinks).
import { launch, openPond, pause } from "./lib.mjs";
const browser = await launch();
try {
  const page = await openPond(browser, { query: "debug&solo&still", width: 800, height: 600 });
  await pause(page);
  const r = await page.evaluate(() => {
    const e = window.__pond;
    // `still` freezes motion; re-enable swimming by driving a koi manually through step with motion 1.
    return null;
  });
  void r;
  await page.close();
  const p2 = await openPond(browser, { query: "debug&solo", width: 800, height: 600 });
  await pause(p2);
  const out = await p2.evaluate(() => {
    const e = window.__pond;
    const T = 40, dt = 1 / 60, N = Math.round(T / dt);
    const NJ = e.koi[0].getSpine().length;
    const series = Array.from({ length: NJ }, () => []);
    let maxSegErr = 0, maxKink = 0;
    for (let i = 0; i < N; i++) {
      e.step(dt);
      const k = e.koi[0];
      const w = k.getSpine(), b = k.getBaseSpine();
      for (let j = 0; j < NJ; j++) {
        const a = b[Math.max(0, j - 1)], c = b[Math.min(NJ - 1, j + 1)];
        let tx = a.x - c.x, ty = a.y - c.y; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        series[j].push((w[j].x - b[j].x) * -ty + (w[j].y - b[j].y) * tx);
      }
      const seg = k.params.length / (NJ - 1);
      for (let j = 1; j < NJ; j++) maxSegErr = Math.max(maxSegErr, Math.abs(Math.hypot(b[j].x - b[j - 1].x, b[j].y - b[j - 1].y) - seg) / seg);
      for (let j = 1; j < NJ - 1; j++) {
        const a1 = Math.atan2(b[j].y - b[j - 1].y, b[j].x - b[j - 1].x), a2 = Math.atan2(b[j + 1].y - b[j].y, b[j + 1].x - b[j].x);
        let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        maxKink = Math.max(maxKink, Math.abs(d));
      }
    }
    const rms = series.map((s) => Math.sqrt(s.reduce((a, v) => a + v * v, 0) / s.length));
    // phase lag via cross-correlation against station 8, searched over +-0.9 s
    const ref = series[8];
    const lag = series.map((s) => {
      let best = 0, bestC = -1e9;
      for (let L = -54; L <= 54; L++) {
        let c = 0;
        for (let i = 120; i < N - 120; i++) c += ref[i] * s[i + L];
        if (c > bestC) { bestC = c; best = L; }
      }
      return best * dt;
    });
    return { rms: rms.map((v) => v / e.koi[0].params.length), lag, maxSegErr, maxKinkDeg: (maxKink * 180) / Math.PI, NJ };
  });
  const pick = (a) => [0, 4, 8, 12, 16, 20, 25].map((j) => a[j].toFixed(3)).join("  ");
  console.log("stations     :  0     4     8     12    16    20    25 (head -> tail)");
  console.log("rms offset/L :", pick(out.rms));
  console.log("lag vs st.8 s:", pick(out.lag));
  console.log("max seg length error:", out.maxSegErr.toFixed(4), " max joint kink (deg):", out.maxKinkDeg.toFixed(1));
} finally { await browser.close(); }
