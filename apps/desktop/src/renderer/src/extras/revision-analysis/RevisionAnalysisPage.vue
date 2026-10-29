<script setup lang="ts">
import { formatError } from "../../i18n/errors";
import { createScopedTranslator, locale } from "../../i18n";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  REVISION_TEXT_LIMIT,
  REVISION_REASON_LIMIT,
  type ModelConfig,
  type CatalogSnapshot
} from "@deepwrite/contracts/renderer";
import AnalysisPageShell from "../analysis-ui/AnalysisPageShell.vue";
import AnalysisModelSettings from "../analysis-ui/AnalysisModelSettings.vue";
import AnalysisRefreshButton from "../analysis-ui/AnalysisRefreshButton.vue";
import AnalysisRunStatus from "../analysis-ui/AnalysisRunStatus.vue";
import { uiMessage } from "../../ui-feedback";
import RevisionDiffList from "./RevisionDiffList.vue";
import RevisionResultPanel from "./RevisionResultPanel.vue";
import type { RevisionAnalysisController } from "./useRevisionAnalysis";
import "./revision-analysis.css";

const t = createScopedTranslator("extras");

const props = defineProps<{
  controller: RevisionAnalysisController;
  models: readonly ModelConfig[];
  catalogSnapshot: CatalogSnapshot | null;
}>();
const emit = defineEmits<{
  refreshCatalog: [];
  openEntry: [entry: { libraryId: string; entryId: string }];
}>();
const c = props.controller;
const materialsOpen = ref(!c.isBusy.value && !c.result.value);
const analysisPage = ref<InstanceType<typeof AnalysisPageShell> | null>(null);
const resultAnchor = ref<HTMLElement | null>(null);
function clearWorkspace(): void {
  c.resetWorkspace();
  materialsOpen.value = true;
}
const canCompare = computed(
  () =>
    !c.disabled.value &&
    Boolean(c.beforeText.value.trim()) &&
    Boolean(c.afterText.value.trim())
);
watch(c.isBusy, (busy) => {
  if (busy) materialsOpen.value = false;
});
watch(c.status, async (status) => {
  if (status !== "completed" || !c.result.value) return;
  await nextTick();
  analysisPage.value?.scrollToResult(resultAnchor.value);
});
async function act(action: () => unknown | Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    uiMessage.error(formatError(error, t("revisionAnalysis.operationFailed")));
  }
}
function pasteDocument(event: ClipboardEvent) {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) return;
  const pasted = event.clipboardData?.getData("text/plain");
  if (pasted === undefined) return;
  const length =
    target.value.length -
    (target.selectionEnd - target.selectionStart) +
    pasted.length;
  if (length > REVISION_TEXT_LIMIT) {
    event.preventDefault();
    uiMessage.error(t("revisionAnalysis.pasteExceedsLimit"));
  }
}
function compare() {
  void act(() => {
    c.compare();
    if (!c.changes.value.length)
      uiMessage.info(t("revisionAnalysis.noParagraphDifferences"));
  });
}
function updateReason(id: string, reason: string) {
  if (c.disabled.value || !c.comparisonCurrent.value) return;
  const change = c.changes.value.find((c) => c.id === id);
  if (change) change.reason = reason;
}
onMounted(() => {
  void act(c.loadSettings);
});
</script>

