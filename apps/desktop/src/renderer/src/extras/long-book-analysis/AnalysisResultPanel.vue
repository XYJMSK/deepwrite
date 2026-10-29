<script setup lang="ts">
import type { SavedLibraryEntry } from "../analysis-ui/preset-batch";
import { presetLabel } from "../analysis-ui/preset-labels";
import { createScopedTranslator } from "../../i18n";
import { computed, ref, watch } from "vue";
import type {
  CatalogSnapshot,
  LongBookAnalysisPreset,
  LongBookAnalysisResult
} from "@deepwrite/contracts/renderer";
import MarkdownContent from "../../components/MarkdownContent.vue";
import PopupSelect, {
  type PopupSelectOption
} from "../../components/PopupSelect.vue";
import {
  analysisLibraryOption,
  analysisOutputTypeLabel,
  compatibleAnalysisLibraries
} from "./task-options";

const t = createScopedTranslator("extras");

const props = defineProps<{
  result: LongBookAnalysisResult;
  preset: LongBookAnalysisPreset;
  catalogSnapshot: CatalogSnapshot | null;
  saving: boolean;
  savedEntry?: SavedLibraryEntry | undefined;
  previous?: boolean;
  context?: string;
  eyebrow?: string | undefined;
  /** Lets result tabs share one destination across compatible results. */
  targetId?: string | undefined;
}>();
const emit = defineEmits<{
  openEntry: [entry: SavedLibraryEntry];
  update: [result: LongBookAnalysisResult];
  "update:targetId": [libraryId: string];
  save: [
    input: {
      libraryId: string;
      baseProjectRevision?: number;
    }
  ];
}>();

const localTargetId = ref("");
const targetId = computed({
  get: () => props.targetId ?? localTargetId.value,
  set: (value: string) => {
    if (props.targetId === undefined) localTargetId.value = value;
    else emit("update:targetId", value);
  }
});
const editing = ref(false);
const compatibleLibraries = computed(() =>
  compatibleAnalysisLibraries(props.preset, props.catalogSnapshot)
);
const targetOptions = computed<PopupSelectOption[]>(() =>
  compatibleLibraries.value.map(analysisLibraryOption)
);
const targetLibrary = computed(() => {
  return compatibleLibraries.value.find(
    (library) => library.id === targetId.value
  );
});
const outputTypeLabel = computed(() => analysisOutputTypeLabel(props.preset));

watch(
  [() => props.preset, compatibleLibraries],
  ([preset, libraries], previous) => {
    // A newly completed result always requires an explicit destination choice.
    if (
      preset !== previous[0] ||
      !libraries.some((library) => library.id === localTargetId.value)
    )
      localTargetId.value = "";
  },
  { immediate: true }
);

function updateName(event: Event): void {
  const element = event.target;
  if (element instanceof HTMLInputElement)
    emit("update", { ...props.result, name: element.value });
}

function updateDescription(event: Event): void {
  const element = event.target;
  if (element instanceof HTMLTextAreaElement)
    emit("update", { ...props.result, description: element.value });
}

function updateContent(event: Event): void {
  const element = event.target;
  if (element instanceof HTMLTextAreaElement)
    emit("update", { ...props.result, content: element.value });
}

function save(): void {
  if (!targetLibrary.value) return;
  emit("save", {
    libraryId: targetLibrary.value.id,
    ...(targetLibrary.value.projectRevision === undefined
      ? {}
      : { baseProjectRevision: targetLibrary.value.projectRevision })
  });
}
</script>

<template>
  <section class="analysis-card result-card">
    <slot name="before" />
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">
          {{
            eyebrow ||
            (previous
              ? t("longBookAnalysis.previousCompletedResult")
              : t("longBookAnalysis.analysisResult"))
          }}
        </p>
        <h2>{{ result.name }}</h2>
        <p class="analysis-result-origin">
          {{ context }} · {{ presetLabel(preset) }}
        </p>
      </div>
      <button type="button" :aria-pressed="editing" @click="editing = !editing">
        {{
          editing
            ? t("longBookAnalysis.finishEditing")
            : t("longBookAnalysis.editResult")
        }}
      </button>
    </header>
    <div v-if="editing" class="analysis-result-editor">
      <input
        class="result-title"
        :value="result.name"
        maxlength="256"
        :aria-label="t('longBookAnalysis.resultName')"
        @input="updateName"
      />
      <textarea
        class="result-description"
        :value="result.description"
        maxlength="1000"
        rows="3"
        :aria-label="t('longBookAnalysis.resultDescription')"
        :placeholder="t('longBookAnalysis.resultDescriptionPlaceholder')"
        @input="updateDescription"
      />
      <textarea
        class="result-body"
        :value="result.content"
        maxlength="200000"
        :aria-label="t('longBookAnalysis.resultMarkdown')"
        @input="updateContent"
      />
    </div>
    <div v-else class="analysis-result-reading">
      <p v-if="result.description" class="analysis-result-description">
        {{ result.description }}
      </p>
      <MarkdownContent :content="result.content" />
    </div>
    <div class="result-save-row">
      <div class="result-target-library">
        <label>
          <span>{{
            t("longBookAnalysis.saveToLibrary", {
              library:
                preset.output.domain === "material"
                  ? t("cloudBackup.materialLibrary")
                  : t("cloudBackup.skillLibrary")
            })
          }}</span>
          <PopupSelect
            v-model="targetId"
            :options="targetOptions"
            :accessible-label="t('longBookAnalysis.resultTargetLibrary')"
            :placeholder="
              targetOptions.length
                ? t('longBookAnalysis.chooseLibrary')
                : t('longBookAnalysis.noCompatibleLibrary')
            "
            :disabled="saving || targetOptions.length === 0"
            :menu-min-width="280"
          />
        </label>
        <small>{{
          t("longBookAnalysis.targetCanChange", {
            type: outputTypeLabel
          })
        }}</small>
      </div>
      <button
        v-if="savedEntry"
        type="button"
        @click="emit('openEntry', savedEntry)"
      >
        {{ t("analysisUi.goToSavedEntry") }}
      </button>
      <button
        class="analysis-primary-button"
        type="button"
        :disabled="saving || !targetLibrary"
        @click="save"
      >
        {{
          saving
            ? t("longBookAnalysis.writing")
            : t("longBookAnalysis.writeLibrary", {
                library:
                  preset.output.domain === "material"
                    ? t("cloudBackup.materialLibrary")
                    : t("cloudBackup.skillLibrary")
              })
        }}
      </button>
    </div>
    <p class="analysis-help">
      {{
        t("longBookAnalysis.saveCreatesEntry", {
          description: previous
            ? t("longBookAnalysis.previousResultDescription")
            : t("longBookAnalysis.editBeforeSaving")
        })
      }}
    </p>
  </section>
</template>

<style scoped src="./analysis-result-panel.css"></style>
