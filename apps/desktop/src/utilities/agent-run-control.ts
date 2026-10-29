import {
  SessionAbortAcceptedPayloadSchema,
  SessionSteerAcceptedPayloadSchema,
  SessionUserInputResponseAcceptedPayloadSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import {
  SteeringError,
  UserInputResolutionError,
  type PiAgentRuntimeAdapter
} from "@deepwrite/pi-runtime-adapter";
import { nowIso } from "@deepwrite/shared";
import type { AgentRunRegistry } from "./agent-run-registry";

function rejected(
  command: CommandEnvelope,
  code: string,
  message: string
): CommandResult {
  return {
    status: "rejected",
    requestId: command.id,
    error: { code, message }
  };
}

/** Stop, answer and steer: controls on a run this utility owns. */
export function handleAgentRunControl(
  command: CommandEnvelope,
  runs: AgentRunRegistry,
  runtime: PiAgentRuntimeAdapter
): CommandResult | undefined {
  if (command.type === "agent.abort") {
    if (!runs.abort(command.payload.sessionId, command.payload.runId)) {
      return rejected(
        command,
        "agent.run_not_active",
        "要停止的智能体运行已结束或不存在。"
      );
    }
    return {
      status: "accepted",
      requestId: command.id,
      payload: SessionAbortAcceptedPayloadSchema.parse({
        sessionId: command.payload.sessionId,
        runId: command.payload.runId,
        abortedAt: nowIso()
      })
    };
  }

  if (command.type === "agent.user_input_response") {
    if (runs.activeRun(command.payload.sessionId) !== command.payload.runId) {
      return rejected(
        command,
        "agent.run_not_active",
        "要回答的智能体运行已结束或不存在。"
      );
    }
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: SessionUserInputResponseAcceptedPayloadSchema.parse(
          runtime.resolveUserInput(command.payload)
        )
      };
    } catch (error: unknown) {
      return rejected(
        command,
        error instanceof UserInputResolutionError
          ? error.code
          : "agent.user_input_response_failed",
        error instanceof Error ? error.message : "提交用户回答失败。"
      );
    }
  }

  if (command.type === "agent.steer") {
    const { sessionId, runId } = command.payload;
    if (runs.activeRun(sessionId) !== runId) {
      return rejected(
        command,
        "agent.run_not_active",
        "要插话的智能体运行已结束或不存在。"
      );
    }
    if (runs.isExtrasRun(runId)) {
      return rejected(
        command,
        "agent.steering_unsupported",
        "这类智能体运行不支持插话。"
      );
    }
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: SessionSteerAcceptedPayloadSchema.parse(
          runtime.steer(command.payload)
        )
      };
    } catch (error: unknown) {
      return rejected(
        command,
        error instanceof SteeringError ? error.code : "agent.steer_failed",
        error instanceof Error ? error.message : "插话发送失败。"
      );
    }
  }

  return undefined;
}
