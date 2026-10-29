import {
  computed,
  effectScope,
  ref,
  shallowRef,
  watch,
  type ComputedRef
} from "vue";
import type {
  PromptTextAttachment,
  UserPromptAttachment
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../../i18n";
import { formatError, getErrorPayload } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import type { AgentConversationContext } from "./context";
import { id } from "./shared";

const t = createScopedTranslator("workspace.followUpQueue");
const tSend = createScopedTranslator("workspace.sendMessage");

export const FOLLOW_UP_QUEUE_MAX_ITEMS = 5;

/**
 * A message sent while the agent works, shown as the user's bubble until it
 * lands. `steering` was handed to the run for its next model call, `queued`
 * waits to be sent as the next turn (images, or a steer the run missed), and
 * `sending` is being sent as a new turn.
 */
export interface QueuedComposerMessage {
  id: string;
  content: string;
  attachments: UserPromptAttachment[];
  createdAt: string;
  state: "queued" | "steering" | "sending";
  /** The run a steer went to; unset while it waits for the run id. */
  steerRunId?: string;
}

/** Sends one queued message through the coordinator's ordinary send path. */
export type FollowUpDispatcher = (
  attachments: UserPromptAttachment[]
) => Promise<void>;

/** Read by `sendMessage` while a queued message is being sent. */
export interface QueuedDispatch {
  readonly content: string;
  sent: boolean;
  failed: boolean;
  markSent(): void;
}

interface FollowUpQueueState {
  items: QueuedComposerMessage[];
  paused: boolean;
}

export interface FollowUpQueueController {
  items: ComputedRef<readonly QueuedComposerMessage[]>;
  paused: ComputedRef<boolean>;
  canQueue: ComputedRef<boolean>;
  /** A queued message is on its way out; the draft is not being sent. */
  dispatching: ComputedRef<boolean>;
  /**
   * Sends the draft into the running turn, or holds it for the next turn when
   * it cannot steer; false when too many messages are waiting.
   */
  enqueue(attachments: UserPromptAttachment[]): boolean;
  /** Removes a queued message so the composer can take it back. */
  withdraw(itemId: string): QueuedComposerMessage | undefined;
  setDispatcher(dispatcher: FollowUpDispatcher | null): void;
  markDelivered(steerId: string): void;
  /** Unsent texts of the current conversation, for folding into the draft. */
  takeTexts(): string[];
  stop(): void;
}

type FollowUpContext = Pick<
  AgentConversationContext,
  | "options"
  | "sessionId"
  | "draft"
  | "messages"
  | "isBusy"
  | "activeRunId"
  | "hasPendingEditReview"
  | "deferredPersistenceSessions"
  | "queuedDispatch"
>;

function textAttachments(item: QueuedComposerMessage): PromptTextAttachment[] {
  return item.attachments
    .filter(
      (attachment): attachment is PromptTextAttachment =>
        attachment.kind === "text"
    )
    .map((attachment) => ({ ...attachment }));
}

export function createFollowUpQueue(
  ctx: FollowUpContext
): FollowUpQueueController {
  const queues = ref<Record<string, FollowUpQueueState>>({});
  const dispatcher = shallowRef<FollowUpDispatcher | null>(null);
  const dispatching = ref(false);
  const current = computed(() => queues.value[ctx.sessionId.value]);
  const items = computed(() => current.value?.items ?? []);
  const paused = computed(() => current.value?.paused ?? false);
  const canSendNewTurn = computed(
    () =>
      Boolean(ctx.options.api()) &&
      !ctx.isBusy.value &&
      !ctx.hasPendingEditReview.value &&
      !ctx.deferredPersistenceSessions.value.has(ctx.sessionId.value) &&
      dispatcher.value !== null &&
      !dispatching.value
  );

  function queueFor(sessionId: string): FollowUpQueueState {
    return (queues.value[sessionId] ??= { items: [], paused: false });
  }

  function remove(sessionId: string, itemId: string): void {
    const queue = queues.value[sessionId];
    if (!queue) return;
    queue.items = queue.items.filter((item) => item.id !== itemId);
    if (!queue.items.length) delete queues.value[sessionId];
  }

  /** Returns undelivered steers to the front, in their original order. */
  function returnToFront(
    queue: FollowUpQueueState,
    returned: QueuedComposerMessage[]
  ): void {
    const ids = new Set(returned.map((item) => item.id));
    for (const item of returned) {
      item.state = "queued";
      delete item.steerRunId;
    }
    queue.items = [
      ...returned,
      ...queue.items.filter((item) => !ids.has(item.id))
    ];
  }

  function submitSteer(item: QueuedComposerMessage, runId: string): void {
    const api = ctx.options.api();
    const sessionId = ctx.sessionId.value;
    const queue = queues.value[sessionId];
    if (!api || !queue) return;
    item.steerRunId = runId;
    const attachments = textAttachments(item);
    api.session
      .steer({
        sessionId,
        runId,
        steerId: item.id,
        message: item.content,
        ...(attachments.length ? { attachments } : {})
      })
      .catch((error: unknown) => {
        const live = queues.value[sessionId]?.items.find(
          (entry) => entry.id === item.id
        );
        if (live?.state !== "steering" || live.steerRunId !== runId) return;
        returnToFront(queues.value[sessionId]!, [live]);
        // A run that already ended takes it as the next turn instead.
        const code = getErrorPayload(error)?.code;
        if (code !== "agent.run_not_active" && code !== "agent.steering_closed")
          uiMessage.warning(formatError(error, t("steerFailed")));
      });
  }

  function steer(item: QueuedComposerMessage): void {
    // Images cannot join a running turn; they wait for the next one.
    if (item.attachments.some((attachment) => attachment.kind === "image"))
      return;
    item.state = "steering";
    const runId = ctx.activeRunId.value;
    if (runId) submitSteer(item, runId);
  }

  async function dispatch(
    sessionId: string,
    item: QueuedComposerMessage
  ): Promise<void> {
    const send = dispatcher.value;
    if (!send || dispatching.value) return;
    dispatching.value = true;
    item.state = "sending";
    const queued: QueuedDispatch = {
      content: item.content,
      sent: false,
      failed: false,
      markSent() {
        queued.sent = true;
        remove(sessionId, item.id);
      }
    };
    ctx.queuedDispatch = queued;
    try {
      await send(item.attachments.map((attachment) => ({ ...attachment })));
    } catch {
      queued.failed = true;
    } finally {
      if (ctx.queuedDispatch === queued) ctx.queuedDispatch = null;
      dispatching.value = false;
    }
    if (queued.sent && !queued.failed) return;
    // Unsent or rejected: the composer takes the words back.
    const queue = queueFor(sessionId);
    if (queued.sent) queue.items.unshift({ ...item, state: "queued" });
    else item.state = "queued";
    queue.paused = true;
  }

  /**
   * A run ended: missed steers wait for the next turn. After a stop or a
   * failure the queue pauses and the composer takes the messages back.
   */
  function settleRun(runId: string): void {
    const sessionId = ctx.sessionId.value;
    const queue = queues.value[sessionId];
    if (!queue) return;
    const missed = queue.items.filter(
      (item) => item.state === "steering" && item.steerRunId === runId
    );
    if (missed.length) returnToFront(queue, missed);
    const reply = ctx.messages.value.find(
      (message) => message.role === "assistant" && message.runId === runId
    );
    if (reply?.status !== "completed") queue.paused = true;
  }

  const scope = effectScope(true);
  scope.run(() => {
    watch(
      () => ctx.activeRunId.value,
      (next, previous) => {
        if (previous) settleRun(previous);
        if (!next) return;
        for (const item of items.value) {
          if (item.state === "steering" && !item.steerRunId)
            submitSteer(item, next);
        }
      }
    );
    // Busy without a run (history work, a refused send): nothing to steer.
    watch(
      () => ctx.isBusy.value,
      (busy) => {
        const queue = current.value;
        if (busy || !queue) return;
        const waiting = queue.items.filter(
          (item) => item.state === "steering" && !item.steerRunId
        );
        if (waiting.length) returnToFront(queue, waiting);
      }
    );
    watch(
      () =>
        canSendNewTurn.value &&
        !paused.value &&
        items.value.some((item) => item.state === "queued"),
      (ready) => {
        const next = items.value.find((item) => item.state === "queued");
        if (ready && next) void dispatch(ctx.sessionId.value, next);
      }
    );
  });

  return {
    items,
    paused,
    dispatching: computed(() => dispatching.value),
    canQueue: computed(
      () =>
        Boolean(ctx.options.api()) &&
        ctx.isBusy.value &&
        !ctx.deferredPersistenceSessions.value.has(ctx.sessionId.value)
    ),
    enqueue(attachments) {
      const queue = queueFor(ctx.sessionId.value);
      if (queue.items.length >= FOLLOW_UP_QUEUE_MAX_ITEMS) {
        uiMessage.warning(
          t("queueIsFull", { count: FOLLOW_UP_QUEUE_MAX_ITEMS })
        );
        return false;
      }
      const content =
        ctx.draft.value.trim() ||
        (attachments.length
          ? tSend("pleaseReadAndAnalyzeTheAttachmentsIUploaded")
          : "");
      if (!content) return false;
      queue.items.push({
        id: id("steer"),
        content,
        attachments: attachments.map((attachment) => ({ ...attachment })),
        createdAt: new Date().toISOString(),
        state: "queued"
      });
      ctx.draft.value = "";
      if (ctx.isBusy.value) steer(queue.items.at(-1)!);
      return true;
    },
    withdraw(itemId) {
      const sessionId = ctx.sessionId.value;
      const item = queues.value[sessionId]?.items.find(
        (entry) => entry.id === itemId
      );
      if (item?.state !== "queued") return undefined;
      const taken = { ...item, attachments: [...item.attachments] };
      remove(sessionId, itemId);
      return taken;
    },
    setDispatcher(next) {
      dispatcher.value = next;
    },
    markDelivered(steerId) {
      remove(ctx.sessionId.value, steerId);
    },
    takeTexts() {
      const sessionId = ctx.sessionId.value;
      const texts = (queues.value[sessionId]?.items ?? [])
        .filter((item) => item.state !== "sending")
        .map((item) => item.content);
      delete queues.value[sessionId];
      return texts;
    },
    stop() {
      scope.stop();
    }
  };
}
