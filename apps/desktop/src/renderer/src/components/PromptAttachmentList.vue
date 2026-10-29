<script setup lang="ts">
import type { UserPromptAttachment } from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import {
  attachmentPreview,
  formatFileSize
} from "../composables/useConversationAttachments";
import AppIcon from "./AppIcon.vue";
const t = createScopedTranslator("components.conversationComposer");
defineProps<{
  pendingAttachments: UserPromptAttachment[];
  readingAttachments: boolean;
}>();
const emit = defineEmits<{ remove: [id: string] }>();
</script>

<template>
  <div
    v-if="pendingAttachments.length || readingAttachments"
    class="composer-attachment-list"
    :aria-label="t('attachmentsToSend')"
  >
    <article
      v-for="attachment in pendingAttachments"
      :key="attachment.id"
      class="composer-attachment-chip"
    >
      <img
        v-if="attachmentPreview(attachment)"
        :src="attachmentPreview(attachment)"
        alt=""
      />
      <span v-else class="composer-attachment-icon" aria-hidden="true">
        <AppIcon name="file" :size="16" />
      </span>
      <span class="composer-attachment-copy">
        <strong>{{ attachment.name }}</strong>
        <small>
          {{
            attachment.kind === "image"
              ? t("image")
              : attachment.mediaType === "application/pdf"
                ? t("pDFText")
                : t("text")
          }}
          · {{ formatFileSize(attachment.size) }}
          <template v-if="attachment.kind === 'text' && attachment.truncated">
            {{ t("truncated") }}</template
          >
        </small>
      </span>
      <button
        type="button"
        :aria-label="
          t('removeAttachmentValue', {
            arg0: attachment.name
          })
        "
        @click="emit('remove', attachment.id)"
      >
        <AppIcon name="close" :size="13" />
      </button>
    </article>
    <span v-if="readingAttachments" class="composer-attachment-loading">
      {{ t("readingAttachments") }}
    </span>
  </div>
</template>
