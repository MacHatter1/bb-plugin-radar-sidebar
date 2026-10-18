import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { makeProject } from "./fixtures";
import { setProjectScope, useProjectScope } from "./projectScope";

afterEach(() => { cleanup(); vi.restoreAllMocks(); setProjectScope(null); localStorage.clear(); });

it("retains empty projects and loading/error snapshots, clearing only a removed project", () => {
  const directory = { projects: [makeProject({ id: "empty" })], status: "ready" as PluginSidebarThreadsState["status"] };
  const hook = renderHook(props => useProjectScope(props), { initialProps: directory });
  act(() => setProjectScope("empty"));
  expect(hook.result.current).toBe("empty");
  hook.rerender({ projects: [], status: "loading" });
  expect(hook.result.current).toBe("empty");
  hook.rerender({ projects: [], status: "error" });
  expect(hook.result.current).toBe("empty");
  hook.rerender(directory);
  expect(hook.result.current).toBe("empty");
  hook.rerender({ projects: [], status: "ready" });
  expect(hook.result.current).toBeNull();
  hook.rerender(directory);
  expect(hook.result.current).toBeNull();
});

it("reconciles project choices and clearing from another browser window", () => {
  const projects = [makeProject({ id: "a" }), makeProject({ id: "b" })];
  const hook = renderHook(() => useProjectScope({ projects, status: "ready" }));
  act(() => setProjectScope("a"));
  expect(hook.result.current).toBe("a");
  act(() => {
    localStorage.setItem("radar-sidebar:rail-scope:v1", "b");
    window.dispatchEvent(new StorageEvent("storage", { key: "radar-sidebar:rail-scope:v1" }));
  });
  expect(hook.result.current).toBe("b");
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  expect(hook.result.current).toBeNull();
});

it("keeps a failed selection for both subscribers and a remount while persisted storage stays readable", () => {
  const projects = [makeProject({ id: "a" }), makeProject({ id: "b" })];
  const first = renderHook(() => useProjectScope({ projects, status: "ready" }));
  const second = renderHook(() => useProjectScope({ projects, status: "ready" }));
  act(() => setProjectScope("a"));
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full storage", "QuotaExceededError");
  });
  act(() => setProjectScope("b"));
  expect(localStorage.getItem("radar-sidebar:rail-scope:v1")).toBe("a");
  expect([first.result.current, second.result.current]).toEqual(["b", "b"]);
  first.unmount();
  second.unmount();
  const next = renderHook(() => useProjectScope({ projects, status: "ready" }));
  expect(next.result.current).toBe("b");
  write.mockRestore();
  act(() => setProjectScope("b"));
  expect(next.result.current).toBe("b");
  expect(localStorage.getItem("radar-sidebar:rail-scope:v1")).toBe("b");
});


const scopeKey = "radar-sidebar:rail-scope:v1";
const directory = { projects: [makeProject({ id: "a" }), makeProject({ id: "b" }), makeProject({ id: "c" })], status: "ready" as const };
const quotaError = () => { throw new DOMException("Full storage", "QuotaExceededError"); };

it("keeps a failed removal cleared through remount and releases it after a successful retry", () => {
  act(() => setProjectScope("a"));
  const hook = renderHook(() => useProjectScope(directory));
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(quotaError);
  act(() => setProjectScope(null));
  expect(hook.result.current).toBeNull();
  expect(localStorage.getItem(scopeKey)).toBe("a");
  hook.unmount();
  const next = renderHook(() => useProjectScope(directory));
  expect(next.result.current).toBeNull();
  remove.mockRestore();
  act(() => setProjectScope("b"));
  expect(next.result.current).toBe("b");
  expect(localStorage.getItem(scopeKey)).toBe("b");
  act(() => setProjectScope(null));
  expect(next.result.current).toBeNull();
  expect(localStorage.getItem(scopeKey)).toBeNull();
});

it("does not resurrect a removed project when clearing its selection cannot persist", () => {
  act(() => setProjectScope("a"));
  const hook = renderHook(props => useProjectScope(props), { initialProps: directory });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(quotaError);
  hook.rerender({ ...directory, projects: [makeProject({ id: "b" })] });
  expect(hook.result.current).toBeNull();
  hook.rerender(directory);
  expect(hook.result.current).toBeNull();
  expect(localStorage.getItem(scopeKey)).toBe("a");
});

it("reconciles remote set and clear events while ignoring unrelated keys and storage areas", () => {
  act(() => setProjectScope("a"));
  const first = renderHook(() => useProjectScope(directory));
  const second = renderHook(() => useProjectScope(directory));
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(quotaError);
  act(() => setProjectScope("b"));
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "another-key", storageArea: localStorage }));
    window.dispatchEvent(new StorageEvent("storage", { key: scopeKey, storageArea: sessionStorage }));
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: sessionStorage }));
  });
  expect([first.result.current, second.result.current]).toEqual(["b", "b"]);
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: scopeKey, storageArea: localStorage, newValue: "a" })));
  expect([first.result.current, second.result.current]).toEqual(["a", "a"]);
  act(() => setProjectScope("b"));
  write.mockRestore();
  act(() => {
    localStorage.setItem(scopeKey, "c");
    window.dispatchEvent(new StorageEvent("storage", { key: scopeKey, newValue: "c", storageArea: localStorage }));
  });
  expect([first.result.current, second.result.current]).toEqual(["c", "c"]);
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
  });
  expect([first.result.current, second.result.current]).toEqual([null, null]);
});

it("accepts a changed remote value during an interval with no mounted subscriber", () => {
  act(() => setProjectScope("a"));
  const hook = renderHook(() => useProjectScope(directory));
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(quotaError);
  act(() => setProjectScope("b"));
  expect(hook.result.current).toBe("b");
  hook.unmount();
  write.mockRestore();
  localStorage.setItem(scopeKey, "c");
  const next = renderHook(() => useProjectScope(directory));
  expect(next.result.current).toBe("c");
});

it("retains unsaved intent when reads recover and uses the latest remote choice if reads become blocked", () => {
  act(() => setProjectScope("a"));
  const hook = renderHook(() => useProjectScope(directory));
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(quotaError);
  act(() => setProjectScope("b"));
  expect(hook.result.current).toBe("b");
  read.mockRestore();
  hook.rerender();
  expect(hook.result.current).toBe("b");
  write.mockRestore();
  act(() => {
    localStorage.setItem(scopeKey, "c");
    window.dispatchEvent(new StorageEvent("storage", { key: scopeKey }));
  });
  expect(hook.result.current).toBe("c");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
  hook.rerender();
  expect(hook.result.current).toBe("c");
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: scopeKey, newValue: "a" })));
  expect(hook.result.current).toBe("a");
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
  expect(hook.result.current).toBeNull();
});

it("uses relevant storage events when accessing localStorage itself throws", () => {
  const area = localStorage;
  act(() => setProjectScope("a"));
  const hook = renderHook(() => useProjectScope(directory));
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
  act(() => setProjectScope("b"));
  expect(hook.result.current).toBe("b");
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: scopeKey, newValue: "c", storageArea: area })));
  expect(hook.result.current).toBe("c");
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: area })));
  expect(hook.result.current).toBeNull();
});
