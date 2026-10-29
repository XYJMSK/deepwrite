import {
  ExtrasAgentIdSchema,
  ExtrasAgentSettingsResetInputSchema,
  ExtrasAgentRunRequestSchema,
  ExtrasAgentSettingsInputSchema,
  ExtrasAgentSettingsSchema,
  SessionPromptAcceptedPayloadSchema,
  createEnvelope,
  type ExtrasAgentApi,
  type ExtrasAgentId,
  type ExtrasAgentSettingsOf,
  type SessionPromptAcceptedPayload
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

function settingsOf<A extends ExtrasAgentId>(
  agentId: A,
  raw: unknown
): ExtrasAgentSettingsOf<A> {
  const settings = ExtrasAgentSettingsSchema.parse(raw);
  if (settings.agentId !== agentId) {
    throw new Error("Extras agent settings do not match the request.");
  }
  return settings as ExtrasAgentSettingsOf<A>;
}

export const extrasAgentApi: ExtrasAgentApi = {
  async run(rawRequest) {
    const request = ExtrasAgentRunRequestSchema.parse(rawRequest);
    const id = browserId("cmd_extras_agent_run");
    const accepted = SessionPromptAcceptedPayloadSchema.parse(
      await invokeCommand<SessionPromptAcceptedPayload>(
        createEnvelope("extrasAgent.run", request, {
          id,
          context: { correlationId: id, sessionId: request.sessionId }
        })
      )
    );
    if (accepted.sessionId !== request.sessionId) {
      throw new Error(
        "Agent acceptance sessionId does not match the extras agent run."
      );
    }
    return accepted;
  },
  profiles: {
    async list(rawAgentId) {
      const agentId = ExtrasAgentIdSchema.parse(rawAgentId);
      const id = browserId("cmd_extras_agent_profiles_list");
      return settingsOf(
        rawAgentId,
        await invokeCommand(
          createEnvelope(
            "extrasAgentConfig.list",
            { agentId },
            { id, correlationId: id }
          )
        )
      );
    },
    async save(rawInput) {
      const input = ExtrasAgentSettingsInputSchema.parse(rawInput);
      const id = browserId("cmd_extras_agent_profiles_save");
      return settingsOf(
        rawInput.agentId,
        await invokeCommand(
          createEnvelope("extrasAgentConfig.save", input, {
            id,
            correlationId: id
          })
        )
      );
    },
    async reset(rawAgentId, rawProfileId, previewOnly) {
      const input = ExtrasAgentSettingsResetInputSchema.parse({
        agentId: rawAgentId,
        profileId: rawProfileId,
        previewOnly
      });
      const id = browserId("cmd_extras_agent_profiles_reset");
      return settingsOf(
        rawAgentId,
        await invokeCommand(
          createEnvelope("extrasAgentConfig.reset", input, {
            id,
            correlationId: id
          })
        )
      );
    }
  }
};
