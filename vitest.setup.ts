// Node 26 exposes an undefined native localStorage without a backing file.
// Use the test window's browser storage, as on Node versions without that API.
// Vitest aliases window to globalThis, so read its original jsdom window.
const { jsdom } = globalThis as unknown as { jsdom: { window: Window } };
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: jsdom.window.localStorage,
});
