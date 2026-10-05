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
  it("puts every setting in exactly one group", () => {
    const grouped = SETTING_GROUPS.flatMap((group) => [...group.keys]);
    expect([...grouped].sort()).toEqual(keys.filter(key => SETTINGS[key].type !== "live-status-map").sort());
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

describe("rail live status settings", () => {
  it("defaults every item to Off with no saved choices", () => {
    expect(DEFAULT_SETTINGS.railLiveStatus).toEqual({});
  });

  it("parses and copies valid per-item choices alongside other settings", () => {
    const map = { "dot/dot": "icon", "alpha/beta": "badge", "gamma/nav": "off" };
    const saved = sanitizeSaved({ railNav: true, railLiveStatus: map, unknown: 42 });
    expect(saved).toEqual({ railNav: true, railLiveStatus: map });
    expect(saved.railLiveStatus).not.toBe(map);
  });

  it.each([null, [], "icon", true, { "dot/dot": "other" }, { "dot/dot": 1 }, { "": "icon" }, JSON.parse('{"__proto__":"icon"}'), { constructor: "badge" }])("rejects an invalid map %j", (value) => {
    expect(isValidSettingValue("railLiveStatus", value)).toBe(false);
    expect(sanitizeSaved({ railLiveStatus: value, railNav: true })).toEqual({ railNav: true });
  });
});
