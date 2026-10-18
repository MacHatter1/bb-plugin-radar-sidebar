import { describe, expect, it } from "vitest";
import {
  SETTINGS,
  SETTING_GROUPS,
  SETTING_HINTS,
  SETTING_REQUIRES,
  type SettingKey,
  DEFAULT_SETTINGS,
  isValidSettingValue,
  sanitizeSaved,
} from "./settings";

const keys = Object.keys(SETTINGS) as SettingKey[];

describe("settings definitions", () => {
  it("puts every scalar setting in exactly one group", () => {
    const grouped = SETTING_GROUPS.flatMap((group) => [...group.keys]);
    expect([...grouped].sort()).toEqual(keys.filter(key => SETTINGS[key].type === "boolean" || SETTINGS[key].type === "select").sort());
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

describe("contributor settings", () => {
  it("copies valid contributor preferences and rejects malformed maps", () => {
    const map = { teams: true, sibyl: false };
    const saved = sanitizeSaved({ disabledContributors: map });
    expect(saved.disabledContributors).toEqual(map);
    expect(saved.disabledContributors).not.toBe(map);
    for (const invalid of [null, [], { constructor: true }, { "teams/nav": true }, { teams: "yes" }, Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`p-${i}`, true]))]) {
      expect(isValidSettingValue("disabledContributors", invalid)).toBe(false);
    }
  });
});

describe("project pin settings", () => {
  it("defaults to no pins and copies saved project choices", () => {
    expect(DEFAULT_SETTINGS.pinnedProjects).toEqual({});
    const map = { proj_a: true, proj_b: false };
    const saved = sanitizeSaved({ pinnedProjects: map, twoLineTitles: true });
    expect(saved).toEqual({ pinnedProjects: map, twoLineTitles: true });
    expect(saved.pinnedProjects).not.toBe(map);
  });

  it.each([null, [], true, { "": true }, { constructor: true }, { proj_a: "yes" }, JSON.parse('{"__proto__":true}'), { ["x".repeat(129)]: true }])("rejects invalid project pins %j", (value) => {
    expect(isValidSettingValue("pinnedProjects", value)).toBe(false);
    expect(sanitizeSaved({ pinnedProjects: value, twoLineTitles: true })).toEqual({ twoLineTitles: true });
  });
});

describe("retired rail settings", () => {
  it("drops the rail's switches but keeps the stored project arrangement", () => {
    const pinnedProjects = { proj_a: true };
    expect(sanitizeSaved({
      railNav: true, wideRail: true, projectBadges: false, projectStyle: "Rings",
      railLiveStatus: { "dot/dot": "icon" }, pinnedProjects, twoLineTitles: true,
    })).toEqual({ pinnedProjects, twoLineTitles: true });
  });
});
