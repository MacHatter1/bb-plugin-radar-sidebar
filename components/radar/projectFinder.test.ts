import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMacosDesktop, openProjectInFinder } from "./projectFinder";

const port = 38887;
const url = `http://127.0.0.1:${port}`;
const source = (hostId: string, path: string, isDefault = false) => ({
  id: `source_${hostId}_${path}`, projectId: "proj_a", hostId, path, isDefault,
  type: "local_path" as const, createdAt: 0, updatedAt: 0,
});
function setup(sources = [source("local", "/Users/tom/Project with spaces", true)], ports = [port]) {
  const sdk = {
    projects: { get: vi.fn(async () => ({ sources })) },
    system: { config: vi.fn(async () => ({ localHelperPorts: ports })) },
  };
  const fetch = vi.fn(async (_url: string, options?: RequestInit) =>
    options?.method === "POST" ? new Response("{}") : Response.json({
      hostId: "local", platform: "darwin", serverUrl: window.location.origin,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  return { sdk, fetch };
}
beforeEach(() => { vi.stubGlobal("bbDesktop", { platform: "macos" }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("project Finder action", () => {
  it.each([undefined, { platform: "linux" }, { platform: "windows" }, {}])("is unavailable without the macOS desktop bridge (%s)", async (desktop) => {
    vi.stubGlobal("bbDesktop", desktop);
    const { sdk, fetch } = setup();
    expect(isMacosDesktop()).toBe(false);
    await expect(openProjectInFinder(sdk, "proj_a")).rejects.toThrow("macOS desktop app");
    expect(sdk.projects.get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("opens the default local project source, even when the global default is remote", async () => {
    const { sdk, fetch } = setup([
      source("remote", "/srv/project", true),
      source("local", "/Users/tom/Other checkout"),
      source("local", "/Users/tom/Project with spaces", true),
    ]);
    await openProjectInFinder(sdk, "proj_a");
    expect(sdk.projects.get).toHaveBeenCalledWith({ projectId: "proj_a" });
    expect(fetch).toHaveBeenLastCalledWith(`${url}/open-in-target`, expect.objectContaining({
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: "finder", path: "/Users/tom/Project with spaces", context: { kind: "local" }, lineNumber: null }),
    }));
  });

  it("uses a non-default local source when the default is on another machine", async () => {
    const { sdk, fetch } = setup([source("remote", "/srv/project", true), source("local", "/Users/tom/local")]);
    await openProjectInFinder(sdk, "proj_a");
    expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string).path).toBe("/Users/tom/local");
  });

  it("prefers the helper connected to this BB server and ignores duplicate or invalid ports", async () => {
    const { sdk, fetch } = setup([source("local", "/Users/tom/project", true)], [port + 1, port, port, 0, -1, 65536, 1.5]);
    fetch.mockImplementation(async (requestUrl, options) => options?.method === "POST" ? new Response("{}") : Response.json({
      hostId: requestUrl === `${url}/status` ? "local" : "other-server",
      platform: "darwin", serverUrl: requestUrl === `${url}/status` ? window.location.origin : "https://other.example.com",
    }));
    await openProjectInFinder(sdk, "proj_a");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.at(-1)![0]).toBe(`${url}/open-in-target`);
  });

  it.each([{ sources: [] }, { sources: [source("remote", "/srv/project", true)] }])("does not send a Finder request for a project without a local source (%s)", async ({ sources }) => {
    const { sdk, fetch } = setup(sources);
    await expect(openProjectInFinder(sdk, "proj_a")).rejects.toThrow("no folder on this Mac");
    expect(fetch.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
  });

  it.each(["relative/project", "/Users/tom/bad\0path"])("rejects an invalid project path (%s)", async (path) => {
    const { sdk, fetch } = setup([source("local", path)]);
    await expect(openProjectInFinder(sdk, "proj_a")).rejects.toThrow("path is invalid");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["offline", "malformed", "linux"])("handles an unavailable or incompatible local helper (%s)", async (state) => {
    const { sdk, fetch } = setup();
    fetch.mockImplementation(async () => {
      if (state === "offline") throw new Error("offline");
      return Response.json(state === "malformed" ? {} : { hostId: "local", platform: "linux", serverUrl: window.location.origin });
    });
    await expect(openProjectInFinder(sdk, "proj_a")).rejects.toThrow("could not connect");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a failed Finder launch", async () => {
    const { sdk, fetch } = setup();
    fetch.mockImplementation(async (_url, options) => options?.method === "POST" ? new Response("failed", { status: 500 }) : Response.json({
      hostId: "local", platform: "darwin", serverUrl: window.location.origin,
    }));
    await expect(openProjectInFinder(sdk, "proj_a")).rejects.toThrow("Finder could not open");
  });
});
