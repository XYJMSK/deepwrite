<script setup lang="ts">
import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { nextTick, onMounted, ref, watch } from "vue";
import type {
  CatalogSnapshot,
  LongBookAnalysisPreset,
  ModelConfig
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../../ui-feedback";
import AnalysisPageShell from "../analysis-ui/AnalysisPageShell.vue";
import AnalysisModelSettings from "../analysis-ui/AnalysisModelSettings.vue";
import AnalysisRefreshButton from "../analysis-ui/AnalysisRefreshButton.vue";
import AnalysisResultTabs from "./AnalysisResultTabs.vue";
import type { AnalysisSaveInput } from "./analysis-result-content";
import AnalysisSourceControls from "./AnalysisSourceControls.vue";
import LongAnalysisSourceSummary from "./LongAnalysisSourceSummary.vue";
import LongAnalysisTaskSetup from "./LongAnalysisTaskSetup.vue";
import PresetManager from "./PresetManager.vue";
import type { LongBookAnalysisController } from "./useLongBookAnalysis";
import "./long-book-analysis.css";

const t = createScopedTranslator("extras.longBookAnalysis");
const ui = createScopedTranslator("extras.analysisUi");
const props = defineProps<{
  controller: LongBookAnalysisController;
  models: readonly ModelConfig[];
  catalogSnapshot: CatalogSnapshot | null;
}>();
const emit = defineEmits<{
  refreshCatalog: [];
  openEntry: [entry: { libraryId: string; entryId: string }];
}>();
const presetManagerOpen = ref(false);
const presetSaving = ref(false);
const resultSaving = ref(false);
const analysisPage = ref<InstanceType<typeof AnalysisPageShell> | null>(null);
const resultAnchor = ref<HTMLElement | null>(null);
const resetVersion = ref(0);
const activeResultId = ref("");
function clearWorkspace(): void {
  props.controller.resetWorkspace();
  resetVersion.value += 1;
}
async function showResult(id?: string): Promise<void> {
  if (id) activeResultId.value = id;
  await nextTick();
  analysisPage.value?.scrollToResult(resultAnchor.value);
}

watch(
  () => props.controller.status.value,
  (status) => {
    if (
      (status === "completed" || status === "partial") &&
      props.controller.batch.results.value.length
    ) {
      void showResult();
    }
  }
);

async function savePresets(next: LongBookAnalysisPreset[]): Promise<void> {
  presetSaving.value = true;
  try {
    await props.controller.savePresets(next);
    presetManagerOpen.value = false;
    uiMessage.success(t("presetSaved"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("presetSaveFailed")));
  } finally {
    presetSaving.value = false;
  }
}

async function persistResult(
  id: string,
  input: AnalysisSaveInput
): Promise<void> {
  resultSaving.value = true;
  try {
    await props.controller.persistResult(id, input);
    emit("refreshCatalog");
    uiMessage.success(t("resultSaved"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("createEntryFailed")));
  } finally {
    resultSaving.value = false;
  }
}

async function persistResults(
  requests: (AnalysisSaveInput & { id: string })[]
): Promise<void> {
  resultSaving.value = true;
  try {
    const { saved, errors } = await props.controller.persistResults(requests);
    emit("refreshCatalog");
    if (!errors.length)
      uiMessage.success(ui("allResultsSaved", { count: saved }));
    else
      uiMessage.warning(
        ui("someResultsSaveFailed", {
          saved,
          failed: errors.length,
          message: formatError(errors[0], t("createEntryFailed"))
        })
      );
  } finally {
    resultSaving.value = false;
  }
}

onMounted(() => {
  void props.controller.loadPresets().catch((error: unknown) => {
    uiMessage.error(formatError(error, t("loadPresetsFailed")));
  });
});
</script>
<template>
  <AnalysisPageShell
    ref="analysisPage"
    :title="t('novelAnalysis')"
    :description="t('novelAnalysisDescription')"
    class="long-book-analysis-page"
  >
    <template #header-actions>
      <AnalysisSourceControls
        :controller="controller"
        @manage-presets="presetManagerOpen = true"
      >
        <AnalysisModelSettings
          v-model:model-id="controller.selectedModelId.value"
          v-model:thinking-level="controller.selectedThinkingLevel.value"
          :models="models"
          :disabled="controller.isBusy.value"
        />
        <AnalysisRefreshButton
          :busy="controller.isBusy.value"
          :status="controller.status.value"
          :disabled="
            controller.sourcesLoading.value ||
            controller.sourceDeleting.value ||
            controller.presetsLoading.value ||
            presetSaving ||
            resultSaving
          "
          :stop="controller.stop"
          :clear="clearWorkspace"
        />
      </AnalysisSourceControls>
    </template>
    <LongAnalysisSourceSummary :key="resetVersion" :controller="controller" />
    <LongAnalysisTaskSetup
      :key="resetVersion"
      :controller="controller"
      @show-result="showResult"
    />
    <div
      v-if="controller.batch.results.value.length"
      ref="resultAnchor"
      class="analysis-result-anchor"
    >
      <AnalysisResultTabs
        @open-entry="emit('openEntry', $event)"
        v-model:active-id="activeResultId"
        :results="controller.batch.results.value"
        :total="controller.batch.items.value.length"
        :catalog-snapshot="catalogSnapshot"
        :saving="resultSaving"
        :context="controller.batch.context.value"
        @update="(id, result) => controller.batch.updateResult(id, result)"
        @save="persistResult"
        @save-all="persistResults"
      />
    </div>
    <PresetManager
      :open="presetManagerOpen"
      :presets="controller.presets.value"
      :saving="presetSaving"
      @close="presetManagerOpen = false"
      @save="savePresets"
      :load-defaults="controller.loadPresetDefaults"
    />
  </AnalysisPageShell>
</template>
