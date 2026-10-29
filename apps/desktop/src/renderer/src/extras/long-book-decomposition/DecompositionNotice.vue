<script setup lang="ts">
import { nextTick, ref, useId } from "vue";
import { createScopedTranslator } from "../../i18n";
import { decompositionDialogKeydown } from "./dialog-keys";

const t = createScopedTranslator("extras.longBookDecomposition");
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
const titleId = useId();

async function show() {
  open.value = true;
  await nextTick();
  closeButton.value?.focus();
}
async function close() {
  open.value = false;
  await nextTick();
  trigger.value?.focus();
}
</script>

<template>
  <button ref="trigger" type="button" aria-haspopup="dialog" @click="show">
    {{ t("noticeTitle") }}
  </button>
  <Teleport to="body">
    <div v-if="open" class="analysis-refresh-backdrop" @mousedown.self="close">
      <section
        ref="dialog"
        class="analysis-refresh-dialog decomposition-notice"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @keydown="decompositionDialogKeydown($event, dialog, close)"
      >
        <h2 :id="titleId">{{ t("noticeTitle") }}</h2>
        <ol>
          <li>{{ t("noticeModel") }}</li>
          <li>{{ t("noticeMode") }}</li>
          <li>{{ t("noticeResume") }}</li>
          <li>{{ t("noticeTokens") }}</li>
        </ol>
        <div class="analysis-refresh-dialog-actions">
          <button ref="closeButton" type="button" @click="close">
            {{ t("close") }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.decomposition-notice {
  width: min(560px, 100%);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
}
.decomposition-notice ol {
  margin: 16px 0 0;
  padding-left: 1.5em;
  color: var(--text-secondary);
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.decomposition-notice li + li {
  margin-top: 12px;
}
</style>
