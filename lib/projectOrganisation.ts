import { z } from "zod";

export const projectIdSchema = z.string().min(1).max(128)
  .refine(id => !["__proto__", "constructor", "prototype"].includes(id));
const nameSchema = z.string().trim().min(1).max(64).refine(name => !/[\u0000-\u001f]/.test(name));
const boundedMap = <T extends z.ZodType>(value: T, limit: number) =>
  // Validate original keys first: Zod records omit __proto__ during parsing.
  z.custom<Record<string, unknown>>(raw => raw !== null && typeof raw === "object" && !Array.isArray(raw)
    && Object.keys(raw).length <= limit && Object.keys(raw).every(id => projectIdSchema.safeParse(id).success))
    .pipe(z.record(projectIdSchema, value));

export const projectOrganisationSchema = z.object({
  pinOrder: z.array(projectIdSchema).max(512).refine(ids => new Set(ids).size === ids.length),
  collections: boundedMap(z.object({ name: nameSchema, collapsed: z.boolean() }).strict(), 64),
  projectCollections: boundedMap(projectIdSchema, 512),
}).strict().refine(value => Object.values(value.projectCollections).every(id => Object.hasOwn(value.collections, id)));
export type ProjectOrganisation = z.infer<typeof projectOrganisationSchema>;
export const EMPTY_PROJECT_ORGANISATION: ProjectOrganisation = { pinOrder: [], collections: {}, projectCollections: {} };

export const projectOrganisationChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move-pin"), projectId: projectIdSchema, beforeProjectId: projectIdSchema.nullable() }).strict(),
  z.object({ kind: z.literal("create-collection"), collectionId: projectIdSchema, name: nameSchema, projectId: projectIdSchema.optional() }).strict(),
  z.object({ kind: z.literal("rename-collection"), collectionId: projectIdSchema, name: nameSchema }).strict(),
  z.object({ kind: z.literal("collapse-collection"), collectionId: projectIdSchema, collapsed: z.boolean() }).strict(),
  z.object({ kind: z.literal("delete-collection"), collectionId: projectIdSchema }).strict(),
  z.object({ kind: z.literal("assign-collection"), projectId: projectIdSchema, collectionId: projectIdSchema.nullable() }).strict(),
]);
export type ProjectOrganisationChange = z.infer<typeof projectOrganisationChangeSchema>;

/** Older pins acquire a stable order without dropping pins from another window. */
export function orderedProjectPins(pins: Record<string, boolean>, order: readonly string[]): string[] {
  return [...new Set([...order, ...Object.keys(pins)])].filter(id => pins[id] === true);
}

/** Apply one intent against the latest snapshot, never a stale whole layout. */
export function changeProjectOrganisation(
  current: ProjectOrganisation,
  pins: Record<string, boolean>,
  change: ProjectOrganisationChange,
): ProjectOrganisation {
  let pinOrder = orderedProjectPins(pins, current.pinOrder);
  const collections = { ...current.collections };
  const projectCollections = { ...current.projectCollections };
  switch (change.kind) {
    case "move-pin": {
      if (pins[change.projectId] !== true) throw new Error("This project is no longer pinned.");
      if (change.beforeProjectId === change.projectId) break;
      pinOrder = pinOrder.filter(id => id !== change.projectId);
      const before = change.beforeProjectId === null ? -1 : pinOrder.indexOf(change.beforeProjectId);
      pinOrder.splice(before < 0 ? pinOrder.length : before, 0, change.projectId);
      break;
    }
    case "create-collection":
      if (Object.hasOwn(collections, change.collectionId)) throw new Error("This collection already exists.");
      collections[change.collectionId] = { name: change.name, collapsed: false };
      if (change.projectId) projectCollections[change.projectId] = change.collectionId;
      break;
    case "rename-collection":
    case "collapse-collection": {
      const collection = collections[change.collectionId];
      if (!collection) throw new Error("This collection no longer exists.");
      collections[change.collectionId] = change.kind === "rename-collection"
        ? { ...collection, name: change.name }
        : { ...collection, collapsed: change.collapsed };
      break;
    }
    case "delete-collection":
      delete collections[change.collectionId];
      for (const [id, collectionId] of Object.entries(projectCollections)) {
        if (collectionId === change.collectionId) delete projectCollections[id];
      }
      break;
    case "assign-collection":
      if (change.collectionId === null) delete projectCollections[change.projectId];
      else {
        if (!Object.hasOwn(collections, change.collectionId)) throw new Error("This collection no longer exists.");
        projectCollections[change.projectId] = change.collectionId;
      }
      break;
  }
  const next = { pinOrder, collections, projectCollections };
  if (!projectOrganisationSchema.safeParse(next).success) throw new Error("Too many projects or collections, or an invalid collection name.");
  return next;
}
