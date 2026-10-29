import {
  SessionSteerAcceptedPayloadSchema,
  SessionSteerCommandPayloadSchema,
  createEnvelope,
  type SessionSteerAcceptedPayload,
  type SessionSteerCommandPayload
} from "@deepwrite/contracts";

import { browserId, invokeCommand } from "./invoke";

export async function steer(
  rawPayload: SessionSteerCommandPayload
): Promise<SessionSteerAcceptedPayload> {
  const payload = SessionSteerCommandPayloadSchema.parse(rawPayload);
  const id = browserId("cmd_steer");
  const accepted = SessionSteerAcceptedPayloadSchema.parse(
    await invokeCommand<SessionSteerAcceptedPayload>(
      createEnvelope("session.steer", payload, {
        id,
        context: {
          correlationId: id,
          sessionId: payload.sessionId,
          runId: payload.runId
        }
      })
    )
  );
  if (
    accepted.sessionId !== payload.sessionId ||
    accepted.runId !== payload.runId ||
    accepted.steerId !== payload.steerId
  ) {
    throw new Error("Steering acceptance does not match the request.");
  }
  return accepted;
}
