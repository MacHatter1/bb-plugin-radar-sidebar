import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** Discoverable method names are the versioned seam; never import Radar UI. */
export const EXPERIMENTAL_RADAR_METHODS = {
  contributions: "radar.v1.contributions",
  action: "radar.v1.action",
} as const;
export const RADAR_BATCH_SIZE = 64;
export const RADAR_MAX_BADGES = 3;
export const RADAR_MAX_ACTIONS = 8;

const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const threadId = z.string().min(1).max(256);
const label = z.string().trim().min(1).max(120);
const order = z.number().int().min(-100).max(100).optional();
const icon = z.string().min(1).max(128).optional();

/** Safe external URLs, or BB plugin-panel routes. No scripts or arbitrary DOM. */
export const experimental_radarHrefSchema = z.string().max(2048).refine((value) => {
  if (value.includes("\\") || /[\u0000-\u0020\u007f]/.test(value)) return false;
  if (value.startsWith("/plugins/")) {
    if (!/^\/plugins\/[a-z0-9-]+\/[a-zA-Z0-9_-]+(?:[/?#].*)?$/.test(value)) return false;
    // Dot-segment normalisation must not escape the declared owner’s route.
    return new URL(value, "https://radar.invalid").pathname === value.split(/[?#]/)[0];
  }
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}, "Use an HTTP(S) URL or a BB plugin-panel route.");

export const experimental_radarBadgeSchema = z.object({
  id, label, icon, order,
  text: z.string().trim().min(1).max(12).optional(),
  tone: z.enum(["neutral", "info", "success", "warning", "danger"]).optional(),
}).strict();

const actionBase = { id, label, icon, order, disabled: z.boolean().optional() };
export const experimental_radarActionSchema = z.discriminatedUnion("kind", [
  z.object({ ...actionBase, kind: z.literal("rpc"), confirmation: z.string().trim().min(1).max(240).optional() }).strict(),
  z.object({ ...actionBase, kind: z.literal("link"), href: experimental_radarHrefSchema }).strict(),
]);

export const experimental_radarRequestSchema = z.object({
  threadIds: z.array(threadId).max(RADAR_BATCH_SIZE).refine((ids) => new Set(ids).size === ids.length, "Duplicate thread ids."),
}).strict();

export const experimental_radarResponseSchema = z.object({
  version: z.literal(1),
  threads: z.array(z.object({
    threadId,
    badges: z.array(experimental_radarBadgeSchema).max(RADAR_MAX_BADGES),
    actions: z.array(experimental_radarActionSchema).max(RADAR_MAX_ACTIONS),
  }).strict()).max(RADAR_BATCH_SIZE),
}).strict().superRefine((value, ctx) => {
  const threads = new Set<string>();
  value.threads.forEach((thread, index) => {
    if (threads.has(thread.threadId)) ctx.addIssue({ code: "custom", path: ["threads", index, "threadId"], message: "Duplicate thread." });
    threads.add(thread.threadId);
    for (const key of ["badges", "actions"] as const) {
      const ids = new Set<string>();
      thread[key].forEach((item, i) => {
        if (ids.has(item.id)) ctx.addIssue({ code: "custom", path: ["threads", index, key, i, "id"], message: "Duplicate contribution id." });
        ids.add(item.id);
      });
    }
  });
});

export const experimental_radarActionRequestSchema = z.object({ threadId, actionId: id }).strict();
export const experimental_radarActionResultSchema = z.object({
  message: z.string().trim().min(1).max(240).optional(),
}).strict();

export const EXPERIMENTAL_RADAR_RPC = {
  [EXPERIMENTAL_RADAR_METHODS.contributions]: {
    experimental_description: "Radar v1: batched thread badges and context-menu actions.",
    input: experimental_radarRequestSchema,
    output: experimental_radarResponseSchema,
  },
  [EXPERIMENTAL_RADAR_METHODS.action]: {
    experimental_description: "Radar v1: explicitly activate a contributor-owned thread action.",
    input: experimental_radarActionRequestSchema,
    output: experimental_radarActionResultSchema,
  },
} as const;

export type RadarBadge = z.infer<typeof experimental_radarBadgeSchema>;
export type RadarAction = z.infer<typeof experimental_radarActionSchema>;
export type RadarRequest = z.infer<typeof experimental_radarRequestSchema>;
export type RadarResponse = z.infer<typeof experimental_radarResponseSchema>;
export type RadarActionRequest = z.infer<typeof experimental_radarActionRequestSchema>;
export type RadarActionResult = z.infer<typeof experimental_radarActionResultSchema>;

/** Register on the CONTRIBUTOR's server. BB owns discovery, reload and removal.
 * Recheck action availability in run(): menu data is not authorisation. */
export function experimental_registerRadarContributor(
  bb: Pick<BbPluginApi, "rpc">,
  handlers: {
    provide(input: RadarRequest): RadarResponse | Promise<RadarResponse>;
    run(input: RadarActionRequest): RadarActionResult | Promise<RadarActionResult>;
  },
): void {
  bb.rpc.register(EXPERIMENTAL_RADAR_RPC, {
    [EXPERIMENTAL_RADAR_METHODS.contributions]: handlers.provide,
    [EXPERIMENTAL_RADAR_METHODS.action]: handlers.run,
  }, { experimental_discoverable: true, experimental_description: "Radar Sidebar contributions, version 1." });
}
