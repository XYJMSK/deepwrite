import { describe, expect, it } from "vitest";
import type { UserPromptAttachment } from "@deepwrite/contracts";
import {
  createDeferredApi,
  runtime,
  useAgentConversation
} from "./useAgentConversation.test-support";

const task = {
  agentId: "chat-normal" as const,
  profileId: "default",
  input: {}
};
const attachments: UserPromptAttachment[] = [
  {
    id: "text",
    kind: "text",
    name: "novel.txt",
    mediaType: "text/plain",
    size: 12,
    content: "小说正文"
  },
  {
    id: "pdf",
    kind: "text",
    name: "notes.pdf",
    mediaType: "application/pdf",
    size: 20,
    content: "PDF 提取正文"
  },
  {
    id: "image",
    kind: "image",
    name: "cover.png",
    mediaType: "image/png",
    size: 3,
    data: "YWJj"
  }
];

describe("chat attachments", () => {
  it.each(["", "分析这些文件"])(
    "sends attachments through the extras conversation with draft %j",
    async (draft) => {
      const deferred = createDeferredApi();
      const controller = useAgentConversation({ api: () => deferred.api });
      try {
        controller.draft.value = draft;
        const sending = controller.sendAssistantMessage(task, attachments);
        expect(deferred.prompts).toEqual([]);
        expect(deferred.chatRuns[0]?.conversation).toEqual({
          message: draft || "请阅读并分析我上传的附件。",
          attachments
        });
        expect(
          structuredClone(deferred.chatRuns[0]?.conversation?.attachments)
        ).toEqual(attachments);
        deferred.resolveAccepted(0, {
          sessionId: controller.sessionId.value,
          runId: "run-attachments",
          acceptedAt: "2026-10-29T00:00:00.000Z",
          runtime
        });
        await sending;
        expect(controller.messages.value[0]?.attachments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "novel.txt" }),
            expect.objectContaining({ name: "cover.png" })
          ])
        );
      } finally {
        controller.dispose();
      }
    }
  );

  it("keeps an over-budget attachment turn out of the API", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({
      api: () => deferred.api,
      contextCompactionBudgetTokens: () => 64_000
    });
    try {
      controller.draft.value = "请分析";
      await controller.sendAssistantMessage(task, [
        {
          ...attachments[0]!,
          kind: "text",
          content: "字".repeat(60_000)
        } as UserPromptAttachment
      ]);
      expect(deferred.chatRuns).toEqual([]);
      expect(controller.draft.value).toBe("请分析");
      expect(controller.conversationError.value).toContain("超过");
    } finally {
      controller.dispose();
    }
  });
});
