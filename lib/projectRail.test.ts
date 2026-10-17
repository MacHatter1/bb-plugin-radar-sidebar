import { describe, expect, it } from "vitest";
import { makeProject, makeThread, NOW } from "@/components/radar/fixtures";
import { EMPTY_PROJECT_ORGANISATION } from "./projectOrganisation";
import { projectInitials, projectRailBadge, projectRailProjects, projectRailSummary } from "./projectRail";

const projects = ["a", "b", "c", "d"].map(id => makeProject({ id, name: `Project ${id}` }));

describe("project rail data", () => {
  it("keeps empty pinned and collected projects, excludes stale pins and hidden/archived work", () => {
    const organisation = { pinOrder: ["deleted", "c"], collections: { work: { name: "Work", collapsed: false } }, projectCollections: { d: "work" } };
    const result = projectRailProjects(projects, [makeThread({ id: "1", projectId: "a" }),
      makeThread({ id: "2", projectId: "b", isHidden: true }), makeThread({ id: "3", projectId: "b", isArchived: true })],
    { deleted: true, c: true }, organisation, new Map(), NOW);
    expect(result.map(project => project.id)).toEqual(["c", "a", "d"]);
    expect(result.find(project => project.id === "c")?.total).toBe(0);
  });

  it("counts scheduled work separately from immediate queues and user attention", () => {
    const result = projectRailProjects(projects, [
      makeThread({ id: "scheduled", projectId: "a", indicator: "queued-waiting", queuedWork: "waiting" }),
      makeThread({ id: "queued", projectId: "a", indicator: "queued-waiting", queuedWork: "waiting" }),
      makeThread({ id: "waiting", projectId: "a", status: "active", indicator: "waiting-for-input", hasPendingInteraction: true }),
      makeThread({ id: "working", projectId: "a", status: "active", isUnread: true }),
      makeThread({ id: "background", projectId: "a", activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 } }),
      makeThread({ id: "failed", projectId: "a", indicator: "unread-error", isUnread: true }),
    ], {}, EMPTY_PROJECT_ORGANISATION, new Map([["scheduled", NOW + 60000]]), NOW)[0]!;
    expect(result).toMatchObject({ total: 6, working: 2, waiting: 1, failed: 1, queued: 1, scheduled: 1, unread: 2 });
    expect(projectRailBadge(result)).toEqual({ kind: "failed", count: 1, label: "failed" });
    expect(projectRailSummary(result)).toBe("6 threads · 1 failed · 1 need input · 2 working · 1 queued · 1 scheduled · 2 unread");
  });

  it("keeps manual pins stable ahead of projects needing input", () => {
    const threads = [makeThread({ id: "a", projectId: "a", indicator: "waiting-for-input" }),
      makeThread({ id: "b", projectId: "b", status: "active" })];
    const result = projectRailProjects(projects, threads, { d: true, c: true },
      { ...EMPTY_PROJECT_ORGANISATION, pinOrder: ["d", "c"] }, new Map(), NOW);
    expect(result.map(project => project.id)).toEqual(["d", "c", "a", "b"]);
  });

  it("does not count a blocked starting thread as working", () => {
    const [project] = projectRailProjects(projects, [makeThread({ id: "a", projectId: "a", status: "starting", hasPendingInteraction: true })],
      {}, EMPTY_PROJECT_ORGANISATION, new Map(), NOW);
    expect(project).toMatchObject({ waiting: 1, working: 0 });
  });

  it("keeps monograms distinct for bb-plugin names and handles Unicode", () => {
    expect(projectInitials("bb-plugin-radar-sidebar")).toBe("RS");
    expect(projectInitials("bb-plugin-composer-predictions")).toBe("CP");
    expect(projectInitials("Learn Anything")).toBe("LA");
    expect(projectInitials("東京")).toBe("東京");
    expect(projectInitials("---")).toBe("?");
  });
});
