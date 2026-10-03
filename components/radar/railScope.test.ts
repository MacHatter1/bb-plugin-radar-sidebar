import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  monogram,
  projectHue,
  resetRailScope,
  setRailScope,
  subscribeRailScope,
  useRailScope,
} from "./railScope";

describe("monogram", () => {
  it.each([
    ["bb-plugin-radar-sidebar", "BP"],
    ["bb", "BB"],
    ["ERBareeq", "ER"],
    ["Personal", "PE"],
    ["my app", "MA"],
    ["", "?"],
    ["---", "?"],
  ])("%s → %s", (name, expected) => {
    expect(monogram(name)).toBe(expected);
  });
});

describe("projectHue", () => {
  it("is stable and spreads sibling ids apart", () => {
    const ids = [
      "proj_wj4ziacq3f",
      "proj_wj4ziacq3g",
      "proj_abc123",
      "proj_abc124",
      "proj_zzzzzz",
    ];
    const hues = ids.map(projectHue);
    expect(ids.map(projectHue)).toEqual(hues);
    for (const hue of hues) expect(hue).toBeGreaterThanOrEqual(0);
    for (const hue of hues) expect(hue).toBeLessThan(360);
    const sorted = [...hues].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(10);
    }
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetRailScope();
  localStorage.clear();
});

describe("rail scope store", () => {
  it("notifies and persists once, treating the same value as a no-op", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRailScope(listener);
    const write = vi.spyOn(Storage.prototype, "setItem");
    setRailScope("proj_a");
    setRailScope("proj_a");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("radar-sidebar:rail-scope:v1")).toBe("proj_a");
    setRailScope(null);
    setRailScope(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("radar-sidebar:rail-scope:v1")).toBeNull();
    unsubscribe();
  });

  it("removes only the departing listener and makes teardown idempotent", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = subscribeRailScope(first);
    const offSecond = subscribeRailScope(second);
    offFirst();
    offFirst();
    setRailScope("proj_a");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    offSecond();
    setRailScope("proj_b");
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps mounted consumers working when storage quota or access fails", () => {
    const { result, unmount } = renderHook(useRailScope);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    act(() => setRailScope("proj_a"));
    expect(result.current).toBe("proj_a");
    act(() => setRailScope(null));
    expect(result.current).toBeNull();
    unmount();
    expect(() => setRailScope("proj_b")).not.toThrow();
  });
});
