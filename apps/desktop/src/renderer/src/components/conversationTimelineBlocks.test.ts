import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types/conversation";
import {
  applyContextCompactionEvent,
  parseStoredContextCompactions
} from "../composables/agent-conversation/context-compaction";
import { parseStoredMessage } from "../composables/agent-conversation/parse-message";
import {
  processingLabel,
  processingSpanLabel,
  visibleResponse,
  type ProcessingDisplayItem
} from "./conversationToolPresentation";
import { conversationTimelineBlocks } from "./conversationTimelineBlocks";

const at = (seconds: number): string =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
const runtime = {
  mode: "local-faux" as const,
  provider: "example",
  model: "test"
};

function message(status: "streaming" | "completed"): ChatMessage {
  return {
    id: "assistant-one",
    role: "assistant",
    content: "最终回答",
    createdAt: at(0),
    processingStartedAt: at(0),
    status,
    processingSteps: [
      {
        id: "thinking-a",
        type: "thinking",
        content: "先读取",
        createdAt: at(1)
      }
    ]
  };
}

function compaction(
  item: ChatMessage,
  id: string,
  seconds: number,
  phase: "started" | "completed",
  level: "prune" | "summary"
): void {
  applyContextCompactionEvent(
    item,
    {
      runId: "run-one",
      sessionId: "session-one",
      messageId: item.id,
      runtime,
      phase,
      reason: level === "prune" ? "threshold" : "run_limit",
      level,
      ...(phase === "completed" ? { tokensBefore: 100, tokensAfter: 60 } : {}),
      ...(phase === "completed" && level === "summary"
        ? {
            checkpoint: {
              summary: "已归纳早期讨论",
              createdAt: at(seconds),
              tokensBefore: 100
            }
          }
        : {})
    },
    id,
    at(seconds)
  );
}

function timelineItems(item: ChatMessage): ProcessingDisplayItem[] {
  return (
    conversationTimelineBlocks(item)[0]?.items.flatMap<ProcessingDisplayItem>(
      (step) => (step.type === "work-group" ? step.items : [step])
    ) ?? []
  );
}

