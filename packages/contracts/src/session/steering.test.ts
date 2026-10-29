import { describe, expect, it } from "vitest";
import { createEnvelope } from "../envelope";
import { CommandEnvelopeSchema, SystemEventEnvelopeSchema } from "../system";
import { SessionSteerCommandPayloadSchema } from "./steering";

const runtime = { provider: "example", model: "fixture", mode: "local-faux" };
const payload = {
  sessionId: "session",
  runId: "run",
  steerId: "steer_1",
  message: "主角改名林舟"
};

describe("steering contracts", () => {
  it("accepts text attachments and refuses images or blank messages", () => {
    const text = {
      id: "ref",
      kind: "text",
      name: "选段",
      mediaType: "text/markdown",
      size: 4,
      content: "原文选段"
    };
    expect(
      SessionSteerCommandPayloadSchema.safeParse({
        ...payload,
        attachments: [text]
      }).success
    ).toBe(true);
    expect(
      SessionSteerCommandPayloadSchema.safeParse({
        ...payload,
        attachments: [
          {
            id: "img",
            kind: "image",
            name: "图.png",
            mediaType: "image/png",
            size: 3,
            data: "AAAA"
          }
        ]
      }).success
    ).toBe(false);
    expect(
      SessionSteerCommandPayloadSchema.safeParse({ ...payload, message: "  " })
        .success
    ).toBe(false);
  });

  it("requires the envelope to name the steered run", () => {
    const valid = createEnvelope("session.steer", payload, {
      id: "cmd",
      context: { correlationId: "cmd", sessionId: "session", runId: "run" }
    });
    expect(CommandEnvelopeSchema.safeParse(valid).success).toBe(true);
    const mismatched = createEnvelope("session.steer", payload, {
      id: "cmd",
      context: { correlationId: "cmd", sessionId: "session", runId: "other" }
    });
    expect(CommandEnvelopeSchema.safeParse(mismatched).success).toBe(false);
  });

  it("parses the delivered event as a system event", () => {
    const event = createEnvelope(
      "agent.steering_delivered",
      {
        sessionId: "session",
        runId: "run",
        messageId: "run_assistant",
        steerId: "steer_1",
        content: "主角改名林舟",
        deliveredAt: "2026-10-28T08:00:00.000Z",
        runtime
      },
      {
        id: "evt",
        context: { correlationId: "evt", sessionId: "session", runId: "run" }
      }
    );
    expect(SystemEventEnvelopeSchema.safeParse(event).success).toBe(true);
  });
});
