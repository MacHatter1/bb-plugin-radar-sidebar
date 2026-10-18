import { describe, expect, it } from "vitest";
import { SETTINGS_RPC } from "./settingsRpc";

const validate = (schema: { "~standard": { validate: (value: unknown) => unknown } }, value: unknown) =>
  schema["~standard"].validate(value) as { value?: unknown; issues?: { message: string }[] };

describe("settings RPC schemas", () => {
  it("validates atomic project pin changes", () => {
    for (const pinned of [true, false]) {
      expect(validate(SETTINGS_RPC.setProjectPinned.input, { projectId: "proj_a", pinned }).value)
        .toEqual({ projectId: "proj_a", pinned });
    }
    for (const input of [null, {}, { projectId: "", pinned: true }, { projectId: "constructor", pinned: true }, { projectId: "proj_a", pinned: "true" }]) {
      expect(validate(SETTINGS_RPC.setProjectPinned.input, input).issues?.[0]?.message).toBe("Invalid project or pin choice.");
    }
  });

  it("accepts a change a setting can take", () => {
    expect(validate(SETTINGS_RPC.setSetting.input, { key: "twoLineTitles", value: true }).value).toEqual({ key: "twoLineTitles", value: true });
    expect(validate(SETTINGS_RPC.setSetting.input, { key: "swipeLeft", value: "Pin / unpin" }).issues).toBeUndefined();
  });

  it.each(["all", "3", "5", "10"])("accepts and retains the project family limit %s", (value) => {
    const change = { key: "projectThreadLimit", value };
    expect(validate(SETTINGS_RPC.setSetting.input, change).value).toEqual(change);
    expect(validate(SETTINGS_RPC.getSettings.output, { projectThreadLimit: value, revision: 2 }).value)
      .toEqual({ projectThreadLimit: value, revision: 2 });
  });

  it.each([
    [{ key: "nope", value: true }, "Unknown setting."],
    [{ key: "constructor", value: true }, "Unknown setting."],
    [{ key: "twoLineTitles", value: "yes" }, "Not a value twoLineTitles can take."],
    [{ key: "defaultDensity", value: "roomy" }, "Not a value defaultDensity can take."],
    [{ key: "projectThreadLimit", value: "4" }, "Not a value projectThreadLimit can take."],
    [{ key: "projectThreadLimit", value: 3 }, "Not a value projectThreadLimit can take."],
    [{ key: "projectThreadLimit", value: "3 families" }, "Not a value projectThreadLimit can take."],
    [{ key: "railNav", value: true }, "Unknown setting."],
    [null, "Unknown setting."],
  ])("rejects %j", (input, message) => {
    expect(validate(SETTINGS_RPC.setSetting.input, input).issues?.[0]?.message).toBe(message);
  });

  it("validates atomic contributor toggles", () => {
    expect(validate(SETTINGS_RPC.setContributorEnabled.input, { pluginId: "agent-teams", enabled: false }).value)
      .toEqual({ pluginId: "agent-teams", enabled: false });
    for (const input of [null, {}, { pluginId: "teams", enabled: "false" }, { pluginId: "teams/nav", enabled: true }, { pluginId: "constructor", enabled: true }]) {
      expect(validate(SETTINGS_RPC.setContributorEnabled.input, input).issues?.[0]?.message).toBe("Invalid contributor or enabled choice.");
    }
  });

  it("takes no input to read the saved choices", () => {
    expect(validate(SETTINGS_RPC.getSettings.input, null).issues).toBeUndefined();
    expect(validate(SETTINGS_RPC.getSettings.input, undefined).issues).toBeUndefined();
    expect(validate(SETTINGS_RPC.getSettings.input, { a: 1 }).issues?.[0]?.message).toBe("Takes no input.");
  });

  it("preserves the server revision while sanitizing saved choices", () => {
    expect(validate(SETTINGS_RPC.getSettings.output, { twoLineTitles: true, ghost: 1, revision: 7 }).value)
      .toEqual({ twoLineTitles: true, revision: 7 });
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2"])("rejects an invalid snapshot revision %s", (revision) => {
    expect(validate(SETTINGS_RPC.getSettings.output, { twoLineTitles: true, revision }).issues?.[0]?.message)
      .toBe("Invalid settings snapshot.");
  });

  it("drops anything unknown or invalid from the saved set", () => {
    const output = validate(SETTINGS_RPC.getSettings.output, { twoLineTitles: true, motion: "no", ghost: 1, defaultDensity: "compact" });
    expect(output.value).toEqual({ twoLineTitles: true, defaultDensity: "compact", revision: 0 });
  });
});
