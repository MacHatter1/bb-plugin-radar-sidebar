// Integration adapter for the existing Agent Teams plugin. Copy into that
// plugin and replace this import with "bb-radar-contributions" after installing
// the contract package. No Radar components or private BB imports are needed.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { experimental_registerRadarContributor, type RadarResponse } from "../packages/contributions/src/index";

export interface AgentTeamSummary {
  id: string;
  captainThreadId: string;
  goal: string;
  status: "draft" | "running" | "paused" | "completed" | "archived";
  members: readonly { threadId: string | null }[];
  tasks: readonly { status: string }[];
}

/** In Agent Teams' server.ts:
 * experimental_registerAgentTeamsRadar(bb,
 *   () => engine.list({ includeArchived: false }));
 * It is an integration example, not automatically installed by Radar. */
export function experimental_registerAgentTeamsRadar(
  bb: Pick<BbPluginApi, "rpc" | "pluginId">,
  readTeams: () => readonly AgentTeamSummary[] | Promise<readonly AgentTeamSummary[]>,
): void {
  experimental_registerRadarContributor(bb, {
    async provide({ threadIds }): Promise<RadarResponse> {
      const teams = (await readTeams()).filter((team) => team.status !== "archived");
      return {
        version: 1,
        threads: threadIds.map((threadId) => {
          const matching = teams.filter((team) => team.captainThreadId === threadId
            || team.members.some((member) => member.threadId === threadId)).slice(0, 3);
          return {
            threadId,
            badges: matching.map((team) => ({
              id: team.id,
              label: `${team.goal.slice(0, 80)} · ${team.status}`,
              icon: "UserMultiple",
              text: `${team.tasks.filter((task) => task.status === "completed").length}/${team.tasks.length}`,
              tone: team.status === "completed" ? "success" as const
                : team.status === "paused" ? "warning" as const : "info" as const,
            })),
            actions: matching.map((team) => ({
              kind: "link" as const, id: team.id,
              label: `Open Agent Teams: ${team.goal.slice(0, 80)}`,
              icon: "UserMultiple",
              href: `/plugins/${bb.pluginId}/teams`,
            })),
          };
        }),
      };
    },
    run() { throw new Error("Agent Teams' Radar adapter supplies links, not mutating actions."); },
  });
}
