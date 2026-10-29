import { effectScope, nextTick, ref } from "vue";
import type { UserPromptAttachment } from "@deepwrite/contracts";
import { useComposerQueue } from "./useComposerQueue";
import {
  createDeferredApi,
  createEnvelope,
  describe,
  document,
  eventOptions,
  expect,
  it,
  runtime,
  useAgentConversation,
  vi
} from "./useAgentConversation.test-support";

const image: UserPromptAttachment = {
  id: "image",
  kind: "image",
  name: "cover.png",
  mediaType: "image/png",
  size: 4,
  data: "AAAA"
};

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await nextTick();
    await Promise.resolve();
  }
}

async function startRun(runId = "run_first") {
  const deferred = createDeferredApi();
  const controller = useAgentConversation({
    api: () => deferred.api,
    idleTimeoutMs: 10_000
  });
  controller.followUps.setDispatcher((attachments) =>
    controller.sendMessage(document, [], {}, attachments)
  );
  controller.draft.value = "写第三章";
  const sessionId = controller.sessionId.value;
  const sending = controller.sendMessage(document);
  deferred.resolveAccepted(0, {
    sessionId,
    runId,
    acceptedAt: new Date().toISOString(),
    runtime
  });
  await sending;
  return { controller, deferred, sessionId, runId };
}

function completed(sessionId: string, runId: string, content = "完成") {
  return createEnvelope(
    "agent.message_completed",
    {
      sessionId,
      runId,
      messageId: `${runId}_assistant`,
      role: "assistant" as const,
      content,
      runtime
    },
    eventOptions(sessionId, runId, `evt_${runId}_completed`)
  );
}

function aborted(sessionId: string, runId: string) {
  return createEnvelope(
    "agent.error",
    {
      sessionId,
      runId,
      code: "pi_agent.aborted",
      message: "智能体运行已中止。",
      runtime
    },
    eventOptions(sessionId, runId, `evt_${runId}_aborted`)
  );
}

function delivered(sessionId: string, runId: string, steerId: string) {
  return createEnvelope(
    "agent.steering_delivered",
    {
      sessionId,
      runId,
      messageId: `${runId}_assistant`,
      steerId,
      content: "主角改名林舟",
      deliveredAt: new Date().toISOString(),
      runtime
    },
    eventOptions(sessionId, runId, `evt_${steerId}_delivered`)
  );
}

