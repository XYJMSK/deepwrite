import { createScopedTranslator } from "../../i18n";
import type { AgentConversationContext } from "./context";
import type {
  ExtrasChatTask,
  LongWorkspaceRuntimeContext,
  UserPromptAttachment,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { cloneJsonRecord } from "./clone";
import type { ConversationMessageRewriteRequest } from "../../types/conversation";
import type { WorkspaceDocument } from "../../types/workspace";
import type { WorkspaceContextAttachments } from "./types";

const t = createScopedTranslator("workspace.sendEntrypoints");

type SendEntrypointsContext = Pick<
  AgentConversationContext,
  "sendMessage" | "sessionId" | "messages"
>;
type LongSendContext = SendEntrypointsContext &
  Pick<
    AgentConversationContext,
    "epoch" | "draft" | "submitting" | "isBusy" | "queuedDispatch"
  >;

async function withLongRuntime(
  ctx: LongSendContext,
  context: LongWorkspaceRuntimeContext,
  submit: (context: LongWorkspaceRuntimeContext) => Promise<void>
): Promise<boolean> {
  if (ctx.isBusy.value) return false;
  const epoch = ctx.epoch;
  const sessionId = ctx.sessionId.value;
  const draft = ctx.draft.value;
  const snapshot = cloneJsonRecord(context);
  let handedOff = false;
  ctx.submitting.value = true;
  try {
    const { validateLongRuntimeContext } =
      await import("./long-runtime-validation");
    if (
      ctx.epoch !== epoch ||
      ctx.sessionId.value !== sessionId ||
      // A queued follow-up does not send the draft, which may keep changing.
      (!ctx.queuedDispatch && ctx.draft.value !== draft)
    )
      return false;
    const validated = validateLongRuntimeContext(snapshot);
    // sendMessage sets its own pending state synchronously for a long override.
    // Transfer ownership without yielding between releasing and starting send.
    ctx.submitting.value = false;
    handedOff = true;
    await submit(validated);
    return true;
  } finally {
    if (!handedOff && ctx.epoch === epoch && ctx.sessionId.value === sessionId)
      ctx.submitting.value = false;
  }
}

/** Sends the draft as a turn of a "更多功能" chat agent. */
export async function sendAssistantMessage(
  ctx: SendEntrypointsContext,
  task: ExtrasChatTask,
  attachments: UserPromptAttachment[] = []
): Promise<void> {
  await ctx.sendMessage(null, [], {}, attachments, undefined, task);
}
export async function resendMessage(
  ctx: SendEntrypointsContext,
  request: ConversationMessageRewriteRequest,
  activeDocument: WorkspaceDocument,
  workspaceDocuments: WorkspaceDocument[] = [],
  attachments: WorkspaceContextAttachments = {}
): Promise<boolean> {
  const sourceSessionId = ctx.sessionId.value;
  await ctx.sendMessage(
    activeDocument,
    workspaceDocuments,
    attachments,
    [],
    undefined,
    undefined,
    request
  );
  return (
    ctx.sessionId.value === sourceSessionId &&
    !ctx.messages.value.some((message) => message.id === request.messageId)
  );
}
export async function sendLongMessage(
  ctx: LongSendContext,
  context: LongWorkspaceRuntimeContext,
  attachments: Pick<
    WorkspaceRuntimeContext,
    "attachedSkills" | "attachedMaterials"
  > = {},
  promptAttachments: UserPromptAttachment[] = []
): Promise<void> {
  const attachedContext = cloneJsonRecord(attachments);
  const uploadedAttachments = cloneJsonRecord(promptAttachments);
  await withLongRuntime(ctx, context, (longWorkspace) =>
    ctx.sendMessage(
      {
        id: longWorkspace.bookId,
        domain: "creation",
        title: longWorkspace.title,
        eyebrow: t("longFormWriting"),
        path: [longWorkspace.title],
        content: "",
        readOnly: true
      },
      [],
      attachedContext,
      uploadedAttachments,
      { longWorkspace }
    )
  );
}
export async function resendLongMessage(
  ctx: LongSendContext,
  request: ConversationMessageRewriteRequest,
  context: LongWorkspaceRuntimeContext,
  attachments: Pick<
    WorkspaceRuntimeContext,
    "attachedSkills" | "attachedMaterials"
  > = {}
): Promise<boolean> {
  const attachedContext = cloneJsonRecord(attachments);
  const rewrite = cloneJsonRecord(request);
  const sourceSessionId = ctx.sessionId.value;
  const sent = await withLongRuntime(ctx, context, (longWorkspace) =>
    ctx.sendMessage(
      {
        id: longWorkspace.bookId,
        domain: "creation",
        title: longWorkspace.title,
        eyebrow: t("longFormWriting"),
        path: [longWorkspace.title],
        content: "",
        readOnly: true
      },
      [],
      attachedContext,
      [],
      { longWorkspace },
      undefined,
      rewrite
    )
  );
  return (
    sent &&
    ctx.sessionId.value === sourceSessionId &&
    !ctx.messages.value.some((message) => message.id === request.messageId)
  );
}
