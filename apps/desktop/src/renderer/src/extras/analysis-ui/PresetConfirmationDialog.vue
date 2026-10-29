<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";

defineProps<{
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
}>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
const titleId = useId();
const descriptionId = useId();
const cancelButton = ref<HTMLButtonElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null;
  cancelButton.value?.focus();
});
onBeforeUnmount(() => {
  void nextTick(() => previousFocus?.focus());
});
function onKeydown(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    emit("cancel");
  }
  if (event.key !== "Tab") return;
  const buttons = dialog.value?.querySelectorAll<HTMLButtonElement>("button");
  if (!buttons?.length) return;
  const target = event.shiftKey ? buttons[buttons.length - 1] : buttons[0];
  const edge = event.shiftKey ? buttons[0] : buttons[buttons.length - 1];
  if (document.activeElement === edge) {
    event.preventDefault();
    target?.focus();
  }
}
</script>
<template>
  <Teleport to="body">
    <div
      class="analysis-modal-backdrop preset-confirmation-backdrop"
      @keydown="onKeydown"
    >
      <section
        ref="dialog"
        class="analysis-preset-modal preset-confirmation"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
      >
        <header>
          <h2 :id="titleId">{{ title }}</h2>
        </header>
        <p :id="descriptionId">{{ description }}</p>
        <footer>
          <button
            ref="cancelButton"
            class="analysis-primary-button"
            type="button"
            @click="emit('cancel')"
          >
            {{ cancelLabel }}
          </button>
          <button type="button" @click="emit('confirm')">
            {{ confirmLabel }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped src="../long-book-analysis/preset-manager.css"></style>
<style scoped>
.preset-confirmation-backdrop {
  z-index: 3100;
}
.preset-confirmation {
  width: min(460px, 94vw);
  overflow: auto;
}
.preset-confirmation h2 {
  font-size: 1.1rem;
}
.preset-confirmation > p {
  margin: 0;
  padding: 18px;
  line-height: 1.6;
}
.preset-confirmation > footer {
  justify-content: flex-end;
  flex-wrap: wrap;
}
.preset-confirmation .analysis-primary-button {
  background: var(--text-primary);
  color: var(--surface-main);
}
button {
  font: inherit;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
</style>
