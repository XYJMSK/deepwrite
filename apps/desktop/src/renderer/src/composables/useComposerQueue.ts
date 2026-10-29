import { watch, type Ref } from "vue";
import type { UserPromptAttachment } from "@deepwrite/contracts";
import { PROMPT_ATTACHMENT_MAX_ITEMS } from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import type { FollowUpQueueController } from "./agent-conversation/follow-up-queue";

/**
 * After a stop or a failed send the queue pauses; its messages go back into
 * the composer ahead of whatever is being typed, so nothing is lost.
 */
export function useComposerQueue(options: {
  queue: () => FollowUpQueueController | undefined;
  draft: () => string;
  emitDraft: (value: string) => void;
  pendingAttachments: Ref<UserPromptAttachment[]>;
  tooManyAttachments: () => string;
}) {
  function takeBack(queue: FollowUpQueueController): void {
    const taken = queue.items.value
      .filter((item) => item.state === "queued")
      .map((item) => queue.withdraw(item.id))
      .filter((item) => item !== undefined);
    if (!taken.length) return;
    const returned = taken.flatMap((item) => item.attachments);
    const room = Math.max(
      0,
      PROMPT_ATTACHMENT_MAX_ITEMS - options.pendingAttachments.value.length
    );
    if (returned.length > room) uiMessage.warning(options.tooManyAttachments());
    options.pendingAttachments.value = [
      ...returned.slice(0, room),
      ...options.pendingAttachments.value
    ];
    const texts = taken.map((item) => item.content);
    const draft = options.draft();
    if (draft.trim()) texts.push(draft);
    options.emitDraft(texts.join("\n"));
  }

  watch(
    () => {
      const queue = options.queue();
      if (!queue?.paused.value) return "";
      return queue.items.value
        .filter((item) => item.state === "queued")
        .map((item) => item.id)
        .join(",");
    },
    (waiting) => {
      const queue = options.queue();
      if (waiting && queue) takeBack(queue);
    },
    { immediate: true }
  );
}
