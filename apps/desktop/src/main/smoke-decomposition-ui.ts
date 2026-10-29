import { presetProtectionUiSmoke } from "./smoke-preset-protection-renderer";
import type { BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decompositionUiStep } from "./smoke-decomposition-ui-renderer";

export async function runDecompositionUiSmoke(window: BrowserWindow) {
  if (process.env.DEEPWRITE_SMOKE !== "1")
    throw new Error("UI smoke requires an isolated profile.");
  window.showInactive();
  window.webContents.setBackgroundThrottling(false);
  const results = [];
  for (const [step, theme, fontSize, width] of [
    ["setup", "light", 14, 1200],
    ["progress", "dark", 14, 1200],
    ["registry", "light", 24, 1120],
    ["modal", "dark", 10, 1120]
  ] as const) {
    window.setSize(width, fontSize === 14 ? 780 : 700);
    try {
      results.push(
        await window.webContents.executeJavaScript(
          `(${decompositionUiStep.toString()})(${JSON.stringify(step)},${JSON.stringify(theme)},${fontSize})`
        )
      );
    } catch (error) {
      await writeFile(
        join(tmpdir(), "deepwrite-decomposition-ui-failure.png"),
        (await window.capturePage()).toPNG()
      );
      throw error;
    }
    await writeFile(
      join(tmpdir(), `deepwrite-decomposition-${step}.png`),
      (await window.capturePage()).toPNG()
    );
  }
  const presetProtection = await runPresetProtectionSmoke(window);
  return { status: "ok", views: results, presetProtection };
}

export async function runPresetProtectionSmoke(window: BrowserWindow) {
  if (process.env.DEEPWRITE_SMOKE !== "1")
    throw new Error("Preset UI smoke requires an isolated profile.");
  window.showInactive();
  window.webContents.setBackgroundThrottling(false);
  return window.webContents.executeJavaScript(
    `(${presetProtectionUiSmoke.toString()})()`
  );
}
