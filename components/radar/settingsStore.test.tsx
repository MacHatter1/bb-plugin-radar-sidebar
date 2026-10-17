import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useSetSetting, useSettingValues } from "./settingsStore";

/** A stand-in slot that shows a few values and saves twoLineTitles on demand. */
function Probe() {
  const values = useSettingValues();
  const save = useSetSetting();
  const [result, setResult] = useState("");
  return createElement(
    "div", null,
    createElement("span", { "data-testid": "wrap" }, String(values.twoLineTitles)),
    createElement("span", { "data-testid": "density" }, values.defaultDensity),
    createElement("span", { "data-testid": "swipe" }, values.swipeLeft),
    createElement("button", { onClick: () => void save("twoLineTitles", true).then((ok) => setResult(String(ok))) }, "save wrap"),
    createElement("button", { onClick: () => void save("defaultDensity", "compact") }, "save density"),
    createElement("button", { onClick: () => void save("swipeLeft", "Pin / unpin") }, "save pin swipe"),
    createElement("button", { onClick: () => void save("swipeLeft", "Rename") }, "save rename swipe"),
    createElement("button", { onClick: () => void save("twoLineTitles", "yes" as never).then((ok) => setResult(String(ok))) }, "save junk"),
    createElement("output", null, result),
  );
}
const slot = { id: "probe", component: Probe } as never;
const text = (id: string) => screen.getByTestId(id).textContent;
const flush = () => act(async () => {});

afterEach(cleanup);

