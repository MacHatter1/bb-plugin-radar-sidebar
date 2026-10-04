import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useSetSetting, useSettingValues } from "./settingsStore";

/** A stand-in slot that shows a few values and saves railNav on demand. */
function Probe() {
  const values = useSettingValues();
  const save = useSetSetting();
  const [result, setResult] = useState("");
  return createElement(
    "div", null,
    createElement("span", { "data-testid": "rail" }, String(values.railNav)),
    createElement("span", { "data-testid": "density" }, values.defaultDensity),
    createElement("button", { onClick: () => void save("railNav", true).then((ok) => setResult(String(ok))) }, "save rail"),
    createElement("button", { onClick: () => void save("railNav", "yes" as never).then((ok) => setResult(String(ok))) }, "save junk"),
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
    expect(text("rail")).toBe("false");
    expect(text("density")).toBe("comfortable");
  });

  it("follows the choices the server has saved", async () => {
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({ railNav: true, defaultDensity: "compact" }) } });
    await flush();
    expect(text("rail")).toBe("true");
    expect(text("density")).toBe("compact");
  });

  it("ignores anything unknown or invalid the server reports", async () => {
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({ railNav: "yes", defaultDensity: "roomy", ghost: true }) } });
    await flush();
    expect(text("rail")).toBe("false");
    expect(text("density")).toBe("comfortable");
  });

  it("applies a change another device pushes", async () => {
    const mounted = renderSlot(slot, {}, { rpc: { getSettings: async () => ({}) } });
    await flush();
    await mounted.emitRealtime("settings", { railNav: true });
    expect(text("rail")).toBe("true");
    await mounted.emitRealtime("settings", {});
    expect(text("rail")).toBe("false");
  });

  it("remembers the last values for the next first paint", async () => {
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({ railNav: true }) } });
    await flush();
    expect(JSON.parse(localStorage.getItem("radar-sidebar:settings:v1")!)).toEqual({ railNav: true });
  });

  it("shows a save at once and keeps the server's answer", async () => {
    let release!: (value: unknown) => void;
    const setSetting = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({}), setSetting } });
    await flush();
    fireEvent.click(screen.getByText("save rail"));
    expect(text("rail")).toBe("true");
    expect(setSetting).toHaveBeenCalledWith({ key: "railNav", value: true });
    await act(async () => release({ railNav: true, motion: false }));
    expect(screen.getByRole("status").textContent).toBe("true");
    expect(text("rail")).toBe("true");
  });

  it("puts the old value back and says so when a save fails", async () => {
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({}), setSetting: async () => { throw new Error("offline"); } } });
    await flush();
    fireEvent.click(screen.getByText("save rail"));
    await flush();
    expect(text("rail")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe("false");
  });

  it("does not let a push land over a save that is still in flight", async () => {
    let release!: (value: unknown) => void;
    const setSetting = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const mounted = renderSlot(slot, {}, { rpc: { getSettings: async () => ({}), setSetting } });
    await flush();
    fireEvent.click(screen.getByText("save rail"));
    await mounted.emitRealtime("settings", {});
    expect(text("rail")).toBe("true");
    await act(async () => release({ railNav: true }));
    expect(text("rail")).toBe("true");
  });

  it("refuses a value the setting cannot take without calling the server", async () => {
    const setSetting = vi.fn();
    renderSlot(slot, {}, { rpc: { getSettings: async () => ({}), setSetting } });
    await flush();
    fireEvent.click(screen.getByText("save junk"));
    await flush();
    expect(setSetting).not.toHaveBeenCalled();
    expect(text("rail")).toBe("false");
  });
});
