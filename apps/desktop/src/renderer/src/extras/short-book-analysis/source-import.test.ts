import { afterEach, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import type {
  DeepWriteApi,
  ShortBookAnalysisApi,
  ShortBookAnalysisSource,
  ShortBookAnalysisSourceSummary
} from "@deepwrite/contracts/renderer";
import { useShortBookAnalysis } from "./useShortBookAnalysis";

const existing: ShortBookAnalysisSource = {
  id: "existing",
  title: "已有短篇",
  text: "原有正文。",
  kind: "file",
  importedAt: "2026-01-01T00:00:00.000Z"
};
const imported: ShortBookAnalysisSource = {
  ...existing,
  id: "imported",
  title: "新短篇",
  text: "新正文。",
  importedAt: "2026-01-02T00:00:00.000Z"
};
function summary({ text, ...source }: ShortBookAnalysisSource) {
  return { ...source, characterCount: text.length };
}
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function fixture() {
  const persisted = new Map([[existing.id, existing]]);
  const sourceApi = {
    chooseSources: vi.fn(async () => {
      persisted.set(imported.id, imported);
      return [imported];
    }),
    addText: vi.fn(async () => {
      const pasted = { ...imported, kind: "paste" as const };
      persisted.set(pasted.id, pasted);
      return pasted;
    }),
    sources: {
      list: vi.fn(async () => ({
        sources: [...persisted.values()].map(summary)
      })),
      load: vi.fn(async () => imported),
      delete: vi.fn(async (id: string) => {
        persisted.delete(id);
        return id;
      })
    }
  } satisfies ShortBookAnalysisApi;
  const scope = effectScope();
  const c = scope.run(() =>
    useShortBookAnalysis({
      api: () => ({ shortBookAnalysis: sourceApi }) as unknown as DeepWriteApi
    })
  )!;
  c.savedSources.value = [summary(existing)];
  cleanups.push(() => {
    c.dispose();
    scope.stop();
  });
  return { c, sourceApi, persisted };
}

it.each(["file", "paste"] as const)(
  "keeps a successful %s save successful when the history catalog cannot be read",
  async (kind) => {
    const { c, sourceApi, persisted } = fixture();
    sourceApi.sources.list.mockRejectedValue({
      code: "short_book_analysis.command_failed",
      message: "另一本短篇的历史文件无法读取。"
    });
    const save = kind === "file" ? c.chooseSources() : c.addText(imported);
    await expect(save).resolves.toBeUndefined();
    expect(persisted.size).toBe(2);
    expect(c.drafts.value).toEqual([{ ...imported, kind }]);
    expect(c.activeId.value).toBe(imported.id);
    expect(c.savedSources.value).toEqual([
      summary({ ...imported, kind }),
      summary(existing)
    ]);
    expect(c.loading.value).toBe(false);
  }
);

it("keeps the saved history and drafts unchanged when saving really fails", async () => {
  const { c, sourceApi, persisted } = fixture();
  const failure = {
    code: "short_book_analysis.source_failed",
    message: "无法写入工作目录。"
  };
  sourceApi.addText.mockRejectedValue(failure);
  await expect(c.addText(imported)).rejects.toEqual(failure);
  expect(persisted.size).toBe(1);
  expect(c.drafts.value).toEqual([]);
  expect(c.savedSources.value).toEqual([summary(existing)]);
  expect(c.loading.value).toBe(false);
});

it.each(["import", "delete"] as const)(
  "does not let an older history request undo a completed %s",
  async (operation) => {
    const { c, sourceApi } = fixture();
    let finish!: (value: { sources: ShortBookAnalysisSourceSummary[] }) => void;
    sourceApi.sources.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const loading = c.loadSources();
    if (operation === "import") await c.chooseSources();
    else await c.deleteSource(existing.id);
    finish({ sources: [summary(existing)] });
    await loading;
    expect(c.savedSources.value.map(({ id }) => id)).toEqual(
      operation === "import" ? [imported.id, existing.id] : []
    );
  }
);

it("ignores a superseded history failure but reports an explicit refresh failure", async () => {
  const { c, sourceApi } = fixture();
  const failure = {
    code: "short_book_analysis.command_failed",
    message: "历史文件无法读取。"
  };
  let reject!: (error: unknown) => void;
  sourceApi.sources.list.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      })
  );
  const loading = c.loadSources();
  await c.chooseSources();
  reject(failure);
  await expect(loading).resolves.toBeUndefined();
  sourceApi.sources.list.mockRejectedValueOnce(failure);
  await expect(c.loadSources()).rejects.toEqual(failure);
  expect(c.savedSources.value).toEqual([summary(imported), summary(existing)]);
});
