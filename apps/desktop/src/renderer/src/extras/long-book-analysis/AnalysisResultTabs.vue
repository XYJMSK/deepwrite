<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  CatalogSnapshot,
  LongBookAnalysisPreset,
  LongBookAnalysisResult
} from "@deepwrite/contracts/renderer";
import AppIcon from "../../components/AppIcon.vue";
import { createScopedTranslator } from "../../i18n";
import { presetLabel } from "../analysis-ui/preset-labels";
import type {
  SavedLibraryEntry,
  PresetBatchResult
} from "../analysis-ui/preset-batch";
import AnalysisResultPanel from "./AnalysisResultPanel.vue";
import type { AnalysisSaveInput } from "./analysis-result-content";
import { compatibleAnalysisLibraries } from "./task-options";
import "./preset-batch.css";

type Entry = PresetBatchResult<LongBookAnalysisPreset, LongBookAnalysisResult>;

const t = createScopedTranslator("extras.analysisUi");
const props = defineProps<{
  results: readonly Entry[];
  /** Presets in the analysis; tabs appear once more than one is involved. */
  total: number;
  catalogSnapshot: CatalogSnapshot | null;
  saving: boolean;
  context: string;
  activeId: string;
}>();
const emit = defineEmits<{
  openEntry: [entry: SavedLibraryEntry];
  "update:activeId": [id: string];
  update: [id: string, result: LongBookAnalysisResult];
  save: [id: string, input: AnalysisSaveInput];
  saveAll: [requests: (AnalysisSaveInput & { id: string })[]];
}>();
/** Chosen destination per result; compatible results share a choice. */
const targets = ref<Record<string, string>>({});
const active = computed(
  () =>
    props.results.find((entry) => entry.id === props.activeId) ??
    props.results[0]
);
const batched = computed(() => props.total > 1 || props.results.length > 1);
const unsaved = computed(() => props.results.filter((entry) => !entry.saved));

function libraries(entry: Entry) {
  return compatibleAnalysisLibraries(entry.preset, props.catalogSnapshot);
}
function targetFor(entry: Entry): string {
  const id = targets.value[entry.id] ?? "";
  return libraries(entry).some((library) => library.id === id) ? id : "";
}
function setTarget(entry: Entry, libraryId: string): void {
  const next = { ...targets.value, [entry.id]: libraryId };
  for (const other of props.results) {
    if (other.id === entry.id || other.saved || targetFor(other)) continue;
    if (libraries(other).some((library) => library.id === libraryId))
      next[other.id] = libraryId;
  }
  targets.value = next;
}
// A result that finishes later adopts a compatible destination chosen earlier.
watch(
  () => props.results.map((entry) => entry.id),
  () => {
    const chosen = [...new Set(Object.values(targets.value))];
    const next = { ...targets.value };
    for (const entry of props.results) {
      if (targetFor(entry)) continue;
      const match = chosen.find((id) =>
        libraries(entry).some((library) => library.id === id)
      );
      if (match) next[entry.id] = match;
    }
    targets.value = next;
  }
);
const canSaveAll = computed(
  () =>
    !props.saving &&
    unsaved.value.length > 0 &&
    unsaved.value.every((entry) => targetFor(entry))
);
function saveAll(): void {
  emit(
    "saveAll",
    unsaved.value.map((entry) => {
      const libraryId = targetFor(entry);
      const library = libraries(entry).find((item) => item.id === libraryId);
      return {
        id: entry.id,
        libraryId,
        ...(library?.projectRevision === undefined
          ? {}
          : { baseProjectRevision: library.projectRevision })
      };
    })
  );
}
</script>

<template>
  <AnalysisResultPanel
    v-if="active"
    :result="active.result"
    :preset="active.preset"
    :catalog-snapshot="catalogSnapshot"
    :saving="saving"
    :saved-entry="active.savedEntry"
    @open-entry="emit('openEntry', $event)"
    :context="context"
    :eyebrow="
      batched
        ? t('resultsGenerated', {
            count: results.length,
            total: Math.max(total, results.length)
          })
        : undefined
    "
    :target-id="batched ? targetFor(active) : undefined"
    @update:target-id="setTarget(active, $event)"
    @update="emit('update', active.id, $event)"
    @save="emit('save', active.id, $event)"
  >
    <template v-if="batched" #before>
      <div class="analysis-result-tabs-bar">
        <div
          class="analysis-result-tabs"
          role="tablist"
          :aria-label="t('resultTabs')"
        >
          <button
            v-for="entry in results"
            :key="entry.id"
            type="button"
            role="tab"
            class="analysis-result-tab"
            :aria-selected="entry.id === active.id"
            @click="emit('update:activeId', entry.id)"
          >
            <span class="preset-task-state is-completed" aria-hidden="true"
              ><AppIcon name="check" :size="10"
            /></span>
            {{ presetLabel(entry.preset) }}
            <small>{{
              entry.saved
                ? t("resultSavedBadge")
                : entry.preset.output.domain === "material"
                  ? t("materialShort")
                  : t("skillShort")
            }}</small>
          </button>
        </div>
        <button
          v-if="unsaved.length"
          type="button"
          :disabled="!canSaveAll"
          :title="canSaveAll ? undefined : t('saveAllHint')"
          @click="saveAll"
        >
          {{ t("saveAll", { count: unsaved.length }) }}
        </button>
      </div>
    </template>
  </AnalysisResultPanel>
</template>
