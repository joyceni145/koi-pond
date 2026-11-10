import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

export const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "out");
fs.mkdirSync(OUT, { recursive: true });

export const URL_BASE = process.env.POND_URL || "http://127.0.0.1:5173/";

export async function launch(extra = {}) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || "/usr/local/bin/google-chrome",
    headless: "new",
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--use-gl=angle",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--enable-webgl",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
    ],
    ...extra,
  });
  return browser;
}

export async function openPond(browser, { width = 1280, height = 800, dpr = 1, query = "debug", mobile = false, touch = false, reducedMotion = false } = {}) {
  const page = await browser.newPage();
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") console.log(`[browser ${t}]`, m.text());
  });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.setViewport({ width, height, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: touch });
  if (reducedMotion) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(`${URL_BASE}?${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__pond && document.querySelector(".pond-canvas.is-ready"), { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1700));
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function shot(page, name, clip) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
  return file;
}

/** Advance the simulation by `seconds` of sim time (independent of slow software rendering). */
export async function advance(page, seconds, hz = 30) {
  await page.evaluate(
    (seconds, hz) => {
      const e = window.__pond;
      const n = Math.round(seconds * hz);
      for (let i = 0; i < n; i++) e.step(1 / hz);
      e.render();
    },
    seconds,
    hz,
  );
}

/** Stop the real-time loop so scripted stepping is the only thing advancing the sim. */
export async function pause(page) {
  await page.evaluate(() => window.__pond.stop());
}
