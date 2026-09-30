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

  it("keeps desktop hover actions out of row layout and off title lines", () => {
    const actions = rules().find((rule) =>
      rule.selector === ".radar-title-wrap:not(.radar-list-compact) .radar-row-actions",
    );
    expect(actions?.body).toMatch(/top:\s*auto/);
    expect(actions?.body).toMatch(/bottom:\s*2px/);
    expect(actions?.body).not.toMatch(/position:\s*static/);
    expect(rules().filter((rule) => /radar-title-wrap.*:hover/.test(rule.selector)))
      .toEqual([]);
  });

  it("gives unrendered two-line rows taller estimates in both densities", () => {
    const estimates = rules().filter((rule) =>
      /radar-title-wrap/.test(rule.selector) && /contain-intrinsic-size/.test(rule.body),
    );
    expect(estimates).toHaveLength(2);
    expect(estimates[0]?.body).toMatch(/auto\s+76px/);
    expect(estimates[1]?.body).toMatch(/auto\s+52px/);
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
