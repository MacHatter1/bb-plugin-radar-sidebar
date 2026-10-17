// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_registerAgentTeamsRadar, type AgentTeamSummary } from "./agent-teams-radar";
import { EXPERIMENTAL_RADAR_METHODS } from "../packages/contributions/src/index";

describe("Agent Teams integration example", () => {
  it("reads the engine once per batch and contributes captain/member progress and real panel links", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "agent-teams" });
    const team: AgentTeamSummary = {
      id: "team-1", captainThreadId: "captain", goal: "Ship the feature", status: "running",
      members: [{ threadId: "member" }, { threadId: null }],
      tasks: [{ status: "completed" }, { status: "running" }],
    };
    const read = vi.fn(() => [team, { ...team, id: "archived", status: "archived" as const }]);
    try {
      experimental_registerAgentTeamsRadar(bb, read);
      const result = await harness.behavior.callRpc(EXPERIMENTAL_RADAR_METHODS.contributions, { threadIds: ["captain", "member", "unrelated"] }) as { threads: { badges: unknown[]; actions: unknown[] }[] };
      expect(read).toHaveBeenCalledOnce();
      for (const row of result.threads.slice(0, 2)) {
        expect(row.badges).toEqual([{ id: "team-1", label: "Ship the feature · running", icon: "UserMultiple", text: "1/2", tone: "info" }]);
        expect(row.actions).toEqual([{ kind: "link", id: "team-1", label: "Open Agent Teams: Ship the feature", icon: "UserMultiple", href: "/plugins/agent-teams/teams" }]);
      }
      expect(result.threads[2]).toEqual({ threadId: "unrelated", badges: [], actions: [] });
    } finally { await harness.lifecycle.dispose(); }
  });
});
