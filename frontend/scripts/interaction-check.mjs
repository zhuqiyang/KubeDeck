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
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto("http://192.168.0.109:30080", { waitUntil: "networkidle" });
await page.locator('input[type="password"]').fill(password);
await page.getByRole("button", { name: "进入集群" }).click();
await page.getByRole("heading", { name: "集群总览" }).waitFor();
await page.evaluate(() => localStorage.setItem("kubedeck-namespace", "kubedeck-test"));

await page.goto("http://192.168.0.109:30080/resources/pods", { waitUntil: "networkidle" });
await page.locator("tr.ant-table-row").filter({ hasText: "demo-" }).first().waitFor();
const podRow = page.locator("tr.ant-table-row").filter({ hasText: "demo-" }).first();
await podRow.locator("button.ant-dropdown-trigger").click();
await page.getByText("实时日志", { exact: true }).click();
await page.locator(".terminal-output").getByText(/start worker process/).first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outputDir, "06-live-logs.png"), fullPage: true });
await page.locator(".ant-drawer-close").first().click();
await page.waitForTimeout(300);

await page.goto("http://192.168.0.109:30080/resources/deployments", { waitUntil: "networkidle" });
const deployRow = page.locator("tr.ant-table-row").filter({ hasText: "demo" }).first();
await deployRow.waitFor();
await deployRow.locator("button.ant-dropdown-trigger").click();
await page.getByText("编辑 YAML", { exact: true }).click();
await page.locator(".yaml-editor-modal").waitFor({ timeout: 10000 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outputDir, "07-yaml-editor.png"), fullPage: true });

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
