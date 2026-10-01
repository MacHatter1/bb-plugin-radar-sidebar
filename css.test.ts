import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guards over app.css.
 *
 * jsdom does not resolve the real cascade, so these assert on the stylesheet
 * text for classes of bug that are invisible to a render test.
 */
// The test sits beside app.css at the package root.
const css = readFileSync(
  resolve(import.meta.dirname ?? ".", "app.css"),
  "utf8",
);

/** Every `selector { body }` block, with comments stripped. */
function rules(): { selector: string; body: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    body,
  }));
}

describe("app.css", () => {
  it("lets a swiped-away row fold shut whatever its density", () => {
    // The compact and two-line rules set a min-height at the same specificity
    // and come later in the file, so only !important lets the fold win.
    const fold = rules().find((rule) =>
      rule.selector.includes('.radar-row[data-swipe-phase="fold"]'),
    );
    expect(fold?.body).toMatch(/min-height:\s*0\s*!important/);
    // The wait in useRowSwipe is the one place the duration is set.
    expect(fold?.body).toMatch(/height var\(--radar-swipe-fold,/);
  });

  it("keeps metadata and the owned title transparent to one-line layout", () => {
    for (const selector of [".radar-row-meta", ".radar-thread-title"]) {
      expect(rules().find((rule) => rule.selector === selector)?.body)
        .toMatch(/display:\s*contents/);
    }
  });

  it("clamps the whole title instead of the last SDK segment", () => {
    const title = rules().find((rule) =>
      rule.selector === ".radar-title-wrap .radar-thread-title",
    );
    expect(title?.body).toMatch(/-webkit-line-clamp:\s*2/);
    expect(title?.body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rules().filter((rule) => /radar-title-wrap/.test(rule.selector) && /-webkit-line-clamp/.test(rule.body))
      .map((rule) => rule.selector)).toEqual([".radar-title-wrap .radar-thread-title"]);
  });

  it("sizes wrapping titles from content and declares wrapping metadata once", () => {
    expect(rules().find((rule) => rule.selector === ".radar-title-wrap .radar-row-title-text")?.body)
      .toMatch(/flex:\s*1 1 auto/);
    expect(rules().filter((rule) => rule.selector === ".radar-title-wrap .radar-row-meta"))
      .toHaveLength(1);
  });

  it("lifts two-line hover actions clear of the branch line and never hides them", () => {
    // The bar sits at the row's bottom in two-line mode. Unlifted, it lands
    // on the branch line and takes clicks meant for the PR badge. Hiding
    // actions per row is out too: under project grouping no row has a chip,
    // so that emptied the bar list-wide.
    const wrap = rules().filter((rule) => /radar-title-wrap/.test(rule.selector));
    expect(wrap.find((rule) => /:has\(\.radar-branch-line\)/.test(rule.selector))?.body)
      .toMatch(/--radar-actions-lift:\s*[1-9]\d*px/);
    expect(wrap.find((rule) => /\.radar-row-actions$/.test(rule.selector) && /bottom:/.test(rule.body))?.body)
      .toMatch(/var\(--radar-actions-lift\)/);
    expect(wrap
      .filter((rule) => /\.radar-action\b/.test(rule.selector) && /display:\s*none/.test(rule.body))
      .map((rule) => rule.selector)).toEqual([]);
    expect(rules().filter((rule) => /radar-title-wrap.*:hover/.test(rule.selector)))
      .toEqual([]);
  });

  it("estimates unrendered two-line rows taller than one-line rows", () => {
    const estimate = (selector: RegExp) => Number(
      rules()
        .find((rule) => selector.test(rule.selector) && /contain-intrinsic-size/.test(rule.body))
        ?.body.match(/contain-intrinsic-size:\s*auto\s+(\d+)px/)?.[1],
    );
    expect(estimate(/^\.radar-title-wrap \.radar-row$/))
      .toBeGreaterThan(estimate(/^\.radar-row$/));
    expect(estimate(/^\.radar-title-wrap\.radar-density-compact \.radar-row,/))
      .toBeGreaterThan(estimate(/^\.radar-density-compact \.radar-row,/));
  });

  it("never resets the row margin with the shorthand", () => {
    // `margin: 0` also zeroes margin-left, which silently wipes the child
    // thread indent that .radar-row-child / .radar-row-deep own.
    const offenders = rules()
      .filter((rule) => /\.radar-row\b/.test(rule.selector))
      .filter((rule) => /(^|[;{\s])margin:\s*0\s*[;]?\s*$/.test(rule.body));

    expect(offenders.map((rule) => rule.selector)).toEqual([]);
  });

  it("keeps the child indent defined", () => {
    const child = rules().find((rule) => rule.selector === ".radar-row-child");
    const deep = rules().find((rule) => rule.selector === ".radar-row-deep");
    expect(child?.body).toMatch(/margin-left:\s*16px/);
    expect(deep?.body).toMatch(/margin-left:\s*28px/);
  });

  it("keeps compact inline padding identical to comfortable", () => {
    // Compact must compress vertically only, or the tree guides drift off
    // the text they belong to.
    const main = rules().find((rule) =>
      /\.radar-density-compact \.radar-row-main/.test(rule.selector),
    );
    expect(main?.body).toMatch(/padding:\s*\d+px 8px/);
  });

  it("lays the touch nav out as a row of icons, not a centered column", () => {
    // Touch viewports keep a sidebar wide enough for a row of icons, so one
    // icon per line pushed the thread list half a screen down.
    const compact = rules().find((rule) => rule.selector === ".radar-nav-compact");
    expect(compact?.body).toMatch(/display:\s*grid/);
    expect(compact?.body).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(32px,\s*1fr\)\)/);
    expect(compact?.body).toMatch(/justify-items:\s*center/);
    expect(compact?.body).not.toMatch(/align-items:\s*center/);
  });

  it("declares each row-affecting selector at most once", () => {
    const seen = new Map<string, number>();
    for (const rule of rules()) {
      if (!/\.radar-row-main|\.radar-row-extra/.test(rule.selector)) continue;
      seen.set(rule.selector, (seen.get(rule.selector) ?? 0) + 1);
    }
    const duplicated = [...seen].filter(([, count]) => count > 1);
    // A later duplicate silently wins by source order — that is how the
    // padding regression came back during this fix.
    expect(duplicated.map(([selector]) => selector)).toEqual([]);
  });
});
