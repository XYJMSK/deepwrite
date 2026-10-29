import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import type { ChatMessage } from "../types/conversation";
import {
  processingDisplayItems,
  type ProcessingDisplayItem
} from "./conversationToolPresentation";

export interface ConversationTimelineBlock {
  id: string;
  /** A note block holds one message the user sent during the reply. */
  kind: "processing" | "note";
  items: ProcessingDisplayItem[];
  startedAt: string;
  endedAt?: string;
  live: boolean;
  /** Part of a reply that the user's mid-run messages divide. */
  segment?: boolean;
}

/**
 * One run has one processing summary, including every response and compaction.
 * Once the reply ends, messages the user sent during it stay in view: the
 * summary splits around them instead of folding them away.
 */
export function conversationTimelineBlocks(
  message: ChatMessage,
  longProposalItems: readonly LongWorkspaceProposalItem[] = []
): ConversationTimelineBlock[] {
  const items = processingDisplayItems(
    message,
    message.status === "streaming",
    longProposalItems
  );
  if (
    !items.length &&
    !(
      message.status === "streaming" &&
      (message.retry || message.processingStartedAt)
    )
  ) {
    return [];
  }
  const startedAt = message.processingStartedAt ?? message.createdAt;
  const endedAt = message.processingCompletedAt;
  const live = message.status === "streaming";
  if (live || !items.some((item) => item.type === "user_note")) {
    return [
      {
        id: `processing:${message.id}`,
        kind: "processing",
        items,
        startedAt,
        ...(endedAt ? { endedAt } : {}),
        live
      }
    ];
  }
  const blocks: ConversationTimelineBlock[] = [];
  let segment: ProcessingDisplayItem[] = [];
  let segmentStart = startedAt;
  function closeSegment(end: string | undefined): void {
    if (segment.length) {
      blocks.push({
        id: blocks.length
          ? `processing:${segment[0]!.id}`
          : `processing:${message.id}`,
        kind: "processing",
        items: segment,
        startedAt: segmentStart,
        ...(end ? { endedAt: end } : {}),
        live: false,
        segment: true
      });
    }
    segment = [];
  }
  for (const item of items) {
    if (item.type !== "user_note") {
      segment.push(item);
      continue;
    }
    closeSegment(item.createdAt);
    blocks.push({
      id: item.id,
      kind: "note",
      items: [item],
      startedAt: item.createdAt,
      live: false
    });
    segmentStart = item.createdAt;
  }
  closeSegment(endedAt);
  return blocks;
}
