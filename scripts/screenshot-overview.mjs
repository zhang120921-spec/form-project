// Screenshot the Overview page in both light and dark themes
import { chromium } from "playwright";
import { join } from "path";

const OUT = "/Users/michaelzhang/WorkBuddy/2026-08-02-12-07-39/dusk-v3";
const CHROMIUM_PATH = "/Users/michaelzhang/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const W = 1280;
const H = 900;

async function run() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: W, height: H } });

  // Light theme screenshot
  const page = await context.newPage();
  await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.screenshot({
    path: join(OUT, "screenshot-overview-light.png"),
    fullPage: true,
  });
  console.log("Light screenshot saved");

  // Dark theme screenshot
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: join(OUT, "screenshot-overview-dark.png"),
    fullPage: true,
  });
  console.log("Dark screenshot saved");

  await browser.close();
  console.log("Done");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
