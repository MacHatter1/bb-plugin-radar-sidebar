import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import {
  EXPERIMENTAL_RADAR_METHODS,
  RADAR_BATCH_SIZE,
  experimental_radarActionResultSchema,
  experimental_radarResponseSchema,
  type RadarAction,
  type RadarBadge,
  type RadarResponse,
} from "../packages/contributions/src/index";

export const CONTRIBUTION_REFRESH_MS = 15_000;
export const CONTRIBUTION_TIMEOUT_MS = 3_000;
const MAX_CONTRIBUTORS = 32;
const CONCURRENCY = 4;

type Owned<T> = T & { key: string; pluginId: string; pluginName: string };
export type OwnedRadarBadge = Owned<RadarBadge>;
export type OwnedRadarAction = Owned<RadarAction>;
export interface ThreadContributions {
  badges: readonly OwnedRadarBadge[];
  actions: readonly OwnedRadarAction[];
}
export interface RadarContributor {
  pluginId: string;
  name: string;
  enabled: boolean;
  error?: string;
}
export interface ContributionsSnapshot {
  status: "loading" | "ready" | "unavailable";
  contributors: readonly RadarContributor[];
  rows: ReadonlyMap<string, ThreadContributions>;
}
export const EMPTY_CONTRIBUTIONS: ThreadContributions = { badges: [], actions: [] };
const EMPTY_SNAPSHOT: ContributionsSnapshot = { status: "loading", contributors: [], rows: new Map() };
export const contributionActionId = (action: OwnedRadarAction) => `radar-extension:${action.key}`;

/** Even a transport that ignores AbortSignal cannot keep our UI waiting or
 * commit a late result. Cancellation never retries a potentially mutating RPC. */
function bounded<T>(run: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeout: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const cancel = () => { controller.abort(); reject(new Error("Contribution request cancelled.")); };
    const timer = setTimeout(() => { controller.abort(); reject(new Error("Contributor did not respond in time.")); }, timeout);
    parent.addEventListener("abort", cancel, { once: true });
    if (parent.aborted) cancel();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error("Contribution request cancelled.");
      return run(controller.signal);
    }).then(resolve, reject).finally(() => {
      clearTimeout(timer);
      parent.removeEventListener("abort", cancel);
    });
    // Clear resources immediately on cancellation/timeout, even if run never settles.
    controller.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", cancel);
    }, { once: true });
  });
}

