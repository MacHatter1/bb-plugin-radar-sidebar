import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { makeProject } from "./fixtures";
import { setProjectScope, useProjectScope } from "./projectScope";

afterEach(() => { cleanup(); localStorage.clear(); });

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
