import { chromium } from "playwright-core";
import path from "node:path";
import fs from "node:fs";

const outputDir = path.resolve("../../work/screenshots");
fs.mkdirSync(outputDir, { recursive: true });
const password = process.env.KUBEDECK_PASSWORD;
if (!password) throw new Error("KUBEDECK_PASSWORD is required");

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.goto("http://192.168.0.109:30080", { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(outputDir, "01-login.png"), fullPage: true });
await page.locator('input[type="password"]').fill(password);
await page.getByRole("button", { name: "进入集群" }).click();
await page.getByRole("heading", { name: "集群总览" }).waitFor({ timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(outputDir, "02-overview.png"), fullPage: true });

await page.goto("http://192.168.0.109:30080/resources/pods", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outputDir, "03-pods.png"), fullPage: true });

await page.locator(".resource-name").first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outputDir, "04-pod-detail.png"), fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://192.168.0.109:30080", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(outputDir, "05-mobile.png"), fullPage: true });

const metrics = await page.evaluate(() => ({
  bodyWidth: document.body.scrollWidth,
  viewportWidth: window.innerWidth,
  rootText: document.getElementById("root")?.textContent?.slice(0, 120) ?? "",
}));

console.log(JSON.stringify({ consoleErrors, metrics, outputDir }, null, 2));
await browser.close();
