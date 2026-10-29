<script setup lang="ts">
import { ref, watch } from "vue";
import { createScopedTranslator } from "../../i18n";
import PresetConfirmationDialog from "./PresetConfirmationDialog.vue";

const t = createScopedTranslator("extras.analysisUi");
const props = defineProps<{
  open: boolean;
  title: string;
  description?: string;
  closeLabel: string;
  modalClass?: string;
  dirty?: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{ close: []; reset: [] }>();
const confirmation = ref<"discard" | "reset" | null>(null);
watch(
  () => props.open,
  () => {
    confirmation.value = null;
  }
);
function requestClose(): void {
  if (props.busy || confirmation.value) return;
  if (props.dirty) confirmation.value = "discard";
  else emit("close");
}
function requestReset(): void {
  if (!props.busy && !confirmation.value) confirmation.value = "reset";
}
function confirm(): void {
  const action = confirmation.value;
  confirmation.value = null;
  if (props.busy) return;
  if (action === "discard") emit("close");
  else if (action === "reset") emit("reset");
}
defineExpose({ requestClose, requestReset });
</script>
<template>
  <Teleport to="body"
    ><div
      v-if="open"
      class="analysis-modal-backdrop"
      @keydown.esc.stop.prevent="requestClose"
    >
      <section
        class="analysis-preset-modal"
        :class="modalClass"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        :inert="confirmation !== null"
        :aria-busy="busy"
      >
        <header>
          <div>
            <p v-if="description">{{ description }}</p>
            <h2>{{ title }}</h2>
          </div>
          <button type="button" :aria-label="closeLabel" @click="requestClose">
            ×
          </button>
        </header>
        <slot />
        <footer><slot name="footer" :request-close="requestClose" /></footer>
      </section></div
  ></Teleport>
  <PresetConfirmationDialog
    v-if="open && confirmation"
    :title="
      t(confirmation === 'discard' ? 'discardPresetTitle' : 'resetPresetsTitle')
    "
    :description="
      t(
        confirmation === 'discard'
          ? 'discardPresetDescription'
          : 'resetPresetsDescription'
      )
    "
    :cancel-label="t('continuePresetEditing')"
    :confirm-label="
      t(
        confirmation === 'discard'
          ? 'discardPresetChanges'
          : 'confirmResetPresets'
      )
    "
    @cancel="confirmation = null"
    @confirm="confirm"
  />
</template>
<style scoped src="../long-book-analysis/preset-manager.css"></style>
<style scoped>
.analysis-preset-modal > footer :deep(button) {
  border: 0;
  border-radius: 8px;
  padding: 7px 10px;
  background: var(--surface-muted);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
.analysis-preset-modal > footer :deep(.analysis-primary-button) {
  background: var(--text-primary);
  color: var(--surface-main);
}
.analysis-preset-modal :deep(button:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.analysis-preset-modal :deep(button:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
