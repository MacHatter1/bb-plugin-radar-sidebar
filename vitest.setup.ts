import { afterEach, vi } from "vitest";

// Node 26 exposes an undefined native localStorage without a backing file.
// Use the test window's browser storage, as on Node versions without that API.
// Vitest aliases window to globalThis, so read its original jsdom window.
// Test files that opt out of jsdom have no such window and keep their own.
const { jsdom } = globalThis as unknown as { jsdom?: { window: Window } };
if (jsdom) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: jsdom.window.localStorage,
  });
}

// Plugin settings reach components through a store the server feeds. Tests
// still describe them with renderSlot's `settings` option; this carries those
// values into the store before each render, and clears it between tests.
vi.mock("@get-bb/plugin-sdk/testing/app", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@get-bb/plugin-sdk/testing/app")>();
  const { seedSettings } = await import("./components/radar/settingsStore");
  const renderSlot = ((slot, props, options) => {
    if (options?.settings) seedSettings(options.settings);
    return actual.renderSlot(slot, props, options);
  }) as typeof actual.renderSlot;
  return { ...actual, renderSlot };
});
afterEach(async () => {
  (await import("./components/radar/settingsStore")).resetSettings();
});
