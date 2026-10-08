import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopPlatform, discoverProjectOpenTargets, openProjectTarget } from "./projectDesktop";

const port = 38887;
const url = `http://127.0.0.1:${port}`;
const target = (id: string, kind: string, openDirectory = true) => ({ id, kind, label: id, capabilities: { openDirectory } });
function setup(platform = "macos", path = "/Users/tom/Project with spaces", hostId = "local") {
  vi.stubGlobal("bbDesktop", { platform });
  const sources = [{ id: "source", hostId, path, isDefault: true, type: "local_path" as const, projectId: "proj_a", createdAt: 0, updatedAt: 0 }];
  const sdk = { projects: { get: vi.fn(async () => ({ sources })) }, system: { config: vi.fn(async () => ({ localHelperPorts: [port] })) } };
  const fetch = vi.fn(async (request: string, options?: RequestInit) => {
    if (options?.method === "POST") return new Response("{}");
    if (request.endsWith("/status")) return Response.json({ hostId: "local", platform: { macos: "darwin", linux: "linux", windows: "win32" }[platform], serverUrl: window.location.origin });
    return Response.json({ targets: [target("vscode", "editor"), target("terminal", "terminal"), target("finder", "file-manager"), target("file-only", "editor", false)] });
  });
  vi.stubGlobal("fetch", fetch);
  return { sdk, fetch };
}
afterEach(() => vi.unstubAllGlobals());
describe("desktop project quick actions", () => {
  it.each([["macos", "/Users/tom/Project with spaces"], ["linux", "/home/tom/project"], ["windows", "C:\\Users\\tom\\Project"], ["windows", "\\\\server\\share\\Project"]])("discovers installed directory editors and terminals on %s", async (platform, path) => {
    const { sdk, fetch } = setup(platform, path);
    expect(desktopPlatform()).toBe(platform);
    const discovered = await discoverProjectOpenTargets(sdk, "proj_a");
    expect(discovered.folder).toEqual({ port, path });
    expect(discovered.targets.map(app => app.id)).toEqual(["vscode", "terminal"]);
    expect(fetch).toHaveBeenLastCalledWith(`${url}/workspace-open-targets?path=${encodeURIComponent(path!)}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await openProjectTarget(discovered.folder, "terminal");
    expect(fetch).toHaveBeenLastCalledWith(`${url}/open-in-target`, expect.objectContaining({ method: "POST", body: JSON.stringify({ targetId: "terminal", path, context: { kind: "local" }, lineNumber: null }) }));
  });
  it("does not discover or launch local apps outside the desktop app", async () => {
    const { sdk, fetch } = setup();
    vi.stubGlobal("bbDesktop", undefined);
    await expect(discoverProjectOpenTargets(sdk, "proj_a")).rejects.toThrow("desktop app");
    expect(sdk.projects.get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not offer apps for a checkout that only exists on another host", async () => {
    const { sdk, fetch } = setup("macos", "/srv/project", "remote");
    await expect(discoverProjectOpenTargets(sdk, "proj_a")).rejects.toThrow("no folder");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { targets: [{ id: "vscode", label: "VS Code" }] }])("rejects malformed discovery results %j", async response => {
    const { sdk, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json({ hostId: "local", platform: "darwin", serverUrl: window.location.origin })).mockResolvedValueOnce(Response.json(response));
    await expect(discoverProjectOpenTargets(sdk, "proj_a")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("reports discovery and launch failures", async () => {
    const { sdk, fetch } = setup();
    fetch.mockResolvedValueOnce(Response.json({ hostId: "local", platform: "darwin", serverUrl: window.location.origin })).mockResolvedValueOnce(new Response("failed", { status: 500 }));
    await expect(discoverProjectOpenTargets(sdk, "proj_a")).rejects.toThrow("could not find");
    fetch.mockResolvedValueOnce(new Response("failed", { status: 500 }));
    await expect(openProjectTarget({ port, path: "/project" }, "terminal")).rejects.toThrow("could not open");
  });
});
