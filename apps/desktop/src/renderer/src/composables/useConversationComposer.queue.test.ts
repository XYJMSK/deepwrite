import { effectScope, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { UserPromptAttachment } from "@deepwrite/contracts/renderer";
import { useConversationComposer } from "./useConversationComposer";

const reference: UserPromptAttachment = {
  id: "note",
  kind: "text",
  name: "note.txt",
  mediaType: "text/plain",
  size: 4,
  content: "设定笔记"
};

function runningComposer(queueAccepts: boolean) {
  const scope = effectScope();
  const draft = ref("");
  const pendingAttachments = ref<UserPromptAttachment[]>([]);
  const emitSend = vi.fn();
  const emitQueue = vi.fn(() => queueAccepts);
  const composer = scope.run(() =>
    useConversationComposer({
      draft: () => draft.value,
      // The run blocks ordinary sending; only the queue accepts input.
      canSend: () => false,
      canSendAttachments: () => false,
      responding: () => true,
      canQueue: () => true,
      runtimeAvailable: () => true,
      libraryDomain: () => undefined,
      availableSkills: () => [],
      availableMaterials: () => [],
      availableTeamMembers: () => null,
      editorReferences: () => [],
      textAttachmentMaxCharacters: () => 50_000,
      textAttachmentsTotalMaxCharacters: () => 100_000,
      pendingAttachments,
      readingAttachments: ref(false),
      emitDraft: vi.fn(),
      emitSend,
      emitQueue,
      emitClearEditorReferences: vi.fn()
    })
  )!;
  return { scope, draft, pendingAttachments, emitSend, emitQueue, composer };
}

describe("conversation composer while the agent runs", () => {
  it("submits into the queue once there is something to send", () => {
    const { scope, draft, pendingAttachments, emitSend, emitQueue, composer } =
      runningComposer(true);
    try {
      expect(composer.hasContent.value).toBe(false);
      expect(composer.canSubmit.value).toBe(false);
      draft.value = "主角改名林舟";
      pendingAttachments.value = [reference];
      expect(composer.canSubmit.value).toBe(true);
      composer.handleKeydown({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        preventDefault: vi.fn()
      } as unknown as KeyboardEvent);
      expect(emitQueue).toHaveBeenCalledWith([reference]);
      expect(emitSend).not.toHaveBeenCalled();
      expect(pendingAttachments.value).toEqual([]);
    } finally {
      scope.stop();
    }
  });

  it("keeps attachments when the queue is full", () => {
    const { scope, draft, pendingAttachments, emitQueue, composer } =
      runningComposer(false);
    try {
      draft.value = "第六条";
      pendingAttachments.value = [reference];
      composer.submitMessage();
      expect(emitQueue).toHaveBeenCalledOnce();
      expect(pendingAttachments.value).toEqual([reference]);
    } finally {
      scope.stop();
    }
  });
});
