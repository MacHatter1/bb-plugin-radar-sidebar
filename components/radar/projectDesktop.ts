import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

export function desktopPlatform(): "macos" | "linux" | "windows" | null {
  if (typeof window === "undefined") return null;
  const platform = (window as Window & { bbDesktop?: { platform?: string } }).bbDesktop?.platform;
  return platform === "macos" || platform === "linux" || platform === "windows" ? platform : null;
}
export type ProjectDesktopSdk = {
  projects: { get: (...args: Parameters<PluginBrowserBbSdk["projects"]["get"]>) => Promise<Pick<Awaited<ReturnType<PluginBrowserBbSdk["projects"]["get"]>>, "sources">> };
  system: { config: () => Promise<Pick<Awaited<ReturnType<PluginBrowserBbSdk["system"]["config"]>>, "localHelperPorts">> };
};
export type LocalProjectFolder = { port: number; path: string };
const localStatus = z.object({ hostId: z.string().min(1), platform: z.enum(["darwin", "linux", "win32"]), serverUrl: z.string().url() });
const targetSchema = z.object({
  id: z.string().min(1).max(200), label: z.string().min(1).max(200), kind: z.string().optional(),
  capabilities: z.object({ openDirectory: z.boolean() }),
});
export type ProjectOpenTarget = z.infer<typeof targetSchema>;
const signalFor = (timeout: number, signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);

/** Resolve the checkout on the viewing desktop, even when BB's server is remote. */
export async function localProjectFolder(sdk: ProjectDesktopSdk, projectId: string, signal?: AbortSignal): Promise<LocalProjectFolder> {
  const platform = desktopPlatform();
  if (!platform) throw new Error("Opening local apps requires the BB desktop app.");
  const [project, config] = await Promise.all([sdk.projects.get({ projectId }), sdk.system.config()]);
  const expectedPlatform = { macos: "darwin", linux: "linux", windows: "win32" }[platform];
  const ports = [...new Set(config.localHelperPorts)].filter(port => Number.isInteger(port) && port > 0 && port <= 65535);
  const connections = await Promise.all(ports.map(async port => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: signalFor(3000, signal) });
      if (!response.ok) return null;
      const status = localStatus.safeParse(await response.json());
      return status.success && status.data.platform === expectedPlatform ? { port, ...status.data } : null;
    } catch { return null; }
  }));
  const available = connections.filter(connection => connection !== null);
  const connection = available.find(({ serverUrl }) => new URL(serverUrl).origin === window.location.origin) ?? available[0];
  const machine = platform === "macos" ? "Mac" : "computer";
  if (!connection) throw new Error(`BB could not connect to this ${machine} to open local apps.`);
  const sources = project.sources.filter(source => source.hostId === connection.hostId);
  const source = sources.find(candidate => candidate.isDefault) ?? sources[0];
  if (!source) throw new Error(`This project has no folder on this ${machine}.`);
  const absolute = platform === "windows" ? /^(?:[A-Za-z]:[\\/]|\\\\)/.test(source.path) : source.path.startsWith("/");
  if (!absolute || source.path.includes("\0")) throw new Error("This project's folder path is invalid.");
  return { port: connection.port, path: source.path };
}

export async function discoverProjectOpenTargets(sdk: ProjectDesktopSdk, projectId: string, signal?: AbortSignal) {
  const folder = await localProjectFolder(sdk, projectId, signal);
  const response = await fetch(`http://127.0.0.1:${folder.port}/workspace-open-targets?path=${encodeURIComponent(folder.path)}`, { signal: signalFor(3000, signal) });
  if (!response.ok) throw new Error("BB could not find local editor and terminal apps.");
  const { targets } = z.object({ targets: z.array(targetSchema).max(128) }).parse(await response.json());
  return { folder, targets: targets.filter(target => target.capabilities.openDirectory && (target.kind === "editor" || target.kind === "terminal")) };
}

export async function openProjectTarget(folder: LocalProjectFolder, targetId: string): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${folder.port}/open-in-target`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId, path: folder.path, context: { kind: "local" }, lineNumber: null }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("The app could not open this project's folder.");
}
