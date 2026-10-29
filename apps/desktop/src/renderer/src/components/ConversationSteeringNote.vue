<script setup lang="ts">
import type { ChatMessageAttachment } from "../types/conversation";
import AppIcon from "./AppIcon.vue";

/** A message the user sent while the agent was working, drawn as their bubble. */
defineProps<{
  content: string;
  attachments?:
    readonly Pick<ChatMessageAttachment, "id" | "name" | "kind">[] | undefined;
}>();
</script>

<template>
  <div class="steering-note">
    <div class="steering-note-bubble user-message-copy">
      <div v-if="attachments?.length" class="message-attachment-list">
        <span
          v-for="attachment in attachments"
          :key="attachment.id"
          class="message-attachment-chip"
          :title="attachment.name"
        >
          <AppIcon
            :name="attachment.kind === 'image' ? 'image' : 'file'"
            :size="14"
          />
          <span>{{ attachment.name }}</span>
        </span>
      </div>
      {{ content }}
    </div>
  </div>
</template>

<style scoped>
.steering-note {
  display: flex;
  justify-content: flex-end;
  margin: 6px 0;
}

/* Matches `.message.is-user .message-content` so it reads as the user's turn. */
.steering-note-bubble {
  min-width: 0;
  max-width: 82%;
  padding: 10px 16px;
  border-radius: 19px;
  background: var(--surface-muted);
  color: var(--text-primary);
  font-size: 1rem;
  overflow-wrap: anywhere;
}
</style>
