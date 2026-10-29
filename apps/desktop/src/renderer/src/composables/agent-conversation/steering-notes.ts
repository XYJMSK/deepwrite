import type { AgentSteeringDeliveredPayload } from "@deepwrite/contracts";
import type {
  AgentProcessingStep,
  ChatMessage
} from "../../types/conversation";

export type SteeringNoteStep = Extract<
  AgentProcessingStep,
  { type: "user_note" }
>;

/** Records a delivered steer at its place in the run's timeline. */
export function appendSteeringNote(
  message: ChatMessage,
  payload: Pick<
    AgentSteeringDeliveredPayload,
    "steerId" | "content" | "attachments" | "deliveredAt"
  >
): void {
  const steps = (message.processingSteps ??= []);
  if (
    steps.some(
      (step) => step.type === "user_note" && step.noteId === payload.steerId
    )
  ) {
    return;
  }
  steps.push({
    id: `note:${payload.steerId}`,
    type: "user_note",
    noteId: payload.steerId,
    content: payload.content,
    ...(payload.attachments?.length
      ? {
          attachments: payload.attachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            kind: attachment.kind,
            mediaType: attachment.mediaType,
            size: attachment.size,
            ...(attachment.truncated ? { truncated: true } : {})
          }))
        }
      : {}),
    createdAt: payload.deliveredAt
  });
}

/** The user's mid-run additions to a reply, in delivery order. */
export function steeringNotes(
  message: ChatMessage | undefined
): SteeringNoteStep[] {
  if (message?.role !== "assistant") return [];
  return (message.processingSteps ?? []).filter(
    (step): step is SteeringNoteStep => step.type === "user_note"
  );
}
