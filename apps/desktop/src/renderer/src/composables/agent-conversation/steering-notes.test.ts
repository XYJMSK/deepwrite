import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../types/conversation";
import { cloneMessage } from "./clone";
import { buildConversationRestore } from "./history";
import { parseStoredMessage } from "./parse-message";
import { appendSteeringNote, steeringNotes } from "./steering-notes";

const createdAt = "2026-10-28T08:00:00.000Z";

function reply(): ChatMessage {
  return {
    id: "run_1_assistant",
    role: "assistant",
    content: "第三章写好了。",
    createdAt,
    runId: "run_1",
    status: "completed",
    processingSteps: [
      { id: "step_1", type: "response", content: "先读大纲。", createdAt }
    ]
  };
}

describe("steering notes", () => {
  it("records each delivered steer once, at its place in the timeline", () => {
    const message = reply();
    const payload = {
      steerId: "steer_1",
      content: "主角改名林舟",
      attachments: [
        {
          id: "ref_1",
          name: "第三章选段",
          kind: "text" as const,
          mediaType: "text/markdown",
          size: 12,
          truncated: true as const
        }
      ],
      deliveredAt: createdAt
    };
    appendSteeringNote(message, payload);
    appendSteeringNote(message, payload);
    expect(steeringNotes(message)).toEqual([
      {
        id: "note:steer_1",
        type: "user_note",
        noteId: "steer_1",
        content: "主角改名林舟",
        attachments: [payload.attachments[0]],
        createdAt
      }
    ]);
  });

  it("survives storage and cloning", () => {
    const message = reply();
    appendSteeringNote(message, {
      steerId: "steer_1",
      content: "第三段别动",
      deliveredAt: createdAt
    });
    const stored = parseStoredMessage(JSON.parse(JSON.stringify(message)));
    expect(steeringNotes(stored)).toHaveLength(1);
    const copy = cloneMessage(stored!);
    expect(copy.processingSteps).toEqual(stored!.processingSteps);
    expect(copy.processingSteps).not.toBe(stored!.processingSteps);
  });

  it("restores additions with the request they amended", () => {
    const answer = reply();
    appendSteeringNote(answer, {
      steerId: "steer_1",
      content: "主角改名林舟",
      deliveredAt: createdAt
    });
    const { history } = buildConversationRestore([
      { id: "user_1", role: "user", content: "写第三章", createdAt },
      answer
    ]);
    expect(history).toHaveLength(2);
    expect(history[0]?.content).toContain("写第三章");
    expect(history[0]?.content).toContain("主角改名林舟");
    expect(history[1]?.content).toBe("第三章写好了。");
  });
});
