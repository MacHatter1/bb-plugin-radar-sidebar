import { describe, expect, it } from "vitest";
import { changeProjectOrganisation, EMPTY_PROJECT_ORGANISATION, orderedProjectPins, projectOrganisationChangeSchema, projectOrganisationSchema } from "./projectOrganisation";
import { sanitizeSaved } from "./settings";

describe("project organisation", () => {
  const pins = { a: true, b: true, c: true, ignored: false };
  it("retains the saved pin order, adds older pins and drops unpinned ids", () => {
    expect(orderedProjectPins(pins, ["c", "deleted", "a", "c"])).toEqual(["c", "a", "b"]);
  });
  it("moves a pin before a neighbour or to the end without mutating the saved state", () => {
    const initial = { ...EMPTY_PROJECT_ORGANISATION, pinOrder: ["a", "b", "c"] };
    const moved = changeProjectOrganisation(initial, pins, { kind: "move-pin", projectId: "c", beforeProjectId: "a" });
    expect(moved.pinOrder).toEqual(["c", "a", "b"]);
    expect(changeProjectOrganisation(moved, pins, { kind: "move-pin", projectId: "c", beforeProjectId: null }).pinOrder).toEqual(["a", "b", "c"]);
    expect(initial.pinOrder).toEqual(["a", "b", "c"]);
    expect(changeProjectOrganisation(initial, pins, { kind: "move-pin", projectId: "a", beforeProjectId: "deleted" }).pinOrder).toEqual(["b", "c", "a"]);
    expect(() => changeProjectOrganisation(initial, {}, { kind: "move-pin", projectId: "a", beforeProjectId: null })).toThrow("no longer pinned");
  });
  it("creates, assigns, collapses, renames and removes only the chosen collection", () => {
    let state = changeProjectOrganisation(EMPTY_PROJECT_ORGANISATION, pins, { kind: "create-collection", collectionId: "work", name: "Work", projectId: "a" });
    state = changeProjectOrganisation(state, pins, { kind: "create-collection", collectionId: "personal", name: "Personal", projectId: "b" });
    state = changeProjectOrganisation(state, pins, { kind: "assign-collection", collectionId: "work", projectId: "c" });
    state = changeProjectOrganisation(state, pins, { kind: "collapse-collection", collectionId: "work", collapsed: true });
    state = changeProjectOrganisation(state, pins, { kind: "rename-collection", collectionId: "work", name: "Clients" });
    expect(state.collections.work).toEqual({ name: "Clients", collapsed: true });
    state = changeProjectOrganisation(state, pins, { kind: "delete-collection", collectionId: "work" });
    expect(state.projectCollections).toEqual({ b: "personal" });
    expect(state.collections).toEqual({ personal: { name: "Personal", collapsed: false } });
    expect(state.pinOrder).toEqual(["a", "b", "c"]);
    expect(changeProjectOrganisation(state, pins, { kind: "assign-collection", projectId: "b", collectionId: null }).projectCollections).toEqual({});
    expect(() => changeProjectOrganisation(state, pins, { kind: "assign-collection", projectId: "a", collectionId: "work" })).toThrow("no longer exists");
  });
  it("copies valid settings and ignores invalid layouts without losing other preferences", () => {
    const layout = { pinOrder: ["a"], collections: { work: { name: " Work ", collapsed: true } }, projectCollections: { a: "work" } };
    const saved = sanitizeSaved({ motion: false, projectOrganisation: layout });
    expect(saved.projectOrganisation?.collections.work?.name).toBe("Work");
    expect(saved.projectOrganisation?.collections).not.toBe(layout.collections);
    expect(sanitizeSaved({ motion: false, projectOrganisation: { ...layout, pinOrder: ["a", "a"] } })).toEqual({ motion: false });
  });
  it.each([
    { pinOrder: ["a", "a"] },
    { pinOrder: ["constructor"] },
    { pinOrder: Array.from({ length: 513 }, (_, i) => `p${i}`) },
    { collections: { work: { name: " ", collapsed: false } } },
    { collections: { work: { name: "Bad\0name", collapsed: false } } },
    { collections: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`c${i}`, { name: "Group", collapsed: false }])) },
    { projectCollections: { a: "missing" } },
    { projectCollections: JSON.parse('{"__proto__":"work"}') },
  ])("rejects an invalid layout %j", invalid => {
    expect(projectOrganisationSchema.safeParse({ ...EMPTY_PROJECT_ORGANISATION, ...invalid }).success).toBe(false);
  });
  it.each([
    { kind: "move-pin", projectId: "a" },
    { kind: "create-collection", collectionId: "constructor", name: "Work" },
    { kind: "rename-collection", collectionId: "work", name: "x".repeat(65) },
    { kind: "collapse-collection", collectionId: "work", collapsed: "yes" },
    { kind: "assign-collection", projectId: "a", collectionId: "work", extra: true },
  ])("rejects an invalid operation %j", change => {
    expect(projectOrganisationChangeSchema.safeParse(change).success).toBe(false);
  });
});
