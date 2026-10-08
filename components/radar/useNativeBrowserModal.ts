import { useEffect, useRef, useState } from "react";
import { useBbContext, useSdk, useSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { desktopBrowserBridge, pauseNativeBrowsers } from "./nativeBrowserModal";

/** The collection dialog is mounted only while open. Release native views on every exit. */
export function useNativeBrowserModal(): boolean {
  const sdk = useSdk();
  const { threadId } = useBbContext();
  const split = useSidebarSplitLayout();
  const threadIds = [...new Set([threadId, ...split?.panes.map(pane => pane.threadId) ?? []].filter((id): id is string => id !== null))].sort();
  const scopeKey = JSON.stringify(threadIds);
  const currentThreads = useRef(threadIds);
  currentThreads.current = threadIds;
  const [ready, setReady] = useState(desktopBrowserBridge() === null || threadIds.length === 0);
  useEffect(() => {
    const bridge = desktopBrowserBridge();
    if (!bridge) { setReady(true); return; }
    let mounted = true;
    const route = window.location.href;
    const modal = pauseNativeBrowsers(sdk, bridge, currentThreads.current, id => currentThreads.current.includes(id) && window.location.href === route);
    void modal.ready.then(() => { if (mounted) setReady(true); }, () => {
      modal.dispose();
      if (mounted) { setReady(true); toast.error("Couldn’t hide the browser pane. Close it temporarily to use this dialog."); }
    });
    return () => { mounted = false; modal.dispose(); };
  }, [sdk, scopeKey]);
  return ready;
}