describe("conversation compaction placement", () => {
  it("keeps every compaction inside settled processing and shows the final answer once", () => {
    const item = message("completed");
    compaction(item, "prune", 2, "completed", "prune");
    item.processingSteps!.push({
      id: "thinking-b",
      type: "thinking",
      content: "继续写",
      createdAt: at(3)
    });
    item.processingSteps!.push({
      id: "response",
      type: "response",
      content: "最终回答",
      createdAt: at(4)
    });
    compaction(item, "summary-start", 5, "started", "summary");
    compaction(item, "summary-end", 6, "completed", "summary");
    item.processingCompletedAt = at(6);

    const blocks = conversationTimelineBlocks(item);
    expect(blocks.map((block) => block.kind)).toEqual(["processing"]);
    expect(blocks[0]).toMatchObject({
      endedAt: at(6),
      items: [
        {
          type: "work-group",
          items: [
            { id: "thinking-a", type: "thinking" },
            { type: "compaction", compaction: { id: "prune" } },
            { id: "thinking-b", type: "thinking" },
            {
              type: "compaction",
              compaction: { status: "completed", level: "summary" }
            }
          ]
        }
      ]
    });
    expect(visibleResponse(item)).toBe("最终回答");
  });

  it("shows a summary in the same timeline without resetting the run clock", () => {
    const item = message("streaming");
    compaction(item, "summary-start", 2, "started", "summary");
    expect(conversationTimelineBlocks(item).map((block) => block.kind)).toEqual(
      ["processing"]
    );
    expect(conversationTimelineBlocks(item)[0]).toMatchObject({
      live: true,
      items: [
        {
          type: "work-group",
          running: true,
          items: [
            { id: "thinking-a" },
            { type: "compaction", compaction: { status: "running" } }
          ]
        }
      ]
    });
    compaction(item, "summary-end", 3, "completed", "summary");
    item.processingSteps!.push({
      id: "thinking-b",
      type: "thinking",
      content: "继续处理",
      createdAt: at(4)
    });
    const blocks = conversationTimelineBlocks(item);
    expect(blocks.map((block) => block.kind)).toEqual(["processing"]);
    expect(blocks[0]).toMatchObject({
      live: true,
      startedAt: at(0),
      items: [
        {
          type: "work-group",
          items: [
            { id: "thinking-a" },
            { type: "compaction", compaction: { status: "completed" } },
            { id: "thinking-b" }
          ]
        }
      ]
    });
    expect(processingLabel(item, Date.parse(at(65)))).toBe("已处理 1分5秒");
    expect(
      item.processingSteps?.filter((step) => step.type === "compaction")
    ).toHaveLength(1);
  });

  it("preserves summary positions when a live run completes and history is restored", () => {
    const item = message("streaming");
    compaction(item, "summary-one", 2, "completed", "summary");
    item.processingSteps!.push({
      id: "progress",
      type: "response",
      content: "阶段汇报",
      createdAt: at(3)
    });
    compaction(item, "summary-two", 4, "completed", "summary");
    item.processingSteps!.push({
      id: "final-response",
      type: "response",
      content: item.content,
      createdAt: at(5)
    });
    applyContextCompactionEvent(
      item,
      {
        runId: "run-one",
        sessionId: "session-one",
        messageId: item.id,
        runtime,
        phase: "completed",
        reason: "idle",
        level: "summary",
        checkpoint: {
          summary: "收尾摘要",
          createdAt: at(6),
          tokensBefore: 100
        }
      },
      "summary-idle",
      at(6)
    );
    const liveIds = timelineItems(item).map((step) => step.id);
    expect(liveIds).toEqual([
      "thinking-a",
      "compaction:summary-one",
      "progress",
      "compaction:summary-two",
      "final-response",
      "compaction:summary-idle"
    ]);

    item.status = "completed";
    item.processingCompletedAt = at(7);
    const settled = conversationTimelineBlocks(item);
    expect(settled).toHaveLength(1);
    expect(timelineItems(item).map((step) => step.id)).toEqual(
      liveIds.filter((stepId) => stepId !== "final-response")
    );
    expect(visibleResponse(item)).toBe("最终回答");
    const restored = parseStoredMessage(JSON.parse(JSON.stringify(item)));
    if (!restored) throw new Error("Stored message did not parse");
    expect(conversationTimelineBlocks(restored)).toEqual(settled);
  });

  it("keeps ordinary conversations in one processed section", () => {
    const item = message("streaming");
    item.processingSteps!.push({
      id: "response",
      type: "response",
      content: "正在回答",
      createdAt: at(2)
    });
    const blocks = conversationTimelineBlocks(item);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "processing", live: true });
    if (blocks[0]?.kind === "processing") {
      expect(blocks[0].items.map((step) => step.type)).toEqual([
        "work-group",
        "response"
      ]);
    }
  });

  it("keeps a live processing section while retrying without timeline items", () => {
    const item = message("streaming");
    item.processingSteps = [];
    item.retry = {
      turnId: "retry-turn",
      attempt: 2,
      maxAttempts: 3,
      state: "scheduled"
    };
    expect(conversationTimelineBlocks(item)).toMatchObject([
      { kind: "processing", live: true, items: [] }
    ]);
  });

  it.each(["completed", "stopped", "error"] as const)(
    "keeps one summary across repeated progress replies, compactions and %s",
    (status) => {
      const item = message("streaming");
      for (let round = 1; round <= 3; round += 1) {
        item.processingSteps!.push({
          id: `progress-${round}`,
          type: "response",
          content: `阶段汇报 ${round}`,
          createdAt: at(round * 10)
        });
        compaction(
          item,
          `prune-${round}`,
          round * 10 + 1,
          "completed",
          "prune"
        );
        item.processingSteps!.push({
          id: `thinking-${round}`,
          type: "thinking",
          content: "继续处理",
          createdAt: at(round * 10 + 2)
        });
      }
      item.processingSteps!.push({
        id: "final-response",
        type: "response",
        content: item.content,
        createdAt: at(100)
      });
      const live = conversationTimelineBlocks(item);
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({
        id: `processing:${item.id}`,
        startedAt: at(0),
        live: true
      });
      expect(processingLabel(item, Date.parse(at(120)))).toBe("已处理 2分0秒");

      item.status = status;
      item.processingCompletedAt = at(125);
      const settled = conversationTimelineBlocks(item);
      expect(settled).toHaveLength(1);
      const processing = settled[0];
      if (processing?.kind !== "processing") throw new Error("Missing summary");
      expect(processing.id).toBe(live[0]?.id);
      expect(processing.live).toBe(false);
      expect(
        processing.items
          .filter((step) => step.type === "response")
          .map((step) => step.content)
      ).toEqual(["阶段汇报 1", "阶段汇报 2", "阶段汇报 3"]);
      expect(
        timelineItems(item).filter((step) => step.type === "compaction")
      ).toHaveLength(3);
      expect(visibleResponse(item)).toBe("最终回答");
      expect(processingLabel(item, Date.parse(at(200)))).toBe("已处理 2分5秒");

      const restored = parseStoredMessage(JSON.parse(JSON.stringify(item)));
      if (!restored) throw new Error("Stored message did not parse");
      expect(conversationTimelineBlocks(restored)).toEqual(settled);
    }
  );

  it("restores compaction markers and places older events by their timestamp", () => {
    const item = message("completed");
    compaction(item, "prune", 2, "completed", "prune");
    item.contextCompactions = parseStoredContextCompactions(
      JSON.parse(JSON.stringify(item.contextCompactions))
    );
    const restored = parseStoredMessage(JSON.parse(JSON.stringify(item)));
    expect(restored?.processingSteps?.at(-1)).toMatchObject({
      type: "compaction",
      compactionId: "prune"
    });
    if (!restored) throw new Error("Stored message did not parse");
    expect(
      conversationTimelineBlocks(restored).map((block) => block.kind)
    ).toEqual(["processing"]);
    expect(conversationTimelineBlocks(restored)[0]).toMatchObject({
      items: [
        {
          type: "work-group",
          items: [
            { id: "thinking-a" },
            { type: "compaction", compaction: { id: "prune" } }
          ]
        }
      ]
    });

    restored.processingSteps = (restored.processingSteps ?? []).filter(
      (step) => step.type !== "compaction"
    );
    expect(
      conversationTimelineBlocks(restored).map((block) => block.kind)
    ).toEqual(["processing"]);
  });

  it("keeps old idle compactions inside processing with and without response steps", () => {
    const item = message("completed");
    item.processingSteps!.push({
      id: "terminal-response",
      type: "response",
      content: "最终回答",
      createdAt: at(5)
    });
    item.contextCompactions = [
      {
        id: "old-idle",
        status: "completed",
        reason: "idle",
        level: "prune",
        createdAt: at(4),
        tokensBefore: 100,
        tokensAfter: 60
      }
    ];
    expect(conversationTimelineBlocks(item).map((block) => block.kind)).toEqual(
      ["processing"]
    );
    expect(conversationTimelineBlocks(item)[0]?.items).toMatchObject([
      {
        type: "work-group",
        items: [
          { id: "thinking-a" },
          { type: "compaction", compaction: { id: "old-idle" } }
        ]
      }
    ]);
    expect(visibleResponse(item)).toBe("最终回答");

    item.processingSteps = [];
    expect(conversationTimelineBlocks(item).map((block) => block.kind)).toEqual(
      ["processing"]
    );
    expect(conversationTimelineBlocks(item)[0]?.items).toMatchObject([
      { type: "compaction", compaction: { id: "old-idle" } }
    ]);
    expect(visibleResponse(item)).toBe("最终回答");
  });

  it("keeps a message sent during the reply in view once it ends", () => {
    const item = message("streaming");
    item.processingSteps!.push(
      {
        id: "note:steer-one",
        type: "user_note",
        noteId: "steer-one",
        content: "到开始写正文之前停止",
        createdAt: at(30)
      },
      {
        id: "thinking-b",
        type: "thinking",
        content: "收到，调整计划",
        createdAt: at(31)
      },
      {
        id: "response-final",
        type: "response",
        content: "最终回答",
        createdAt: at(80)
      }
    );
    // While it runs, the bubble sits in the live list where it landed.
    expect(conversationTimelineBlocks(item).map((block) => block.kind)).toEqual(
      ["processing"]
    );

    item.status = "completed";
    item.processingCompletedAt = at(90);
    const blocks = conversationTimelineBlocks(item);
    expect(blocks.map((block) => block.kind)).toEqual([
      "processing",
      "note",
      "processing"
    ]);
    expect(blocks[0]).toMatchObject({
      id: "processing:assistant-one",
      startedAt: at(0),
      endedAt: at(30),
      segment: true
    });
    expect(blocks[1]?.items).toMatchObject([
      { type: "user_note", content: "到开始写正文之前停止" }
    ]);
    expect(blocks[2]).toMatchObject({ startedAt: at(30), endedAt: at(90) });
    expect(processingSpanLabel(blocks[0]!.startedAt, blocks[0]!.endedAt)).toBe(
      processingSpanLabel(at(60), at(90))
    );
    expect(visibleResponse(item)).toBe("最终回答");

    // Nothing after the note but the answer: no empty summary follows it.
    item.processingSteps = item.processingSteps!.filter(
      (step) => step.id !== "thinking-b"
    );
    expect(conversationTimelineBlocks(item).map((block) => block.kind)).toEqual(
      ["processing", "note"]
    );
  });
});