function compare(a: { order?: number; pluginId: string; id: string }, b: { order?: number; pluginId: string; id: string }): number {
  return (a.order ?? 0) - (b.order ?? 0) || lexical(a.pluginId, b.pluginId) || lexical(a.id, b.id);
}
function lexical(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function own<T extends { id: string }>(item: T, provider: RadarContributor): Owned<T> {
  return { ...item, key: `${provider.pluginId}/${item.id}`, pluginId: provider.pluginId, pluginName: provider.name };
}

/** One client per Radar list/settings mount. Discovery and reads share a bounded
 * work queue; rendering never performs RPC. BB remains the plugin registry. */
export class RadarContributionsClient {
  private snapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();
  private threadIds: string[] = [];
  private disabled: Readonly<Record<string, boolean>> = {};
  private active = false;
  private epoch = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private fetch: AbortController | null = null;
  private pending: Promise<void> | null = null;
  private executions = new Map<string, { controller: AbortController; promise: Promise<{ message?: string }>; pluginId: string; threadId: string }>();

  constructor(private sdk: Pick<PluginBrowserBbSdk, "plugins">) {}
  getSnapshot = (): ContributionsSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: ContributionsSnapshot): void {
    const previous = this.snapshot;
    // Stable row identities keep unrelated memoised rows still on refresh.
    const rows = new Map<string, ThreadContributions>();
    for (const [id, row] of next.rows) {
      const old = previous.rows.get(id);
      rows.set(id, old && JSON.stringify(old) === JSON.stringify(row) ? old : row);
    }
    if (previous.status === next.status && JSON.stringify(previous.contributors) === JSON.stringify(next.contributors)
      && previous.rows.size === rows.size && [...rows].every(([id, row]) => previous.rows.get(id) === row)) return;
    this.snapshot = { ...next, rows, contributors: next.contributors.map((provider) => ({ ...provider })) };
    for (const listener of this.listeners) listener();
  }
  setInput(threadIds: readonly string[], disabled: Readonly<Record<string, boolean>>): void {
    const ids = [...new Set(threadIds)].sort(lexical);
    const blocked = Object.keys(disabled).filter((id) => disabled[id] === true).sort(lexical);
    const oldBlocked = Object.keys(this.disabled).filter((id) => this.disabled[id] === true).sort(lexical);
    if (JSON.stringify(ids) === JSON.stringify(this.threadIds) && JSON.stringify(blocked) === JSON.stringify(oldBlocked)) return;
    this.threadIds = ids;
    this.disabled = { ...disabled };
    this.invalidate();
    const wanted = new Set(ids);
    const rows = new Map<string, ThreadContributions>();
    for (const [id, row] of this.snapshot.rows) {
      if (!wanted.has(id)) continue;
      rows.set(id, {
        badges: row.badges.filter((badge) => disabled[badge.pluginId] !== true),
        actions: row.actions.filter((action) => disabled[action.pluginId] !== true),
      });
    }
    for (const execution of this.executions.values()) {
      if (disabled[execution.pluginId] === true || !wanted.has(execution.threadId)) execution.controller.abort();
    }
    this.publish({ ...this.snapshot, rows, contributors: this.snapshot.contributors.map((provider) => ({ ...provider, enabled: disabled[provider.pluginId] !== true })) });
    // Typing/filtering can change visible IDs repeatedly in a single burst.
    if (this.active) this.scheduled = setTimeout(() => { void this.refresh(); }, 150);
  }
  start(): void {
    if (this.active) return;
    this.active = true;
    this.timer = setInterval(() => { void this.refresh(); }, CONTRIBUTION_REFRESH_MS);
    void this.refresh();
  }
  dispose(): void {
    this.active = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.invalidate();
    for (const execution of this.executions.values()) execution.controller.abort();
    this.executions.clear();
    this.publish(EMPTY_SNAPSHOT);
  }
  private invalidate(): void {
    if (this.scheduled !== null) clearTimeout(this.scheduled);
    this.scheduled = null;
    this.epoch++;
    this.fetch?.abort();
    this.fetch = null;
    this.pending = null;
  }
  /** Reconnection must not reuse an older in-flight read. */
  reconcile = (): void => {
    this.invalidate();
    if (this.active) void this.refresh();
  };
  refresh = (): Promise<void> => {
    if (this.scheduled !== null) clearTimeout(this.scheduled);
    this.scheduled = null;
    if (!this.active) return Promise.resolve();
    if (this.pending) return this.pending;
    const epoch = this.epoch;
    const controller = new AbortController();
    this.fetch = controller;
    const pending = this.read(controller.signal, epoch).finally(() => {
      if (this.pending === pending) { this.pending = null; this.fetch = null; }
    });
    this.pending = pending;
    return pending;
  };
  private async read(signal: AbortSignal, epoch: number): Promise<void> {
    try {
      // Experimental support is feature-detected; older BB keeps the normal list.
      const methods = await bounded(() => this.sdk.plugins.experimental_discoverRpc({ method: EXPERIMENTAL_RADAR_METHODS.contributions }), signal, CONTRIBUTION_TIMEOUT_MS);
      const providers = new Map<string, RadarContributor>();
      for (const method of methods) {
        if (method.method !== EXPERIMENTAL_RADAR_METHODS.contributions || !/^[a-z0-9-]{1,128}$/.test(method.pluginId)) continue;
        providers.set(method.pluginId, {
          pluginId: method.pluginId,
          name: method.displayName.slice(0, 120) || method.pluginId,
          enabled: this.disabled[method.pluginId] !== true,
        });
      }
      const contributors = [...providers.values()].sort((a, b) => lexical(a.pluginId, b.pluginId)).slice(0, MAX_CONTRIBUTORS);
      // Remove unloaded/disabled owners before waiting for slower providers.
      const enabledOwners = new Set(contributors.filter((provider) => provider.enabled).map((provider) => provider.pluginId));
      const retained = new Map<string, ThreadContributions>();
      for (const [id, row] of this.snapshot.rows) retained.set(id, {
        badges: row.badges.filter((badge) => enabledOwners.has(badge.pluginId)),
        actions: row.actions.filter((action) => enabledOwners.has(action.pluginId)),
      });
      for (const execution of this.executions.values()) if (!enabledOwners.has(execution.pluginId)) execution.controller.abort();
      if (signal.aborted || epoch !== this.epoch || !this.active) return;
      this.publish({ status: "ready", contributors, rows: retained });
      const rows = new Map<string, { badges: OwnedRadarBadge[]; actions: OwnedRadarAction[] }>();
      const responses = new Map<string, RadarResponse[]>();
      const jobs: (() => Promise<void>)[] = [];
      for (const provider of contributors) {
        if (!provider.enabled) continue;
        for (let index = 0; index < this.threadIds.length; index += RADAR_BATCH_SIZE) {
          const threadIds = this.threadIds.slice(index, index + RADAR_BATCH_SIZE);
          jobs.push(async () => {
            if (provider.error || signal.aborted) return;
            try {
              const raw = await bounded((requestSignal) => this.sdk.plugins.callRpc({
                pluginId: provider.pluginId,
                method: EXPERIMENTAL_RADAR_METHODS.contributions,
                input: { threadIds },
                outputSchema: experimental_radarResponseSchema,
                signal: requestSignal,
              }), signal, CONTRIBUTION_TIMEOUT_MS);
              const result = experimental_radarResponseSchema.parse(raw);
              const allowed = new Set(threadIds);
              if (result.threads.some((thread) => !allowed.has(thread.threadId))) throw new Error("Contributor returned an unrequested thread.");
              const existing = responses.get(provider.pluginId) ?? [];
              existing.push(result);
              responses.set(provider.pluginId, existing);
            } catch (cause) {
              provider.error = cause instanceof Error ? cause.message.slice(0, 240) : "Contributor failed.";
            }
          });
        }
      }
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
        while (!signal.aborted && next < jobs.length) await jobs[next++]!();
      }));
      if (signal.aborted || epoch !== this.epoch || !this.active) return;
      for (const provider of contributors) {
        if (provider.error) continue;
        for (const response of responses.get(provider.pluginId) ?? []) {
          for (const thread of response.threads) {
            const row = rows.get(thread.threadId) ?? { badges: [], actions: [] };
            row.badges.push(...thread.badges.map((badge) => own(badge, provider)));
            row.actions.push(...thread.actions.filter((action) => action.kind !== "link" || !action.href.startsWith("/")
              || action.href.startsWith(`/plugins/${provider.pluginId}/`)).map((action) => own(action, provider)));
            rows.set(thread.threadId, row);
          }
        }
      }
      for (const row of rows.values()) { row.badges.sort(compare); row.actions.sort(compare); }
      this.publish({ status: "ready", contributors, rows });
    } catch {
      if (!signal.aborted && epoch === this.epoch && this.active) this.publish({ status: "unavailable", contributors: [], rows: new Map() });
    }
  }
  /** Only an action present in the latest enabled snapshot can be invoked. */
  execute(threadId: string, key: string): Promise<{ message?: string }> {
    const action = this.snapshot.rows.get(threadId)?.actions.find((item) => item.key === key);
    if (!this.active || !action || action.kind !== "rpc" || action.disabled || this.disabled[action.pluginId] === true) {
      return Promise.reject(new Error("This contributor action is no longer available."));
    }
    const executionKey = JSON.stringify([threadId, key]);
    const existing = this.executions.get(executionKey);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = bounded((signal) => this.sdk.plugins.callRpc({
      pluginId: action.pluginId,
      method: EXPERIMENTAL_RADAR_METHODS.action,
      input: { threadId, actionId: action.id },
      outputSchema: experimental_radarActionResultSchema,
      signal,
    }), controller.signal, 10_000).then((raw) => {
      const result = experimental_radarActionResultSchema.parse(raw);
      this.reconcile();
      return result;
    }).finally(() => {
      if (this.executions.get(executionKey)?.promise === promise) this.executions.delete(executionKey);
    });
    this.executions.set(executionKey, { controller, promise, pluginId: action.pluginId, threadId });
    return promise;
  }
}
