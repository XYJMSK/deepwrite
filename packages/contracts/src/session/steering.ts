import { z } from "zod";
import { EnvelopeBaseSchema, type Envelope } from "../envelope";
import { AgentEventIdentitySchema } from "./agent-event-identity";
import {
  PROMPT_ATTACHMENT_MAX_ITEMS,
  UserPromptAttachmentsSchema
} from "./attachments";
import { SESSION_PROMPT_MAX_MESSAGE_LENGTH } from "./prompt-limits";

/** A run accepts at most this many steering messages; later ones are rejected. */
export const SESSION_STEER_MAX_PER_RUN = 20;

const SteerIdSchema = z.string().trim().min(1).max(120);

/**
 * A message the user sends while a run is active. The agent injects it before
 * its next model call; only text attachments (including manuscript references)
 * can be injected, images wait for the next turn.
 */
export const SessionSteerCommandPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  steerId: SteerIdSchema,
  message: z
    .string()
    .min(1)
    .max(SESSION_PROMPT_MAX_MESSAGE_LENGTH)
    .refine((value) => value.trim().length > 0, {
      message: "Steering messages cannot be blank."
    }),
  attachments: UserPromptAttachmentsSchema.refine(
    (attachments) =>
      attachments.every((attachment) => attachment.kind === "text"),
    { message: "Steering messages accept only text attachments." }
  ).optional()
});
export type SessionSteerCommandPayload = z.infer<
  typeof SessionSteerCommandPayloadSchema
>;

export const SessionSteerAcceptedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  steerId: SteerIdSchema,
  acceptedAt: z.string().datetime()
});
export type SessionSteerAcceptedPayload = z.infer<
  typeof SessionSteerAcceptedPayloadSchema
>;

function validateSteerCommandContext(
  value: {
    context: { sessionId?: string | undefined; runId?: string | undefined };
    payload: SessionSteerCommandPayload;
  },
  context: z.core.$RefinementCtx<unknown>
): void {
  if (value.context.sessionId !== value.payload.sessionId) {
    context.addIssue({
      code: "custom",
      path: ["context", "sessionId"],
      message: "Envelope sessionId must match the steering payload."
    });
  }
  if (value.context.runId !== value.payload.runId) {
    context.addIssue({
      code: "custom",
      path: ["context", "runId"],
      message: "Envelope runId must match the steering payload."
    });
  }
}

export const SessionSteerCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("session.steer"),
  payload: SessionSteerCommandPayloadSchema
}).superRefine(validateSteerCommandContext);

export const AgentSteerCommandEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("agent.steer"),
  payload: SessionSteerCommandPayloadSchema
}).superRefine(validateSteerCommandContext);

export const SteeringAttachmentSummarySchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  kind: z.literal("text"),
  mediaType: z.string().trim().min(1).max(120),
  size: z.number().int().nonnegative(),
  truncated: z.literal(true).optional()
});
export type SteeringAttachmentSummary = z.infer<
  typeof SteeringAttachmentSummarySchema
>;

/** The steering message entered the run's context before a model call. */
export const AgentSteeringDeliveredPayloadSchema =
  AgentEventIdentitySchema.extend({
    steerId: SteerIdSchema,
    content: z.string().min(1).max(SESSION_PROMPT_MAX_MESSAGE_LENGTH),
    attachments: z
      .array(SteeringAttachmentSummarySchema)
      .max(PROMPT_ATTACHMENT_MAX_ITEMS)
      .optional(),
    deliveredAt: z.string().datetime()
  });
export type AgentSteeringDeliveredPayload = z.infer<
  typeof AgentSteeringDeliveredPayloadSchema
>;

export const AgentSteeringDeliveredEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("agent.steering_delivered"),
    payload: AgentSteeringDeliveredPayloadSchema
  }).superRefine((value, context) => {
    if (
      value.context.sessionId !== value.payload.sessionId ||
      value.context.runId !== value.payload.runId
    ) {
      context.addIssue({
        code: "custom",
        path: ["context"],
        message: "Envelope and payload sessionId/runId must match."
      });
    }
  });
export type AgentSteeringDeliveredEventEnvelope = Envelope<
  AgentSteeringDeliveredPayload,
  "agent.steering_delivered"
>;
