// Stage 1 review: static composition (still mode) at desktop and mobile sizes.
import { launch, openPond, shot, advance, pause } from "./lib.mjs";

const browser = await launch();
try {
  const page = await openPond(browser, { query: "debug&still", width: 1280, height: 800, dpr: 1 });
  await pause(page);
  await advance(page, 3);
  console.log(await shot(page, "stage1-desktop.png"));
  await page.close();

  const m = await openPond(browser, { query: "debug&still", width: 390, height: 780, dpr: 2, mobile: true, touch: true });
  await pause(m);
  await advance(m, 3);
  console.log(await shot(m, "stage1-mobile.png"));
} finally {
  await browser.close();
}
