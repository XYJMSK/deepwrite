import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseStep,
  type UserMessage
} from "@earendil-works/pi-ai";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { AgentUserInputBroker } from "../user-input-broker";
import type { AgentRuntimeEvent } from "../runtime-types";
import { findCutPoint } from "./context/cut-point";
import { ConversationAgentCache } from "./run-agent";
import { AgentRunKernel } from "./run-kernel";
import {
  RunSteeringRegistry,
  SteeringError,
  createRunSteering
} from "./run-steering";

const runtime = {
  mode: "local-faux" as const,
  provider: "example",
  model: "fixture"
};

/** A bare agent for queue checks; it never calls a model. */
function idleAgent(): Agent {
  return new Agent({
    streamFn: () => {
      throw new Error("The fixture agent must not stream.");
    }
  });
}

function steer(steerId: string, message: string) {
  return { sessionId: "session", runId: "run", steerId, message };
}

function userTexts(context: { messages: readonly unknown[] }): string[] {
  return context.messages.flatMap((message) => {
    const user = message as UserMessage;
    if (user.role !== "user") return [];
    return [typeof user.content === "string" ? user.content : ""];
  });
}

async function runFixture(options: {
  registry: RunSteeringRegistry;
  onTool?: () => void;
  responses: FauxResponseStep[];
}): Promise<AgentRuntimeEvent[]> {
  const tool: AgentTool = {
    name: "work",
    label: "Work",
    description: "A fixture step.",
    parameters: Type.Object({}),
    async execute() {
      options.onTool?.();
      return { content: [{ type: "text", text: "worked" }], details: {} };
    }
  };
  const kernel = new AgentRunKernel({
    agents: new ConversationAgentCache(new Map(), {}),
    userInputBroker: new AgentUserInputBroker(),
    steering: options.registry,
    idleTimeoutMs: 0,
    tokensPerSecond: 0,
    evaluationMode: false,
    retryPolicy: { delaysMs: [] },
    describe: () => runtime
  });
  const events: AgentRuntimeEvent[] = [];
  for await (const event of kernel.run({
    target: {
      runId: "run",
      sessionId: "session",
      signal: new AbortController().signal
    },
    eventSource: { runId: "run", sessionId: "session" },
    agentKey: "conversation",
    portableToolSchemaProfile: "default",
    build: () => ({ systemPrompt: "Run the fixture.", tools: [tool] }),
    userMessageContent: () => "Write chapter three.",
    fauxResponses: () => options.responses
  }))
    events.push(event);
  return events;
}

describe("run steering", () => {
  it("injects every steer accepted during a tool before the next model call", async () => {
    const registry = new RunSteeringRegistry();
    const seen: string[][] = [];
    const events = await runFixture({
      registry,
      onTool: () => {
        registry.steer(steer("steer_1", "主角改名林舟"));
        registry.steer(steer("steer_2", "第三段别动"));
      },
      responses: [
        fauxAssistantMessage(fauxToolCall("work", {}), {
          stopReason: "toolUse"
        }),
        (context) => {
          seen.push(userTexts(context));
          return fauxAssistantMessage("done");
        }
      ]
    });

    expect(seen).toHaveLength(1);
    const steering = seen[0]!.filter((text) => text.includes("运行中用户补充"));
    expect(steering).toHaveLength(2);
    expect(steering[0]).toContain("主角改名林舟");
    expect(steering[1]).toContain("第三段别动");
    const types = events.map((event) => event.type);
    const delivered = events.filter(
      (event) => event.type === "agent.steering_delivered"
    );
    expect(delivered.map((event) => event.payload.steerId)).toEqual([
      "steer_1",
      "steer_2"
    ]);
    expect(delivered[0]?.payload).toMatchObject({
      content: "主角改名林舟",
      messageId: "run_assistant"
    });
    expect(types.lastIndexOf("agent.steering_delivered")).toBeLessThan(
      types.indexOf("agent.completed")
    );
    expect(() => registry.steer(steer("late", "太晚了"))).toThrow(
      expect.objectContaining({ code: "agent.run_not_active" })
    );
  });

  it("continues with another turn when a steer arrives during the final reply", async () => {
    const registry = new RunSteeringRegistry();
    let calls = 0;
    const events = await runFixture({
      registry,
      responses: [
        () => {
          calls += 1;
          registry.steer(steer("steer_final", "再加一段结尾"));
          return fauxAssistantMessage("first answer");
        },
        (context) => {
          calls += 1;
          expect(userTexts(context).at(-1)).toContain("再加一段结尾");
          return fauxAssistantMessage("revised answer");
        }
      ]
    });

    expect(calls).toBe(2);
    expect(
      events.some(
        (event) =>
          event.type === "agent.steering_delivered" &&
          event.payload.steerId === "steer_final"
      )
    ).toBe(true);
    expect(events.at(-1)?.type).toBe("agent.completed");
  });

  it("rejects after close and drops what the loop never took", () => {
    const agent = idleAgent();
    const emitted: AgentRuntimeEvent[] = [];
    const steering = createRunSteering({
      agent,
      sessionId: "session",
      runId: "run",
      messageId: "run_assistant",
      runtime,
      emit: (event) => emitted.push(event)
    });
    steering.submit(steer("steer_left", "没赶上"));
    expect(agent.hasQueuedMessages()).toBe(true);
    steering.close();
    expect(agent.hasQueuedMessages()).toBe(false);
    expect(emitted).toEqual([]);
    expect(() => steering.submit(steer("steer_closed", "关闸后"))).toThrow(
      SteeringError
    );
    expect(() =>
      steering.submit({ ...steer("steer_other", "别的运行"), runId: "other" })
    ).toThrow(expect.objectContaining({ code: "agent.run_not_active" }));
  });

  it("clears a leftover queue when a new run starts on the same agent", () => {
    const agent = idleAgent();
    agent.steer({ role: "user", content: "stale", timestamp: Date.now() });
    createRunSteering({
      agent,
      sessionId: "session",
      runId: "run",
      messageId: "run_assistant",
      runtime,
      emit: () => {}
    });
    expect(agent.hasQueuedMessages()).toBe(false);
    expect(agent.steeringMode).toBe("all");
  });

  it("limits steers per run", () => {
    const steering = createRunSteering({
      agent: idleAgent(),
      sessionId: "session",
      runId: "run",
      messageId: "run_assistant",
      runtime,
      emit: () => {}
    });
    for (let index = 0; index < 20; index += 1) {
      steering.submit(steer(`steer_${index}`, `补充 ${index}`));
    }
    expect(() => steering.submit(steer("steer_21", "超出"))).toThrow(
      expect.objectContaining({ code: "agent.steering_limit" })
    );
  });

  it("never cuts the context at a steering message", () => {
    const start: UserMessage = {
      role: "user",
      content: "start ".repeat(200),
      timestamp: 1
    };
    const steering: UserMessage = {
      role: "user",
      content: "steer ".repeat(10),
      timestamp: 2
    };
    const messages = [
      start,
      fauxAssistantMessage("a ".repeat(400)),
      steering,
      fauxAssistantMessage("b ".repeat(400))
    ];
    const isRunStart = (message: unknown) => message === start;
    const plain = findCutPoint(messages, 0, 300, isRunStart, false);
    expect(plain?.firstKeptIndex).toBe(2);
    const guarded = findCutPoint(
      messages,
      0,
      300,
      isRunStart,
      false,
      (message) => message === steering
    );
    expect(guarded).toBeUndefined();
  });
});
