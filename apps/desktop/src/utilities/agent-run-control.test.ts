import { describe, expect, it, vi } from "vitest";
import { CommandEnvelopeSchema, createEnvelope } from "@deepwrite/contracts";
import {
  PiAgentRuntimeAdapter,
  SteeringError
} from "@deepwrite/pi-runtime-adapter";
import { handleAgentRunControl } from "./agent-run-control";
import { AgentRunRegistry } from "./agent-run-registry";

function steerCommand(sessionId: string, runId: string) {
  return CommandEnvelopeSchema.parse(
    createEnvelope(
      "agent.steer",
      { sessionId, runId, steerId: "steer_1", message: "第三段别动" },
      {
        id: "command_steer",
        context: { correlationId: "command_steer", sessionId, runId }
      }
    )
  );
}

describe("agent run control: steering", () => {
  it("hands a steer for the session's active run to the runtime", () => {
    const runs = new AgentRunRegistry();
    const { runId } = runs.begin("session", false);
    const runtime = new PiAgentRuntimeAdapter();
    const steer = vi.spyOn(runtime, "steer").mockReturnValue({
      sessionId: "session",
      runId,
      steerId: "steer_1",
      acceptedAt: "2026-10-28T08:00:00.000Z"
    });

    expect(
      handleAgentRunControl(steerCommand("session", runId), runs, runtime)
    ).toMatchObject({ status: "accepted", payload: { steerId: "steer_1" } });
    expect(steer).toHaveBeenCalledOnce();
  });

  it("refuses runs that are not active or belong to 更多功能", () => {
    const runs = new AgentRunRegistry();
    const runtime = new PiAgentRuntimeAdapter();
    const steer = vi.spyOn(runtime, "steer");
    expect(
      handleAgentRunControl(steerCommand("session", "run_gone"), runs, runtime)
    ).toMatchObject({
      status: "rejected",
      error: { code: "agent.run_not_active" }
    });

    const { runId } = runs.begin("chat", true);
    expect(
      handleAgentRunControl(steerCommand("chat", runId), runs, runtime)
    ).toMatchObject({
      status: "rejected",
      error: { code: "agent.steering_unsupported" }
    });
    expect(steer).not.toHaveBeenCalled();
  });

  it("reports the runtime's refusal code", () => {
    const runs = new AgentRunRegistry();
    const { runId } = runs.begin("session", false);
    const runtime = new PiAgentRuntimeAdapter();
    vi.spyOn(runtime, "steer").mockImplementation(() => {
      throw new SteeringError("agent.steering_closed", "本轮已在收尾");
    });

    expect(
      handleAgentRunControl(steerCommand("session", runId), runs, runtime)
    ).toMatchObject({
      status: "rejected",
      error: { code: "agent.steering_closed" }
    });
  });
});
