import { ref } from "vue";
import type {
  ShortBookAnalysisApi,
  ShortBookAnalysisSource,
  ShortBookAnalysisSourceSummary,
  ShortBookAnalysisTextInput
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../../i18n";

const t = createScopedTranslator("extras");

/** Source persistence and the drafts currently selected for analysis. */
export function useShortAnalysisSources(options: {
  api(): ShortBookAnalysisApi;
  assertEditable(): void;
  settle(): void;
  selectionLimit(): number;
  isDisposed(): boolean;
}) {
  const savedSources = ref<ShortBookAnalysisSourceSummary[]>([]);
  const drafts = ref<ShortBookAnalysisSource[]>([]);
  const selectedIds = ref<string[]>([]);
  const activeId = ref("");
  const loading = ref(false);
  let catalogVersion = 0;

  async function loadSources() {
    const version = ++catalogVersion;
    try {
      const catalog = await options.api().sources.list();
      if (!options.isDisposed() && version === catalogVersion)
        savedSources.value = catalog.sources;
    } catch (error) {
      if (!options.isDisposed() && version === catalogVersion) throw error;
    }
  }

  function addDrafts(sources: ShortBookAnalysisSource[]) {
    if (options.isDisposed()) return;
    options.settle();
    ++catalogVersion;
    const summaries = new Map(
      savedSources.value.map((source) => [source.id, source])
    );
    for (const source of sources) {
      if (!drafts.value.some((book) => book.id === source.id))
        drafts.value.push(source);
      // Core has already saved and validated this source. A separate history
      // read must not turn a successful import into a failed save.
      const { text, ...summary } = source;
      summaries.set(source.id, { ...summary, characterCount: text.length });
    }
    savedSources.value = [...summaries.values()].sort((a, b) =>
      b.importedAt.localeCompare(a.importedAt)
    );
    activeId.value = sources[0]?.id ?? activeId.value;
    if (options.selectionLimit() === 1 && sources[0])
      selectedIds.value = [sources[0].id];
  }

  function removeDraft(id: string) {
    const index = drafts.value.findIndex((book) => book.id === id);
    if (index < 0) return;
    options.settle();
    drafts.value = drafts.value.filter((book) => book.id !== id);
    selectedIds.value = selectedIds.value.filter((value) => value !== id);
    if (activeId.value === id)
      activeId.value =
        drafts.value[Math.min(index, drafts.value.length - 1)]?.id ?? "";
  }

  return {
    savedSources,
    drafts,
    selectedIds,
    activeId,
    loading,
    loadSources,
    async chooseSources() {
      options.assertEditable();
      loading.value = true;
      try {
        const sources = await options.api().chooseSources();
        if (sources?.length) addDrafts(sources);
      } finally {
        loading.value = false;
      }
    },
    async addText(input: ShortBookAnalysisTextInput) {
      options.assertEditable();
      if (!input.title.trim())
        throw new Error(t("shortBookAnalysis.storyTitleRequired"));
      if (!input.text.trim())
        throw new Error(t("shortBookAnalysis.completeTextRequired"));
      loading.value = true;
      try {
        addDrafts([await options.api().addText(input)]);
      } finally {
        loading.value = false;
      }
    },
    async loadSource(id: string) {
      options.assertEditable();
      loading.value = true;
      try {
        addDrafts([await options.api().sources.load(id)]);
      } finally {
        loading.value = false;
      }
    },
    toggleBook(id: string) {
      options.assertEditable();
      if (!drafts.value.some((book) => book.id === id)) return;
      const selected = selectedIds.value.includes(id);
      if (options.selectionLimit() === 1) {
        if (!selected || selectedIds.value.length !== 1) options.settle();
        selectedIds.value = [id];
        activeId.value = id;
        return;
      }
      if (!selected && selectedIds.value.length >= options.selectionLimit())
        throw new Error(t("shortBookAnalysis.maxTenStories"));
      options.settle();
      selectedIds.value = selected
        ? selectedIds.value.filter((value) => value !== id)
        : [...selectedIds.value, id];
    },
    removeBook(id: string) {
      options.assertEditable();
      removeDraft(id);
    },
    async deleteSource(id: string) {
      options.assertEditable();
      loading.value = true;
      try {
        await options.api().sources.delete(id);
        if (options.isDisposed()) return;
        ++catalogVersion;
        removeDraft(id);
        savedSources.value = savedSources.value.filter(
          (book) => book.id !== id
        );
      } finally {
        loading.value = false;
      }
    },
    updateBook(id: string, input: { title: string; text: string }) {
      options.assertEditable();
      const index = drafts.value.findIndex((book) => book.id === id);
      if (index < 0) return;
      options.settle();
      drafts.value[index] = { ...drafts.value[index]!, ...input };
    }
  };
}
