import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { estimateMessageTokens } from "./token-count";

export interface CutPoint {
  /** First message kept verbatim. */
  firstKeptIndex: number;
  /** Start of the run being split, or -1 when the cut is at a run start. */
  turnStartIndex: number;
  isSplitTurn: boolean;
}

/**
 * Walks back from the newest message until about `keepRecentTokens` are kept,
 * then cuts at the nearest run start. Only when a single run exceeds the
 * budget does it cut inside that run, and never before a tool result, which
 * must stay with its call. Returns undefined when nothing can be summarized.
 */
export function findCutPoint(
  messages: readonly AgentMessage[],
  start: number,
  keepRecentTokens: number,
  isRunStart: (message: AgentMessage) => boolean,
  allowSplitTurn: boolean,
  isMidRunMessage: (message: AgentMessage) => boolean = () => false
): CutPoint | undefined {
  if (messages.length - start < 2) return undefined;
  // A steering message is a user message inside a run, not a run start.
  const boundary = (message: AgentMessage): boolean =>
    isRunStart(message) ||
    (message.role === "user" && !isMidRunMessage(message));
  let accumulated = 0;
  let budgetIndex = start;
  for (let index = messages.length - 1; index >= start; index -= 1) {
    accumulated += estimateMessageTokens(messages[index]!);
    if (accumulated >= keepRecentTokens) {
      budgetIndex = index;
      break;
    }
  }
  if (accumulated < keepRecentTokens) return undefined;

  for (let index = budgetIndex; index < messages.length; index += 1) {
    if (index > start && boundary(messages[index]!)) {
      return { firstKeptIndex: index, turnStartIndex: -1, isSplitTurn: false };
    }
  }
  if (!allowSplitTurn) return undefined;

  for (
    let index = Math.max(budgetIndex, start + 1);
    index < messages.length;
    index += 1
  ) {
    if (messages[index]!.role !== "assistant") continue;
    let turnStart = -1;
    for (let back = index - 1; back >= start; back -= 1) {
      if (boundary(messages[back]!)) {
        turnStart = back;
        break;
      }
    }
    if (turnStart < 0) {
      return { firstKeptIndex: index, turnStartIndex: -1, isSplitTurn: false };
    }
    // The run's own request stays verbatim; there must be work to summarize.
    if (index - turnStart < 2) continue;
    return {
      firstKeptIndex: index,
      turnStartIndex: turnStart,
      isSplitTurn: true
    };
  }
  return undefined;
}
