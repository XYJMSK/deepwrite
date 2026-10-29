import type {
  Agent,
  AgentEvent,
  AgentMessage
} from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import {
  SESSION_STEER_MAX_PER_RUN,
  type AgentRuntimeRef,
  type SessionSteerAcceptedPayload,
  type SessionSteerCommandPayload,
  type SteeringAttachmentSummary
} from "@deepwrite/contracts";
import { buildSteeringUserText } from "../prompts-user-message";
import type { AgentRuntimeEvent } from "../runtime-types";

export class SteeringError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SteeringError";
  }
}

export interface RunSteering {
  submit(payload: SessionSteerCommandPayload): SessionSteerAcceptedPayload;
  /** Reports a steering message once the agent loop put it in the context. */
  observe(event: AgentEvent): void;
  /** Stops accepting and drops what the loop did not take. */
  close(): void;
}

/** Steering entry points of the active runs, keyed by run id. */
export class RunSteeringRegistry {
  private readonly runs = new Map<string, RunSteering>();

  register(runId: string, steering: RunSteering): () => void {
    this.runs.set(runId, steering);
    return () => {
      if (this.runs.get(runId) === steering) this.runs.delete(runId);
    };
  }

  steer(payload: SessionSteerCommandPayload): SessionSteerAcceptedPayload {
    const steering = this.runs.get(payload.runId);
    if (!steering) {
      throw new SteeringError(
        "agent.run_not_active",
        "要插话的智能体运行已结束或不存在。"
      );
    }
    return steering.submit(payload);
  }
}

interface PendingSteer {
  steerId: string;
  content: string;
  attachments: SteeringAttachmentSummary[];
}

export interface RunSteeringOptions {
  agent: Agent;
  sessionId: string;
  runId: string;
  messageId: string;
  runtime: AgentRuntimeRef;
  emit(event: AgentRuntimeEvent): void;
  /** The injected message, so context bookkeeping can tell it apart. */
  onDelivered?(message: AgentMessage): void;
}

/**
 * Exactly-once delivery: a steer is either reported delivered before the run's
 * terminal event, or it never entered the context and the Renderer sends it as
 * the next turn. Pi drains its steering queue at the start of every prompt, so
 * leftovers must be cleared on close or they would reach the next run too.
 */
export function createRunSteering(options: RunSteeringOptions): RunSteering {
  const { agent, sessionId, runId } = options;
  const pending = new WeakMap<AgentMessage, PendingSteer>();
  let open = true;
  let accepted = 0;
  // Pi defaults to one steer per drain point; deliver every queued one at once.
  agent.steeringMode = "all";
  agent.clearSteeringQueue();

  return {
    submit(payload) {
      if (payload.sessionId !== sessionId || payload.runId !== runId) {
        throw new SteeringError(
          "agent.run_not_active",
          "要插话的智能体运行已结束或不存在。"
        );
      }
      if (!open) {
        throw new SteeringError(
          "agent.steering_closed",
          "本轮已在收尾，插话将作为下一条消息发送。"
        );
      }
      if (accepted >= SESSION_STEER_MAX_PER_RUN) {
        throw new SteeringError(
          "agent.steering_limit",
          `每轮最多插话 ${SESSION_STEER_MAX_PER_RUN} 条。`
        );
      }
      accepted += 1;
      const attachments = payload.attachments ?? [];
      const message: UserMessage = {
        role: "user",
        content: buildSteeringUserText({
          prompt: payload.message,
          attachments
        }),
        timestamp: Date.now()
      };
      pending.set(message, {
        steerId: payload.steerId,
        content: payload.message,
        attachments: attachments.flatMap((attachment) =>
          attachment.kind === "text"
            ? [
                {
                  id: attachment.id,
                  name: attachment.name,
                  kind: "text" as const,
                  mediaType: attachment.mediaType,
                  size: attachment.size,
                  ...(attachment.truncated ? { truncated: true as const } : {})
                }
              ]
            : []
        )
      });
      agent.steer(message);
      return {
        sessionId,
        runId,
        steerId: payload.steerId,
        acceptedAt: new Date().toISOString()
      };
    },
    observe(event) {
      if (event.type !== "message_end") return;
      const steer = pending.get(event.message);
      if (!steer) return;
      pending.delete(event.message);
      options.onDelivered?.(event.message);
      options.emit({
        type: "agent.steering_delivered",
        runId,
        sessionId,
        payload: {
          messageId: options.messageId,
          steerId: steer.steerId,
          content: steer.content,
          ...(steer.attachments.length
            ? { attachments: steer.attachments }
            : {}),
          deliveredAt: new Date().toISOString(),
          runtime: options.runtime
        }
      });
    },
    close() {
      open = false;
      agent.clearSteeringQueue();
    }
  };
}
