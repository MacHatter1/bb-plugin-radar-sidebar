import { desktopPlatform, localProjectFolder, openProjectTarget, type ProjectDesktopSdk } from "./projectDesktop";

/** The desktop preload owns this marker; a Mac browser does not expose it. */
export function isMacosDesktop(): boolean {
  return desktopPlatform() === "macos";
}

export async function openProjectInFinder(sdk: ProjectDesktopSdk, projectId: string): Promise<void> {
  if (!isMacosDesktop()) throw new Error("Open in Finder requires the macOS desktop app.");
  const folder = await localProjectFolder(sdk, projectId);
  try { await openProjectTarget(folder, "finder"); }
  catch { throw new Error("Finder could not open this project's folder."); }
}
