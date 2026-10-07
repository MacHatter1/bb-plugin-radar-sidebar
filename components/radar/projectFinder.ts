import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

/** The desktop preload owns this marker; a Mac browser does not expose it. */
export function isMacosDesktop(): boolean {
  return typeof window !== "undefined" &&
    (window as Window & { bbDesktop?: { platform?: string } }).bbDesktop?.platform === "macos";
}

type FinderSdk = {
  projects: {
    get: (...args: Parameters<PluginBrowserBbSdk["projects"]["get"]>) =>
      Promise<Pick<Awaited<ReturnType<PluginBrowserBbSdk["projects"]["get"]>>, "sources">>;
  };
  system: {
    config: () => Promise<Pick<Awaited<ReturnType<PluginBrowserBbSdk["system"]["config"]>>, "localHelperPorts">>;
  };
};

const localStatus = z.object({
  hostId: z.string().min(1),
  platform: z.literal("darwin"),
  serverUrl: z.string().url(),
});

/** Use BB's local helper on the viewing Mac, including with a remote server. */
export async function openProjectInFinder(sdk: FinderSdk, projectId: string): Promise<void> {
  if (!isMacosDesktop()) throw new Error("Open in Finder requires the macOS desktop app.");
  const [project, config] = await Promise.all([
    sdk.projects.get({ projectId }),
    sdk.system.config(),
  ]);
  const ports = [...new Set(config.localHelperPorts)].filter(
    (port) => Number.isInteger(port) && port > 0 && port <= 65535,
  );
  const connections = await Promise.all(ports.map(async (port) => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return null;
      const status = localStatus.safeParse(await response.json());
      if (!status.success) return null;
      return { port, ...status.data };
    } catch {
      return null;
    }
  }));
  const available = connections.filter((connection) => connection !== null);
  const connection = available.find(({ serverUrl }) => new URL(serverUrl).origin === window.location.origin) ?? available[0];
  if (!connection) throw new Error("BB could not connect to this Mac to open Finder.");

  const sources = project.sources.filter((source) => source.hostId === connection.hostId);
  const source = sources.find((candidate) => candidate.isDefault) ?? sources[0];
  if (!source) throw new Error("This project has no folder on this Mac.");
  if (!source.path.startsWith("/") || source.path.includes("\0")) {
    throw new Error("This project's folder path is invalid.");
  }
  const response = await fetch(`http://127.0.0.1:${connection.port}/open-in-target`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId: "finder", path: source.path, context: { kind: "local" }, lineNumber: null }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Finder could not open this project's folder.");
}
