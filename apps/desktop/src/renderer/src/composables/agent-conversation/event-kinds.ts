import type { SystemEventEnvelope } from "@deepwrite/contracts";
import type { SubagentEventEnvelope } from "./types";
export function isAgentEvent(event: SystemEventEnvelope): event is Extract<
  SystemEventEnvelope,
  {
    type:
      | "agent.evaluation_snapshot"
      | "agent.turn_started"
      | "agent.retry_scheduled"
      | "agent.context_compaction"
      | "agent.message_delta"
      | "agent.thinking_delta"
      | "agent.message_completed"
      | "agent.usage_observed"
      | "agent.user_input_requested"
      | "agent.steering_delivered"
      | "agent.error"
      | "tool.call_stream"
      | "tool.call_requested"
      | "tool.execution_completed"
      | "subagent.planned"
      | "subagent.started"
      | "subagent.activity"
      | "subagent.completed"
      | "subagent.draw_updated";
  }
> {
  return (
    event.type === "agent.evaluation_snapshot" ||
    event.type === "agent.turn_started" ||
    event.type === "agent.retry_scheduled" ||
    event.type === "agent.context_compaction" ||
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta" ||
    event.type === "agent.message_completed" ||
    event.type === "agent.usage_observed" ||
    event.type === "agent.user_input_requested" ||
    event.type === "agent.steering_delivered" ||
    event.type === "agent.error" ||
    event.type === "tool.call_stream" ||
    event.type === "tool.call_requested" ||
    event.type === "tool.execution_completed" ||
    event.type === "subagent.planned" ||
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed" ||
    event.type === "subagent.draw_updated"
  );
}
export function isSubagentEvent(
  event: SystemEventEnvelope
): event is SubagentEventEnvelope {
  return (
    event.type === "subagent.started" ||
    event.type === "subagent.activity" ||
    event.type === "subagent.completed"
  );
}

/** Parent or child text that is held until the next frame. */
export function isStreamedTextDelta(event: SystemEventEnvelope): boolean {
  if (
    event.type === "agent.message_delta" ||
    event.type === "agent.thinking_delta"
  ) {
    return true;
  }
  return (
    event.type === "subagent.activity" &&
    (event.payload.activity.type === "thinking_delta" ||
      event.payload.activity.type === "message_delta")
  );
}
