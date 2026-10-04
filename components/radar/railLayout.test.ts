import { describe, expect, it } from "vitest";
import { railReserve } from "./railLayout";

describe("railReserve", () => {
  it("gives the host footer its content and leaves the destination list a floor", () => {
    // Shell 900, list wants 700, footer content 280. List keeps 200,
    // so the footer is allowed its 280 rather than the two-control floor.
    expect(railReserve(900, 700, 40, 58, 280)).toBe(900 - 280 - 20);
  });

  it("keeps the full list reserve when the shell cannot be measured", () => {
    expect(railReserve(0, 700, 40, 58, 280)).toBe(798);
  });
});
