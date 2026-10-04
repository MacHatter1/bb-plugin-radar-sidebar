import { describe, expect, it } from "vitest";
import { SETTINGS_RPC } from "./settingsRpc";

const validate = (schema: { "~standard": { validate: (value: unknown) => unknown } }, value: unknown) =>
  schema["~standard"].validate(value) as { value?: unknown; issues?: { message: string }[] };

describe("settings RPC schemas", () => {
  it("accepts a change a setting can take", () => {
    expect(validate(SETTINGS_RPC.setSetting.input, { key: "railNav", value: true }).value).toEqual({ key: "railNav", value: true });
    expect(validate(SETTINGS_RPC.setSetting.input, { key: "swipeLeft", value: "Pin / unpin" }).issues).toBeUndefined();
  });

  it.each([
    [{ key: "nope", value: true }, "Unknown setting."],
    [{ key: "constructor", value: true }, "Unknown setting."],
    [{ key: "railNav", value: "yes" }, "Not a value railNav can take."],
    [{ key: "defaultDensity", value: "roomy" }, "Not a value defaultDensity can take."],
    [null, "Unknown setting."],
  ])("rejects %j", (input, message) => {
    expect(validate(SETTINGS_RPC.setSetting.input, input).issues?.[0]?.message).toBe(message);
  });

  it("takes no input to read the saved choices", () => {
    expect(validate(SETTINGS_RPC.getSettings.input, null).issues).toBeUndefined();
    expect(validate(SETTINGS_RPC.getSettings.input, undefined).issues).toBeUndefined();
    expect(validate(SETTINGS_RPC.getSettings.input, { a: 1 }).issues?.[0]?.message).toBe("Takes no input.");
  });

  it("drops anything unknown or invalid from the saved set", () => {
    const output = validate(SETTINGS_RPC.getSettings.output, { railNav: true, motion: "no", ghost: 1, defaultDensity: "compact" });
    expect(output.value).toEqual({ railNav: true, defaultDensity: "compact" });
  });
});
