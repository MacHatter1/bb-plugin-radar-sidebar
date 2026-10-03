import { useLayoutEffect, useState, type RefObject } from "react";
import type { ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";

/** Only the optional rail couples to the host shell; effects release on unmount. */
export function useRailHostStructure(railRef: RefObject<HTMLElement | null>) {
  const [hostSupportsWide, setHostSupportsWide] = useState(false);
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const sidebar = rail.closest('[data-sidebar="sidebar"]');
    const panel = sidebar?.parentElement;
    setHostSupportsWide(
      Boolean(
        sidebar &&
          sidebar.querySelector(':scope > [data-sidebar="footer"]') &&
          panel?.parentElement?.classList.contains("peer") &&
          getComputedStyle(panel).getPropertyValue("--sidebar-width").trim() !==
            "",
      ),
    );
  }, []);
  return hostSupportsWide;
}

export function useRailMeasurements(
  railRef: RefObject<HTMLElement | null>,
  items: readonly ExperimentalSidebarNavigationItem[],
  projectCount: number,
  wide: boolean,
) {
  // The rail and BB's footer share one column. Publish how much height the
  // rail needs (every destination plus its own footer, unscrolled) so the
  // stylesheet can cap the host footer's stack instead; otherwise a tall
  // footer scrolls the primary destinations out of view on short windows.
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const root = document.documentElement;
    const navRoot = rail.parentElement;
    const hostMenu = rail
      .closest('[data-sidebar="sidebar"]')
      ?.querySelector<HTMLElement>(
        ':scope > [data-sidebar="footer"] > [data-sidebar="menu"]',
      );
    const items = rail.querySelector<HTMLElement>(".radar-double-rail-items");
    const footer = rail.querySelector<HTMLElement>(".radar-double-rail-footer");
    const hostFooter = hostMenu?.parentElement;
    if (!items || !footer) return;
    const updateThumb = (
      stack: HTMLElement,
      owner: HTMLElement,
      flag: string,
    ) => {
      const overflow = stack.scrollHeight > stack.clientHeight + 1;
      navRoot?.toggleAttribute(flag, overflow);
      if (!overflow) {
        owner.style.removeProperty("--radar-scroll-top");
        owner.style.removeProperty("--radar-scroll-height");
        return;
      }
      const height = Math.min(
        stack.clientHeight,
        Math.max(18, stack.clientHeight ** 2 / stack.scrollHeight),
      );
      const progress = Math.min(
        1,
        Math.max(
          0,
          stack.scrollTop / (stack.scrollHeight - stack.clientHeight),
        ),
      );
      const top =
        stack.getBoundingClientRect().top -
        owner.getBoundingClientRect().top +
        progress * (stack.clientHeight - height);
      owner.style.setProperty("--radar-scroll-top", `${top}px`);
      owner.style.setProperty("--radar-scroll-height", `${height}px`);
    };
    const updateScroll = () => {
      updateThumb(items, rail, "data-rail-overflow");
      if (hostMenu && hostFooter)
        updateThumb(hostMenu, hostFooter, "data-footer-overflow");
    };
    const measure = () => {
      const styles = getComputedStyle(rail);
      const chrome =
        parseFloat(styles.paddingTop) +
        parseFloat(styles.paddingBottom) +
        parseFloat(styles.rowGap || styles.gap || "0");
      root.style.setProperty(
        "--radar-rail-reserve",
        `${Math.ceil(items.scrollHeight + footer.offsetHeight + chrome)}px`,
      );
      updateScroll();
    };
    measure();
    items.addEventListener("scroll", updateScroll, { passive: true });
    hostMenu?.addEventListener("scroll", updateScroll, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(rail);
    observer?.observe(items);
    observer?.observe(footer);
    if (hostMenu) observer?.observe(hostMenu);
    // Host actions can change inside a capped stack without resizing it.
    const mutations = new MutationObserver(measure);
    if (hostMenu)
      mutations.observe(hostMenu, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      items.removeEventListener("scroll", updateScroll);
      hostMenu?.removeEventListener("scroll", updateScroll);
      root.style.removeProperty("--radar-rail-reserve");
      for (const owner of [rail, hostFooter]) {
        owner?.style.removeProperty("--radar-scroll-top");
        owner?.style.removeProperty("--radar-scroll-height");
      }
      navRoot?.removeAttribute("data-rail-overflow");
      navRoot?.removeAttribute("data-footer-overflow");
    };
  }, [wide, items, projectCount]);
}