describe("settings store", () => {
  it("starts from the defaults and keeps them if the server cannot be reached", async () => {
    renderSlot(slot, {}, {});
    await flush();
    expect(text("wrap")).toBe("false");
    expect(text("density")).toBe("comfortable");
  });

  it("follows the choices the server has saved", async () => {
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({ twoLineTitles: true, defaultDensity: "compact" }) } });
    await flush();
    expect(text("wrap")).toBe("true");
    expect(text("density")).toBe("compact");
  });

  it("ignores anything unknown or invalid the server reports", async () => {
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({ twoLineTitles: "yes", defaultDensity: "roomy", ghost: true }) } });
    await flush();
    expect(text("wrap")).toBe("false");
    expect(text("density")).toBe("comfortable");
  });

  it("applies a change another device pushes", async () => {
    const mounted = renderSlot(slot, {}, { rpc: { getSettings: async () => ({}) } });
    await flush();
    await mounted.emitRealtime("settings", { twoLineTitles: true });
    expect(text("wrap")).toBe("true");
    await mounted.emitRealtime("settings", {});
    expect(text("wrap")).toBe("false");
  });

  it("remembers the last values for the next first paint", async () => {
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({ twoLineTitles: true }) } });
    await flush();
    expect(JSON.parse(localStorage.getItem("radar-sidebar:settings:v1")!)).toEqual({ twoLineTitles: true });
  });

  it("shows a save at once and keeps the server's answer", async () => {
    let release!: (value: unknown) => void;
    const setSetting = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({}), setSetting } });
    await flush();
    fireEvent.click(screen.getByText("save wrap"));
    expect(text("wrap")).toBe("true");
    expect(setSetting).toHaveBeenCalledWith({ key: "twoLineTitles", value: true });
    await act(async () => release({ twoLineTitles: true, motion: false }));
    expect(screen.getByRole("status").textContent).toBe("true");
    expect(text("wrap")).toBe("true");
  });

  it("puts the old value back and says so when a save fails", async () => {
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({}), setSetting: async () => { throw new Error("offline"); } } });
    await flush();
    fireEvent.click(screen.getByText("save wrap"));
    await flush();
    expect(text("wrap")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("false");
  });

  it("does not let a push land over a save that is still in flight", async () => {
    let release!: (value: unknown) => void;
    const setSetting = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const mounted = renderSlot(slot, {}, { rpc: { getSettings: async () => ({}), setSetting } });
    await flush();
    fireEvent.click(screen.getByText("save wrap"));
    await mounted.emitRealtime("settings", {});
    expect(text("wrap")).toBe("true");
    await act(async () => release({ twoLineTitles: true }));
    expect(text("wrap")).toBe("true");
  });

  it("preserves a later optimistic change while an earlier save settles", async () => {
    let first!: (value: unknown) => void;
    let second!: (value: unknown) => void;
    const setSetting = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({ revision: 0 }), setSetting } });
    await flush();
    fireEvent.click(screen.getByText("save wrap"));
    fireEvent.click(screen.getByText("save density"));
    expect(text("density")).toBe("compact");
    await act(async () => first({ twoLineTitles: true, revision: 1 }));
    expect(text("density")).toBe("compact");
    await act(async () => second({ twoLineTitles: true, defaultDensity: "compact", revision: 2 }));
    expect(text("wrap")).toBe("true");
    expect(text("density")).toBe("compact");
  });

  it("keeps a newer remote snapshot received during a local save", async () => {
    let release!: (value: unknown) => void;
    const mounted = renderSlot(slot, {}, { rpc: {
      getSettings: async () => ({ revision: 0 }),
      setSetting: () => new Promise((resolve) => { release = resolve; }),
    } });
    await flush();
    fireEvent.click(screen.getByText("save wrap"));
    await mounted.emitRealtime("settings", { twoLineTitles: true, defaultDensity: "compact", revision: 2 });
    await act(async () => release({ twoLineTitles: true, revision: 1 }));
    expect(text("density")).toBe("compact");
    expect(JSON.parse(localStorage.getItem("radar-sidebar:settings:v1")!)).toEqual({ twoLineTitles: true, defaultDensity: "compact" });
  });

  it("does not let an initial fetch overwrite a newer save or push", async () => {
    let release!: (value: unknown) => void;
    const mounted = renderSlot(slot, {}, { rpc: {
      getSettings: () => new Promise((resolve) => { release = resolve; }),
      setSetting: async () => ({ twoLineTitles: true, revision: 1 }),
    } });
    fireEvent.click(screen.getByText("save wrap"));
    await flush();
    await mounted.emitRealtime("settings", { twoLineTitles: true, defaultDensity: "compact", revision: 2 });
    await act(async () => release({ revision: 0 }));
    expect(text("wrap")).toBe("true");
    expect(text("density")).toBe("compact");
  });

  it("rolls back only the failed edit, preserving the later edit of the same setting", async () => {
    let reject!: (error: Error) => void;
    let release!: (value: unknown) => void;
    const setSetting = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({ revision: 0 }), setSetting } });
    await flush();
    fireEvent.click(screen.getByText("save pin swipe"));
    fireEvent.click(screen.getByText("save rename swipe"));
    expect(setSetting).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("failed first save")));
    expect(text("swipe")).toBe("Rename");
    await act(async () => release({ swipeLeft: "Rename", revision: 1 }));
    expect(text("swipe")).toBe("Rename");
    expect(setSetting.mock.calls.map(([input]) => input.value)).toEqual(["Pin / unpin", "Rename"]);
  });

  it("reconciles changes missed while realtime was disconnected", async () => {
    let remote = { twoLineTitles: false, revision: 0 };
    const mounted = renderSlot(slot, {}, { rpc: { getSettings: async () => remote } });
    await flush();
    await mounted.behavior.setRealtimeConnectionState("reconnecting");
    remote = { twoLineTitles: true, revision: 1 };
    await mounted.behavior.setRealtimeConnectionState("connected");
    await flush();
    expect(text("wrap")).toBe("true");
  });

  it("retries a failed initial load when the connection becomes available", async () => {
    const getSettings = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ twoLineTitles: true, revision: 1 });
    const mounted = renderSlot(slot, {}, { rpc: { getSettings }, realtimeConnectionState: "connecting" });
    await flush();
    await mounted.behavior.setRealtimeConnectionState("connected");
    await flush();
    expect(text("wrap")).toBe("true");
  });

  it("refetches after reconnect even when an older fetch is still pending", async () => {
    let release!: (value: unknown) => void;
    const getSettings = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce({ twoLineTitles: true, revision: 1 });
    const mounted = renderSlot(slot, {}, { rpc: { getSettings } });
    await mounted.behavior.setRealtimeConnectionState("reconnecting");
    await mounted.behavior.setRealtimeConnectionState("connected");
    await act(async () => release({ revision: 0 }));
    expect(text("wrap")).toBe("true");
  });

  it("reconciles missed pushes when the last reader remounts", async () => {
    let remote = { twoLineTitles: false, revision: 0 };
    const rpc = { getSettings: async () => remote };
    const mounted = renderSlot(slot, {}, { rpc });
    await flush();
    mounted.lifecycle.unmount();
    remote = { twoLineTitles: true, revision: 1 };
    renderSlot(slot, {}, { rpc });
    await flush();
    expect(text("wrap")).toBe("true");
  });

  it("reconciles a remount even if the previous reader's first fetch is still pending", async () => {
    let release!: (value: unknown) => void;
    const getSettings = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce({ twoLineTitles: true, revision: 1 });
    const mounted = renderSlot(slot, {}, { rpc: { getSettings } });
    mounted.lifecycle.unmount();
    renderSlot(slot, {}, { rpc: { getSettings } });
    await act(async () => release({ revision: 0 }));
    expect(text("wrap")).toBe("true");
  });

  it("refuses a value the setting cannot take without calling the server", async () => {
    const setSetting = vi.fn();
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({}), setSetting } });
    await flush();
    fireEvent.click(screen.getByText("save junk"));
    await flush();
    expect(setSetting).not.toHaveBeenCalled();
    expect(text("wrap")).toBe("false");
  });
});
