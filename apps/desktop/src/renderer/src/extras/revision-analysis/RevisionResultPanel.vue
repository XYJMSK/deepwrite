<script setup lang="ts">
import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { computed, ref, watch } from "vue";
import type { CatalogSnapshot } from "@deepwrite/contracts/renderer";
import MarkdownContent from "../../components/MarkdownContent.vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { uiMessage } from "../../ui-feedback";
import type { RevisionAnalysisController } from "./useRevisionAnalysis";

const t = createScopedTranslator("extras");
const props = defineProps<{
  controller: RevisionAnalysisController;
  catalogSnapshot: CatalogSnapshot | null;
}>();
const emit = defineEmits<{
  refreshCatalog: [];
  openEntry: [entry: { libraryId: string; entryId: string }];
}>();
const c = props.controller;
const libraryId = ref("");
const libraries = computed(() =>
  (props.catalogSnapshot?.skills ?? []).filter((l) => !l.isBuiltin)
);
const saved = computed(() => c.savedKey.value === c.skillKey());
watch(c.result, (result, previous) => {
  if (result !== previous) libraryId.value = "";
});
watch(libraries, (available) => {
  if (!available.some((library) => library.id === libraryId.value))
    libraryId.value = "";
});
async function save() {
  const library = libraries.value.find((l) => l.id === libraryId.value);
  if (!library) {
    uiMessage.error(t("revisionAnalysis.targetSkillRequired"));
    return;
  }
  try {
    if (await c.persistSkill(library)) {
      emit("refreshCatalog");
      uiMessage.success(t("revisionAnalysis.skillSaved"));
    }
  } catch (error) {
    uiMessage.error(formatError(error, t("revisionAnalysis.saveSkillFailed")));
  }
}
</script>
<template>
  <section v-if="c.result.value" class="analysis-card revision-result">
    <header>
      <h2>
        {{
          c.isPreviousResult.value
            ? t("revisionAnalysis.previousAnalysisResult")
            : t("longBookAnalysis.analysisResult")
        }}
      </h2>
      <span v-if="c.isPreviousResult.value">{{
        c.isBusy.value
          ? t("revisionAnalysis.updateAfterAnalysis")
          : t("revisionAnalysis.previousResultRetained")
      }}</span>
    </header>
    <template v-if="c.result.value.report">
      <h3>{{ t("revisionAnalysis.revisionReport") }}</h3>
      <MarkdownContent
        class="revision-report"
        :content="c.result.value.report"
      />
    </template>
    <h3>{{ t("revisionAnalysis.reusableSkillDraft") }}</h3>
    <label
      >{{ t("revisionAnalysis.skillTitle")
      }}<input
        v-model="c.result.value.title"
        maxlength="256"
        :disabled="c.disabled.value"
    /></label>
    <label
      >{{ t("revisionAnalysis.skillDescription")
      }}<textarea
        v-model="c.result.value.description"
        maxlength="4000"
        :disabled="c.disabled.value"
        :placeholder="t('revisionAnalysis.skillDescriptionPlaceholder')"
      />
    </label>
    <label
      >{{ t("revisionAnalysis.skillBody")
      }}<textarea
        v-model="c.result.value.body"
        class="revision-skill-body"
        maxlength="200000"
        :disabled="c.disabled.value"
      />
    </label>
    <div class="revision-save-controls">
      <label
        >{{ t("revisionAnalysis.targetSkillLibrary")
        }}<PopupSelect
          v-model="libraryId"
          :options="libraries.map((l) => ({ value: l.id, label: l.title }))"
          :disabled="c.disabled.value"
          :accessible-label="t('revisionAnalysis.revisionTargetSkillLibrary')"
          :placeholder="
            libraries.length
              ? t('revisionAnalysis.chooseSkillLibrary')
              : t('revisionAnalysis.createSkillLibraryFirst')
          "
      /></label>
      <button
        v-if="saved && c.savedEntry.value"
        type="button"
        @click="emit('openEntry', c.savedEntry.value)"
      >
        {{ t("analysisUi.goToSavedEntry") }}
      </button>
      <button
        class="analysis-primary-button"
        :disabled="
          c.disabled.value ||
          !libraryId ||
          saved ||
          !c.result.value.title.trim() ||
          !c.result.value.description?.trim() ||
          !c.result.value.body.trim()
        "
        @click="save"
      >
        {{
          c.saving.value
            ? t("longBookAnalysis.saving")
            : saved
              ? t("revisionAnalysis.skillVersionSaved")
              : c.isPreviousResult.value
                ? t("revisionAnalysis.savePreviousToSkills")
                : t("revisionAnalysis.saveToSkills")
        }}
      </button>
    </div>
  </section>
</template>
