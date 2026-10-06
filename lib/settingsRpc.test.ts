import { describe, expect, it } from "vitest";
import { SETTINGS_RPC } from "./settingsRpc";

const validate = (schema: { "~standard": { validate: (value: unknown) => unknown } }, value: unknown) =>
  schema["~standard"].validate(value) as { value?: unknown; issues?: { message: string }[] };

describe("settings RPC schemas", () => {
  it("accepts a change a setting can take", () => {
    expect(validate(SETTINGS_RPC.setSetting.input, { key: "railNav", value: true }).value).toEqual({ key: "railNav", value: true });
    expect(validate(SETTINGS_RPC.setSetting.input, { key: "swipeLeft", value: "Pin / unpin" }).issues).toBeUndefined();
    expect(validate(SETTINGS_RPC.setSetting.input, { key: "railLiveStatus", value: { "dot/dot": "icon" } }).issues).toBeUndefined();
  });

  it.each([
    [{ key: "nope", value: true }, "Unknown setting."],
    [{ key: "constructor", value: true }, "Unknown setting."],
    [{ key: "railNav", value: "yes" }, "Not a value railNav can take."],
    [{ key: "defaultDensity", value: "roomy" }, "Not a value defaultDensity can take."],
    [{ key: "railLiveStatus", value: { "dot/dot": "mascot" } }, "Not a value railLiveStatus can take."],
    [null, "Unknown setting."],
  ])("rejects %j", (input, message) => {
    expect(validate(SETTINGS_RPC.setSetting.input, input).issues?.[0]?.message).toBe(message);
  });

  it("takes no input to read the saved choices", () => {
    expect(validate(SETTINGS_RPC.getSettings.input, null).issues).toBeUndefined();
    expect(validate(SETTINGS_RPC.getSettings.input, undefined).issues).toBeUndefined();
    expect(validate(SETTINGS_RPC.getSettings.input, { a: 1 }).issues?.[0]?.message).toBe("Takes no input.");
  });

  it("preserves the server revision while sanitizing saved choices", () => {
    expect(validate(SETTINGS_RPC.getSettings.output, { railNav: true, ghost: 1, revision: 7 }).value)
      .toEqual({ railNav: true, revision: 7 });
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2"])("rejects an invalid snapshot revision %s", (revision) => {
    expect(validate(SETTINGS_RPC.getSettings.output, { railNav: true, revision }).issues?.[0]?.message)
      .toBe("Invalid settings snapshot.");
  });

  it.each(["off", "badge", "icon"])("accepts an atomic accessory mode %s", (mode) => {
    expect(validate(SETTINGS_RPC.setRailLiveStatus.input, { itemId: "alpha/dot", mode }).value)
      .toEqual({ itemId: "alpha/dot", mode });
  });

  it.each([
    null, {}, { itemId: "", mode: "off" }, { itemId: 123, mode: "off" },
    { itemId: "__proto__", mode: "badge" }, { itemId: "constructor", mode: "icon" },
    { itemId: "prototype", mode: "off" }, { itemId: "alpha/dot", mode: "mascot" },
  ])("rejects an invalid atomic accessory edit %j", (input) => {
    expect(validate(SETTINGS_RPC.setRailLiveStatus.input, input).issues?.[0]?.message)
      .toBe("Invalid live-status item or mode.");
  });

  it("drops anything unknown or invalid from the saved set", () => {
    const output = validate(SETTINGS_RPC.getSettings.output, { railNav: true, motion: "no", ghost: 1, defaultDensity: "compact" });
    expect(output.value).toEqual({ railNav: true, defaultDensity: "compact", revision: 0 });
  });
});
