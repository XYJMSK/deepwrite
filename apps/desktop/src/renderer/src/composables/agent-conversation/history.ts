import { createScopedTranslator } from "../../i18n";
import type {
  ConversationCheckpoint,
  SessionConversationHistoryMessage
} from "@deepwrite/contracts";
import {
  ConversationCheckpointSchema,
  SESSION_CONVERSATION_HISTORY_MAX_MESSAGES,
  SESSION_CONVERSATION_HISTORY_MAX_MESSAGE_LENGTH,
  SESSION_CONVERSATION_HISTORY_MAX_CONTENT_LENGTH
} from "@deepwrite/contracts/renderer";
import type { ChatMessage } from "../../types/conversation";
import { latestConversationCheckpoint } from "./context-compaction";
import { steeringNotes } from "./steering-notes";

const t = createScopedTranslator("workspace.history");

export interface ConversationRestore {
  history: SessionConversationHistoryMessage[];
  /** Summary of the turns before `history`, when the conversation has one. */
  checkpoint?: ConversationCheckpoint;
}

/** Each user message is attributed to the run that answered it. */
function runIdAt(
  messages: readonly ChatMessage[],
  index: number
): string | undefined {
  const message = messages[index];
  if (message?.role === "assistant") return message.runId;
  const reply = messages[index + 1];
  return reply?.role === "assistant" ? reply.runId : undefined;
}

/**
 * Build a bounded, model-visible transcript from persisted presentation state:
 * the latest compaction checkpoint plus the turns it kept verbatim. Runtime
 * restores it only when the in-memory agent for this session is absent.
 */
export function buildConversationRestore(
  messages: readonly ChatMessage[]
): ConversationRestore {
  const located = latestConversationCheckpoint(messages);
  const start = located?.keepFrom ?? 0;
  const history: SessionConversationHistoryMessage[] = [];
  let contentLength = 0;

  for (let index = messages.length - 1; index >= start; index -= 1) {
    const message = messages[index];
    if (!message || message.activityOnly || !message.content.trim()) continue;
    if (!Number.isFinite(Date.parse(message.createdAt))) continue;
    const base = message.attachments?.length
      ? t("historicalAttachmentNoteOnlyAttachmentNamesWereRestoredOriginal", {
          content: message.content,
          map: message.attachments
            .map((attachment) => attachment.name)
            .join("、")
        })
      : message.content;
    // A restored transcript carries only final texts, so additions made
    // during the reply belong with the request they amended, before it.
    const notes =
      message.role === "user" ? steeringNotes(messages[index + 1]) : [];
    const content = notes.length
      ? t("steeringNotes", {
          content: base,
          notes: notes.map((note) => note.content).join("\n")
        })
      : base;
    if (
      history.length >= SESSION_CONVERSATION_HISTORY_MAX_MESSAGES ||
      content.length > SESSION_CONVERSATION_HISTORY_MAX_MESSAGE_LENGTH ||
      contentLength + content.length >
        SESSION_CONVERSATION_HISTORY_MAX_CONTENT_LENGTH
    ) {
      throw new Error(
        t("theConversationHistoryExceedsTheRestorationTransferLimitIt")
      );
    }

    const runId = runIdAt(messages, index);
    history.unshift({
      role: message.role,
      content,
      createdAt: message.createdAt,
      ...(runId ? { runId } : {})
    });
    contentLength += content.length;
  }

  return located
    ? {
        history,
        // Parsing copies the reactive checkpoint (including nested refs) before
        // it crosses contextBridge on the next turn.
        checkpoint: ConversationCheckpointSchema.parse(located.checkpoint)
      }
    : { history };
}

export function buildConversationHistory(
  messages: readonly ChatMessage[]
): SessionConversationHistoryMessage[] {
  return buildConversationRestore(messages).history;
}