<template>
  <AnalysisPageShell
    ref="analysisPage"
    class="revision-analysis-page"
    :title="t('revisionAnalysis.revisionAnalysis')"
    :description="t('revisionAnalysis.revisionDescription')"
  >
    <template #header-actions>
      <div class="analysis-header-actions">
        <AnalysisModelSettings
          v-model:model-id="c.selectedModelId.value"
          v-model:thinking-level="c.selectedThinkingLevel.value"
          :models="models"
          :disabled="c.disabled.value"
        />
        <AnalysisRefreshButton
          :busy="c.isBusy.value"
          :status="c.status.value"
          :disabled="c.loading.value || c.saving.value"
          :stop="c.stop"
          :clear="clearWorkspace"
        />
      </div>
    </template>
    <details
      class="analysis-card analysis-materials revision-materials"
      :open="materialsOpen"
      @toggle="materialsOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary>
        <strong>{{ t("revisionAnalysis.prepareMaterials") }}</strong>
        <span>{{
          t("revisionAnalysis.revisionLengths", {
            before: c.beforeText.value.length.toLocaleString(locale),
            after: c.afterText.value.length.toLocaleString(locale)
          })
        }}</span>
      </summary>
      <section class="revision-inputs">
        <label
          >{{ t("revisionAnalysis.beforeRevision")
          }}<textarea
            v-model="c.beforeText.value"
            :maxlength="REVISION_TEXT_LIMIT"
            :disabled="c.disabled.value"
            :placeholder="t('revisionAnalysis.beforePlaceholder')"
            :aria-label="t('revisionAnalysis.beforeText')"
            @paste="pasteDocument"
            spellcheck="false"
          />
          <small>{{
            t("revisionAnalysis.inputCharacterLimit", {
              count: c.beforeText.value.length.toLocaleString(locale)
            })
          }}</small>
        </label>
        <label
          >{{ t("revisionAnalysis.afterRevision")
          }}<textarea
            v-model="c.afterText.value"
            :maxlength="REVISION_TEXT_LIMIT"
            :disabled="c.disabled.value"
            :placeholder="t('revisionAnalysis.afterPlaceholder')"
            :aria-label="t('revisionAnalysis.afterText')"
            @paste="pasteDocument"
            spellcheck="false"
          />
          <small>{{
            t("revisionAnalysis.inputCharacterLimit", {
              count: c.afterText.value.length.toLocaleString(locale)
            })
          }}</small>
        </label>
      </section>
      <details class="revision-method">
        <summary>{{ t("revisionAnalysis.addOverallNotes") }}</summary>
        <label
          >{{ t("revisionAnalysis.overallNotes")
          }}<textarea
            v-model="c.overallReason.value"
            :maxlength="REVISION_REASON_LIMIT"
            :disabled="c.disabled.value"
            :placeholder="t('revisionAnalysis.overallNotesPlaceholder')"
          />
        </label>
      </details>
      <RevisionDiffList
        :changes="c.changes.value"
        :disabled="c.disabled.value"
        :current="c.comparisonCurrent.value"
        :can-compare="canCompare"
        @compare="compare"
        @reason="updateReason"
      />
    </details>
    <section
      class="analysis-run-bar"
      :aria-label="t('revisionAnalysis.revisionActions')"
    >
      <AnalysisRunStatus
        :status="c.status.value"
        :entries="c.entries.value"
        :current-activity="c.activity.value"
        :live-output="c.liveOutput.value"
        :error="c.error.value"
        :title="t('revisionAnalysis.revisionProcess')"
      />
      <p v-if="c.status.value === 'idle'" class="analysis-run-progress">
        {{ t("revisionAnalysis.automaticDiffHelp") }}
      </p>
      <div class="analysis-run-actions">
        <button
          v-if="!c.isBusy.value"
          class="analysis-primary-button"
          :disabled="!c.canStart.value"
          @click="act(c.start)"
        >
          {{
            c.result.value
              ? t("longBookAnalysis.analyzeAgain")
              : t("longBookAnalysis.startAnalysis")
          }}
        </button>
        <button
          v-else
          class="revision-text-button"
          :disabled="c.status.value === 'stopping'"
          @click="act(c.stop)"
        >
          {{
            c.status.value === "stopping"
              ? t("revisionAnalysis.stoppingEllipsis")
              : t("revisionAnalysis.stopAnalysis")
          }}
        </button>
        <button
          v-if="c.canRetry.value"
          class="revision-text-button"
          :disabled="c.disabled.value"
          @click="act(c.retry)"
        >
          {{ t("revisionAnalysis.retryLastTask") }}
        </button>
      </div>
    </section>
    <div
      v-if="c.result.value"
      ref="resultAnchor"
      class="analysis-result-anchor"
    >
      <RevisionResultPanel
        @open-entry="emit('openEntry', $event)"
        :controller="c"
        :catalog-snapshot="catalogSnapshot"
        @refresh-catalog="emit('refreshCatalog')"
      />
    </div>
  </AnalysisPageShell>
</template>
