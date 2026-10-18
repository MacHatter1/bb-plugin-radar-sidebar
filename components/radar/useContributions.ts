import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useRealtimeConnectionState, useSdk } from "@get-bb/plugin-sdk/app";
import { RadarContributionsClient } from "@/lib/contributions";

/** The exclusive list owns one client. Settings may mount a catalog-only client.
 * Content scripts, React components and a second plugin loader are not needed. */
export function useContributions(threadIds: readonly string[], disabled: Readonly<Record<string, boolean>>) {
  const sdk = useSdk();
  const client = useMemo(() => new RadarContributionsClient(sdk), [sdk]);
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  const idsKey = JSON.stringify([...new Set(threadIds)].sort());
  const disabledKey = JSON.stringify(Object.keys(disabled).filter((id) => disabled[id]).sort());

  useEffect(() => {
    client.setInput(JSON.parse(idsKey) as string[], Object.fromEntries(
      (JSON.parse(disabledKey) as string[]).map((id) => [id, true]),
    ));
  }, [client, idsKey, disabledKey]);
  useEffect(() => {
    client.start();
    const focus = () => client.reconcile();
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("focus", focus);
      client.dispose();
    };
  }, [client]);
  useEffect(() => {
    const previous = previousConnection.current;
    previousConnection.current = connection;
    if (connection === "connected" && previous !== "connected") client.reconcile();
  }, [client, connection]);

  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return { ...snapshot, client };
}
