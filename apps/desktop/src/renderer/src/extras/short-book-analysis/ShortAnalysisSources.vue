<script setup lang="ts">
import { getErrorDetail } from "../../i18n/errors";
import { createScopedTranslator, locale } from "../../i18n";
import { computed, ref, watch } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import { uiMessage } from "../../ui-feedback";
import type { ShortBookAnalysisController } from "./useShortBookAnalysis";

const t = createScopedTranslator("extras");
const props = defineProps<{ controller: ShortBookAnalysisController }>();
const c = props.controller;
const expanded = ref(false);
const editing = computed(() =>
  c.drafts.value.find((b) => b.id === c.activeId.value)
);
const title = ref("");
const text = ref("");
const disabled = computed(() => c.isBusy.value || c.loading.value);
watch(
  editing,
  (book) => {
    title.value = book?.title ?? "";
    text.value = book?.text ?? "";
  },
  { immediate: true }
);
async function act(action: () => unknown) {
  try {
    await action();
  } catch (error) {
    uiMessage.warning(
      getErrorDetail(error) ?? t("shortBookAnalysis.sourceOperationFailed")
    );
  }
}
function save() {
  return act(() => {
    if (editing.value)
      c.updateBook(editing.value.id, { title: title.value, text: text.value });
  });
}
function removeBook(id: string) {
  return act(() => {
    c.removeBook(id);
    uiMessage.success(t("shortBookAnalysis.removedFromList"));
  });
}
</script>
<template>
  <section v-if="c.drafts.value.length" class="analysis-card short-source-card">
    <header class="analysis-card-heading">
      <div>
        <p class="analysis-eyebrow">
          {{ t("shortBookAnalysis.analysisSources") }}
        </p>
        <h2>
          {{
            t("shortBookAnalysis.selectedBookCount", {
              selected: c.selectedIds.value.length,
              total: c.selectionLimit.value
            })
          }}
        </h2>
      </div>
      <button
        type="button"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{
          expanded
            ? t("longBookAnalysis.collapseText")
            : t("longBookAnalysis.reviewAndCorrect")
        }}
      </button>
    </header>
    <div class="short-source-workspace" :class="{ 'is-expanded': expanded }">
      <div class="short-list-pane">
        <div v-if="expanded" class="short-list-heading">
          <strong>{{ t("shortBookAnalysis.storyList") }}</strong
          ><span>{{
            t("shortBookAnalysis.selectedBookCount", {
              selected: c.selectedIds.value.length,
              total: c.selectionLimit.value
            })
          }}</span>
        </div>
        <ul class="short-book-list">
          <li
            v-for="book in c.drafts.value"
            :key="book.id"
            :class="{ selected: c.activeId.value === book.id }"
          >
            <input
              :type="c.selectionLimit.value === 1 ? 'radio' : 'checkbox'"
              name="short-analysis-book"
              :aria-label="
                t('shortBookAnalysis.selectBook', { title: book.title })
              "
              :checked="c.selectedIds.value.includes(book.id)"
              :disabled="
                disabled ||
                (c.selectionLimit.value > 1 &&
                  !c.selectedIds.value.includes(book.id) &&
                  c.selectedIds.value.length >= c.selectionLimit.value)
              "
              @change="act(() => c.toggleBook(book.id))"
            /><button
              class="short-book-open"
              :disabled="disabled"
              @click="
                c.selectionLimit.value === 1
                  ? act(() => c.toggleBook(book.id))
                  : (c.activeId.value = book.id)
              "
            >
              <strong>{{ book.title }}</strong
              ><small>{{
                t("longBookAnalysis.characterCount", {
                  count: book.text.length.toLocaleString(locale)
                })
              }}</small>
            </button>
            <button
              type="button"
              class="short-book-remove"
              :aria-label="
                t('shortBookAnalysis.removeBook', { title: book.title })
              "
              :title="t('shortBookAnalysis.removeKeepImported')"
              :disabled="disabled"
              @click="removeBook(book.id)"
            >
              {{ t("shortBookAnalysis.remove") }}
            </button>
          </li>
        </ul>
      </div>
      <div v-if="editing && expanded" class="short-text-editor">
        <label
          >{{ t("shortBookAnalysis.bookTitle")
          }}<input
            v-model="title"
            :disabled="disabled"
            maxlength="256"
            @change="save" /></label
        ><label
          >{{ t("shortBookAnalysis.completeText")
          }}<textarea
            v-model="text"
            :disabled="disabled"
            maxlength="2000000"
            @change="save"
          /></label
        ><small>{{ t("shortBookAnalysis.taskEditsOnly") }}</small>
      </div>
    </div>
  </section>
  <section v-else class="analysis-card analysis-empty-source">
    <div class="analysis-empty-icon"><AppIcon name="book" :size="26" /></div>
    <div class="analysis-empty-copy">
      <strong>{{ t("shortBookAnalysis.importStoryToStart") }}</strong>
      <p>{{ t("shortBookAnalysis.storyImportHelp") }}</p>
    </div>
    <div
      class="analysis-empty-meta"
      :aria-label="t('shortBookAnalysis.supportedFormats')"
    >
      <span>TXT</span><span>Markdown</span
      ><span>{{ t("shortBookAnalysis.maxTenBooks") }}</span>
    </div>
  </section>
</template>
