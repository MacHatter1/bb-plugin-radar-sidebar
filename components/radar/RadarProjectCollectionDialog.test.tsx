import { createRef } from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadarProjectCollectionDialog, type CollectionDialogTarget } from "./RadarProjectCollectionDialog";
import { EMPTY_PROJECT_ORGANISATION } from "@/lib/projectOrganisation";
import type { NativeModalSdk } from "./nativeBrowserModal";

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-collection-dialog-fixture]").forEach(node => node.remove());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("collection dialog centering", () => {
  it.each([
    [1200, { kind: "move", projectId: "p" }],
    [260, { kind: "move", projectId: "p" }],
    [1200, { kind: "rename", collectionId: "work" }],
    [260, { kind: "rename", collectionId: "work" }],
  ] satisfies [number, CollectionDialogTarget][])("centers the modal in a %ipx viewport (%j)", (viewport, target) => {
    vi.stubGlobal("innerWidth", viewport);
    const style = document.createElement("style");
    const css = readFileSync(`${process.cwd()}/app.css`, "utf8");
    style.dataset.collectionDialogFixture = "";
    // Resolve min()/vw here because jsdom cannot lay out viewport units.
    style.textContent = css.match(/\.radar-collection-dialog \{[^}]+\}/)![0]
      .replace(/width: min\((\d+)px, calc\(100vw - (\d+)px\)\);/, (_, max, margin) => `width: ${Math.min(Number(max), viewport - Number(margin))}px;`);
    document.head.append(style);
    renderSlot({ component: RadarProjectCollectionDialog }, { target, organisation: EMPTY_PROJECT_ORGANISATION, save: async () => true, onClose: () => {}, triggerRef: createRef<HTMLElement>() });
    const dialog = screen.getByRole("dialog");
    const computed = getComputedStyle(dialog);
    const width = parseFloat(computed.width);
    const left = computed.left.endsWith("%") ? parseFloat(computed.left) / 100 * viewport : parseFloat(computed.left);
    const x = left - (computed.transform.includes("-50%,") ? width / 2 : 0);
    expect(x + width / 2).toBe(viewport / 2);
    expect(x).toBeGreaterThanOrEqual(16);
    expect(computed.top).toBe("50%");
    expect(computed.transform).toBe("translate(-50%, -50%)");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });
});

describe("collection dialog desktop integration", () => {
  it("waits for browser discovery before opening and restores the visible pane on close", async () => {
    const setVisibleWithoutFocus = vi.fn();
    vi.stubGlobal("bbDesktop", { browser: {
      getTarget: async () => ({ hostId: "local", instanceId: "window", generation: "g1" }),
      setVisibleWithoutFocus,
    } });
    type Tabs = Awaited<ReturnType<NativeModalSdk["experimental_desktopBrowsers"]["listTabs"]>>;
    let resolve!: (result: Tabs) => void;
    const listTabs = vi.fn(() => new Promise<Tabs>(done => { resolve = done; }));
    const slot = renderSlot({ component: RadarProjectCollectionDialog }, {
      target: { kind: "move", projectId: "p" }, organisation: EMPTY_PROJECT_ORGANISATION,
      save: async () => true, onClose: () => {}, triggerRef: createRef<HTMLElement>(),
    }, { context: { threadId: "thread" }, sdk: { experimental_desktopBrowsers: { listTabs } } });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(listTabs).toHaveBeenCalledOnce());
    await act(async () => resolve({ tabs: [
      { tabId: "visible", threadId: "thread", presentation: "reveal", url: "https://example.com", title: "Example", profile: { kind: "personal" }, control: null },
      { tabId: "inactive", threadId: "thread", presentation: "hidden", url: "https://example.com", title: "Example", profile: { kind: "personal" }, control: null },
    ] }));
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(setVisibleWithoutFocus.mock.calls).toEqual([[{ tabId: "visible", visible: false }]]);
    slot.unmount();
    expect(setVisibleWithoutFocus.mock.calls).toEqual([[{ tabId: "visible", visible: false }], [{ tabId: "visible", visible: true }]]);
  });

  it("opens normally in the web app without querying native browser tabs", () => {
    const listTabs = vi.fn();
    renderSlot({ component: RadarProjectCollectionDialog }, {
      target: { kind: "move", projectId: "p" }, organisation: EMPTY_PROJECT_ORGANISATION,
      save: async () => true, onClose: () => {}, triggerRef: createRef<HTMLElement>(),
    }, { context: { threadId: "thread" }, sdk: { experimental_desktopBrowsers: { listTabs } } });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(listTabs).not.toHaveBeenCalled();
  });
});