describe("agent conversation controller: follow-up queue", () => {
  it("sends a message the run missed as the next turn without touching the draft", async () => {
    const { controller, deferred, sessionId, runId } = await startRun();
    expect(controller.followUps.canQueue.value).toBe(true);
    controller.draft.value = "主角改名林舟";
    expect(controller.followUps.enqueue([])).toBe(true);
    expect(controller.draft.value).toBe("");
    controller.draft.value = "还在想的下一句";

    controller.handleEvent(completed(sessionId, runId));
    await settle();

    expect(deferred.prompts).toHaveLength(2);
    expect(deferred.prompts[1]?.message).toBe("主角改名林舟");
    expect(controller.draft.value).toBe("还在想的下一句");
    expect(controller.followUps.items.value).toEqual([]);
    expect(
      controller.messages.value
        .filter((message) => message.role === "user")
        .map((message) => message.content)
    ).toEqual(["写第三章", "主角改名林舟"]);
  });

  it("sends queued messages one turn at a time", async () => {
    const { controller, deferred, sessionId, runId } = await startRun();
    controller.draft.value = "第一条";
    controller.followUps.enqueue([]);
    controller.draft.value = "第二条";
    controller.followUps.enqueue([]);

    controller.handleEvent(completed(sessionId, runId));
    await settle();
    expect(deferred.prompts.map((prompt) => prompt.message)).toEqual([
      "写第三章",
      "第一条"
    ]);
    expect(
      controller.followUps.items.value.map((item) => item.content)
    ).toEqual(["第二条"]);

    deferred.resolveAccepted(1, {
      sessionId,
      runId: "run_second",
      acceptedAt: new Date().toISOString(),
      runtime
    });
    await settle();
    controller.handleEvent(completed(sessionId, "run_second"));
    await settle();
    expect(deferred.prompts[2]?.message).toBe("第二条");
  });

  it("hands the messages back to the composer after a stop", async () => {
    const { controller, deferred, sessionId, runId } = await startRun();
    controller.draft.value = "停下后再说";
    controller.followUps.enqueue([]);
    controller.draft.value = "还有一句";
    controller.followUps.enqueue([image]);
    controller.draft.value = "正在写";
    const pendingAttachments = ref<UserPromptAttachment[]>([]);
    const scope = effectScope();
    scope.run(() =>
      useComposerQueue({
        queue: () => controller.followUps,
        draft: () => controller.draft.value,
        emitDraft: (value) => {
          controller.draft.value = value;
        },
        pendingAttachments,
        tooManyAttachments: () => "附件过多"
      })
    );

    controller.handleEvent(aborted(sessionId, runId));
    await settle();
    scope.stop();
    expect(deferred.prompts).toHaveLength(1);
    expect(controller.followUps.items.value).toEqual([]);
    expect(controller.draft.value).toBe("停下后再说\n还有一句\n正在写");
    expect(pendingAttachments.value).toEqual([image]);
  });

  it("holds an image for the next turn instead of steering", async () => {
    const { controller, deferred, sessionId, runId } = await startRun();
    controller.draft.value = "看这张图";
    controller.followUps.enqueue([image]);
    expect(controller.followUps.items.value[0]?.state).toBe("queued");
    expect(deferred.steers).toEqual([]);

    controller.handleEvent(completed(sessionId, runId));
    await settle();
    expect(deferred.prompts[1]?.message).toBe("看这张图");
  });

  it("steers the running agent and records the delivered note", async () => {
    const { controller, deferred, sessionId, runId } = await startRun();
    controller.draft.value = "主角改名林舟";
    controller.followUps.enqueue([]);
    const item = controller.followUps.items.value[0]!;

    expect(item.state).toBe("steering");
    expect(deferred.steers).toEqual([
      { sessionId, runId, steerId: item.id, message: "主角改名林舟" }
    ]);

    controller.handleEvent(delivered(sessionId, runId, item.id));
    expect(controller.followUps.items.value).toEqual([]);
    const reply = controller.messages.value.find(
      (message) => message.role === "assistant" && message.runId === runId
    );
    expect(reply?.processingSteps).toContainEqual(
      expect.objectContaining({
        type: "user_note",
        noteId: item.id,
        content: "主角改名林舟"
      })
    );

    controller.handleEvent(completed(sessionId, runId));
    await settle();
    expect(deferred.prompts).toHaveLength(1);
    controller.draft.value = "继续";
    void controller.sendMessage(document);
    await settle();
    expect(deferred.prompts[1]?.conversationHistory?.[0]?.content).toContain(
      "主角改名林舟"
    );
  });

  it("sends a steer that missed the run as the next turn", async () => {
    const { controller, deferred, sessionId, runId } = await startRun();
    controller.draft.value = "没赶上的补充";
    controller.followUps.enqueue([]);

    controller.handleEvent(completed(sessionId, runId));
    await settle();
    expect(deferred.prompts[1]?.message).toBe("没赶上的补充");
  });

  it("returns a refused steer to the queue", async () => {
    const { controller, deferred } = await startRun();
    vi.spyOn(deferred.api.session, "steer").mockRejectedValueOnce(
      Object.assign(new Error("本轮已在收尾"), {
        payload: { code: "agent.steering_closed", message: "本轮已在收尾" }
      })
    );
    controller.draft.value = "被拒的补充";
    controller.followUps.enqueue([]);
    await settle();
    expect(controller.followUps.items.value[0]?.state).toBe("queued");
  });

  it("gives a waiting message back and folds unsent ones into the draft", async () => {
    const { controller } = await startRun();
    controller.draft.value = "先撤回";
    controller.followUps.enqueue([image]);
    controller.draft.value = "留在队列";
    controller.followUps.enqueue([]);
    const [first] = controller.followUps.items.value;

    expect(controller.followUps.withdraw(first!.id)?.content).toBe("先撤回");
    expect(
      controller.followUps.items.value.map((item) => item.content)
    ).toEqual(["留在队列"]);

    controller.draft.value = "正在写";
    controller.dispose();
    expect(controller.draft.value).toBe("留在队列\n正在写");
  });

  it("refuses more than five queued messages", async () => {
    const { controller } = await startRun();
    for (let index = 0; index < 5; index += 1) {
      controller.draft.value = `第 ${index} 条`;
      expect(controller.followUps.enqueue([])).toBe(true);
    }
    controller.draft.value = "第六条";
    expect(controller.followUps.enqueue([])).toBe(false);
    expect(controller.draft.value).toBe("第六条");
  });
});
