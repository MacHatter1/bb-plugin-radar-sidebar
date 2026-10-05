import { describe, expect, it } from "vitest";
import { railHostCss } from "./railHostStyles";

const base = { wide: false, compact: false, scoped: false };

describe("railHostCss", () => {
  it("adds each state's rules only in that state, after the shared ones", () => {
    const narrow = railHostCss(base);
    expect(narrow).toContain("padding-inline-start: var(--radar-rail-width)");
    expect(narrow).not.toContain("--radar-rail-width: var(--radar-rail-wide)");
    expect(narrow).not.toContain(".radar-list-scope");
    expect(narrow).not.toContain("--radar-rail-mobile);");

    const wide = railHostCss({ ...base, wide: true });
    expect(wide).toContain("--radar-rail-width: var(--radar-rail-wide)");
    // A state's rules override the shared ones, so they must come later.
    expect(wide.indexOf("--radar-rail-width: var(--radar-rail-wide)"))
      .toBeGreaterThan(wide.indexOf("--radar-rail-width: var(--radar-rail-narrow)"));

    expect(railHostCss({ ...base, scoped: true })).toContain('[data-sidebar="sidebar"] .radar-list-scope { display: none; }');
    expect(railHostCss({ ...base, compact: true })).toContain("--radar-rail-width: var(--radar-rail-mobile)");
  });

  it("aligns BB's toggle from its own expanded state, not a copy of it", () => {
    expect(railHostCss(base)).toContain('div.group.peer[data-state="expanded"] ~ [data-testid="app-desktop-sidebar-trigger"]');
  });

  it("leaves BB's footer bar alone, offset only by the gutter", () => {
    expect(railHostCss(base)).not.toContain('[data-sidebar="footer"]');
  });
});
