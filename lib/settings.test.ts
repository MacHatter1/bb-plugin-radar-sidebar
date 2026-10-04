import { describe, expect, it } from "vitest";
import {
  SETTINGS,
  SETTING_GROUPS,
  SETTING_HINTS,
  SETTING_REQUIRES,
  type SettingKey,
} from "./settings";

const keys = Object.keys(SETTINGS) as SettingKey[];

describe("settings definitions", () => {
  it("puts every setting in exactly one group", () => {
    const grouped = SETTING_GROUPS.flatMap((group) => [...group.keys]);
    expect([...grouped].sort()).toEqual([...keys].sort());
  });

  it("has a short hint for every setting", () => {
    for (const key of keys) expect(SETTING_HINTS[key].length).toBeGreaterThan(0);
  });

  it("only requires boolean settings, and ones that sit earlier in the same group", () => {
    for (const [key, requires] of Object.entries(SETTING_REQUIRES) as [SettingKey, SettingKey][]) {
      expect(SETTINGS[requires].type).toBe("boolean");
      const group = SETTING_GROUPS.find((candidate) => candidate.keys.includes(key))!;
      expect(group.keys.indexOf(requires)).toBeGreaterThanOrEqual(0);
      expect(group.keys.indexOf(requires)).toBeLessThan(group.keys.indexOf(key));
    }
  });
});
