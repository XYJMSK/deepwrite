import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import type { ConversationCheckpoint } from "@deepwrite/contracts";
import {
  emptyContextRefs,
  type ContextRefKind,
  type ContextRefs
} from "./types";

const MAX_REFS_PER_KIND = 100;

export interface RuntimeUserTurn {
  /** The user's own words and attachments, without workspace context. */
  rawContent: UserMessage["content"];
  /** True when the sent message also carried a workspace snapshot. */
  snapshot: boolean;
}

/**
 * Compaction bookkeeping for one cached conversation agent. It lives exactly
 * as long as the agent, so an evicted or replaced agent takes it along.
 */
export class ConversationContextState {
  checkpoint: ConversationCheckpoint | undefined;
  /** The injected summary message, recognizable by identity. */
  summaryMessage: AgentMessage | undefined;
  readonly refs: ContextRefs = emptyContextRefs();
  /** Run id of each message that started a run. */
  readonly runStarts = new WeakMap<AgentMessage, string>();
  readonly runtimeTurns = new WeakMap<AgentMessage, RuntimeUserTurn>();
  readonly pruned = new WeakSet<AgentMessage>();
  /** User messages injected inside a run (steering); never a run boundary. */
  readonly midRunMessages = new WeakSet<AgentMessage>();
  /** Provider usage recorded before this time describes a discarded context. */
  compactedAt = 0;
  private fixedContextStale = false;

  /** Stage bookkeeping until a complete replacement is available. */
  fork(messages: readonly AgentMessage[]): ConversationContextState {
    const copy = new ConversationContextState();
    copy.checkpoint = this.checkpoint;
    copy.summaryMessage = this.summaryMessage;
    copy.compactedAt = this.compactedAt;
    copy.fixedContextStale = this.fixedContextStale;
    copy.addRefs(this.refs);
    for (const message of messages) {
      const run = this.runStarts.get(message);
      if (run) copy.runStarts.set(message, run);
      const turn = this.runtimeTurns.get(message);
      if (turn) copy.runtimeTurns.set(message, turn);
      if (this.pruned.has(message)) copy.pruned.add(message);
      if (this.midRunMessages.has(message)) copy.midRunMessages.add(message);
    }
    return copy;
  }

  adopt(
    copy: ConversationContextState,
    messages: readonly AgentMessage[]
  ): void {
    this.checkpoint = copy.checkpoint;
    this.summaryMessage = copy.summaryMessage;
    this.compactedAt = copy.compactedAt;
    this.fixedContextStale = copy.fixedContextStale;
    for (const kind of Object.keys(this.refs) as ContextRefKind[]) {
      this.refs[kind] = [...copy.refs[kind]];
    }
    for (const message of messages) {
      const run = copy.runStarts.get(message);
      if (run) this.runStarts.set(message, run);
      const turn = copy.runtimeTurns.get(message);
      if (turn) this.runtimeTurns.set(message, turn);
      if (copy.pruned.has(message)) this.pruned.add(message);
      if (copy.midRunMessages.has(message)) this.midRunMessages.add(message);
    }
  }

  markFixedContextStale(): void {
    this.fixedContextStale = true;
  }

  /** True once after compaction removed or stubbed the fixed run context. */
  consumeFixedContextRefresh(): boolean {
    const stale = this.fixedContextStale;
    this.fixedContextStale = false;
    return stale;
  }

  isRunStart(message: AgentMessage): boolean {
    return this.runStarts.has(message);
  }

  isMidRunMessage(message: AgentMessage): boolean {
    return this.midRunMessages.has(message);
  }

  /** Moves bookkeeping to a rewritten copy of the same logical message. */
  transfer(from: AgentMessage, to: AgentMessage): void {
    const runId = this.runStarts.get(from);
    if (runId !== undefined) this.runStarts.set(to, runId);
    const turn = this.runtimeTurns.get(from);
    if (turn) this.runtimeTurns.set(to, { ...turn, snapshot: false });
    if (this.midRunMessages.has(from)) this.midRunMessages.add(to);
    this.pruned.add(to);
  }

  addRefs(refs: Partial<Record<ContextRefKind, string[]>>): void {
    for (const kind of Object.keys(refs) as ContextRefKind[]) {
      const target = this.refs[kind];
      for (const raw of refs[kind] ?? []) {
        const value = raw.trim().slice(0, 300);
        if (!value) continue;
        const existing = target.indexOf(value);
        if (existing >= 0) target.splice(existing, 1);
        target.push(value);
      }
      if (target.length > MAX_REFS_PER_KIND) {
        target.splice(0, target.length - MAX_REFS_PER_KIND);
      }
    }
  }
}

const states = new WeakMap<Agent, ConversationContextState>();

export function conversationContextState(
  agent: Agent
): ConversationContextState {
  let state = states.get(agent);
  if (!state) {
    state = new ConversationContextState();
    states.set(agent, state);
  }
  return state;
}
