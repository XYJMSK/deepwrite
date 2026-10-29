import { app, dialog, type BrowserWindow } from "electron";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeepWriteApi } from "@deepwrite/contracts";

async function shortBookSourcesInRenderer(texts: string[]) {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const ensure = (condition: unknown, reason: string) => {
    if (!condition) throw new Error(`Short book source smoke: ${reason}`);
  };
  const imported = await api.shortBookAnalysis.chooseSources();
  ensure(imported?.length === 2, "file import did not return both stories");
  const pasted = await api.shortBookAnalysis.addText({
    title: "粘贴的短篇",
    text: "雨停了。主角终于寄出了那封信。"
  });
  const sources = [...imported!, pasted];
  const catalog = await api.shortBookAnalysis.sources.list();
  for (const [index, source] of sources.entries()) {
    ensure(source.text === texts[index], "import changed the story text");
    ensure(
      source.kind === (index < 2 ? "file" : "paste"),
      "source kind changed"
    );
    ensure(
      catalog.sources.some(
        (summary) =>
          summary.id === source.id &&
          summary.characterCount === source.text.length
      ),
      "saved story missing from history"
    );
    ensure(
      JSON.stringify(await api.shortBookAnalysis.sources.load(source.id)) ===
        JSON.stringify(source),
      "saved story could not be reopened"
    );
  }
  for (const source of sources)
    await api.shortBookAnalysis.sources.delete(source.id);
  ensure(
    !(await api.shortBookAnalysis.sources.list()).sources.some((summary) =>
      sources.some((source) => source.id === summary.id)
    ),
    "deleted stories remain in history"
  );
  return {
    status: "ok",
    imported: imported!.length,
    pasted: true,
    reopened: true
  };
}

/** Exercises the real Preload, Main and Core; only the native file picker is stubbed. */
export async function runShortBookSourceSmoke(window: BrowserWindow) {
  const root = await mkdtemp(join(app.getPath("userData"), "short-sources-"));
  const texts = [
    "第一章 来信\n雨夜里，主角收到一封信。\n第二章 告别\n完整结局。",
    "# 另一篇短篇\n她推开门，看见久别的朋友。",
    "雨停了。主角终于寄出了那封信。"
  ];
  const files = [join(root, "story.txt"), join(root, "other.md")];
  const originalDialog = dialog.showOpenDialog;
  try {
    await Promise.all(
      files.map((path, index) => writeFile(path, texts[index]!))
    );
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
    const result = await window.webContents.executeJavaScript(
      `(${shortBookSourcesInRenderer.toString()})(${JSON.stringify(texts)}).catch(error => { throw new Error(error instanceof Error ? error.message : JSON.stringify(error)); })`
    );
    for (const [index, path] of files.entries()) {
      if ((await readFile(path, "utf8")) !== texts[index])
        throw new Error("Short book source smoke changed an original file.");
    }
    return result;
  } finally {
    dialog.showOpenDialog = originalDialog;
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100
    });
  }
}
