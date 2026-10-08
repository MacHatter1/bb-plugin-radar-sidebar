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
) {
  // The rail runs the full height beside the thread column; BB's footer
  // keeps its own bar underneath it. Only the rail's destination stack can
  // overflow, and only it gets a position indicator.
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const navRoot = rail.parentElement;
    const stack = rail.querySelector<HTMLElement>(".radar-double-rail-items");
    if (!stack) return;
    const updateScroll = () => {
      const overflowing = stack.scrollHeight > stack.clientHeight + 1;
      navRoot?.toggleAttribute("data-rail-overflow", overflowing);
      if (!overflowing) {
        rail.style.removeProperty("--radar-scroll-top");
        rail.style.removeProperty("--radar-scroll-height");
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
        rail.getBoundingClientRect().top +
        progress * (stack.clientHeight - height);
      rail.style.setProperty("--radar-scroll-top", `${top}px`);
      rail.style.setProperty("--radar-scroll-height", `${height}px`);
    };
    // Scroll fires many times a frame, and each update reads layout. The
    // thumb only needs the latest position, once per frame.
    let scrollFrame: number | null = null;
    const onScroll = () => {
      if (scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        updateScroll();
      });
    };
    updateScroll();
    stack.addEventListener("scroll", onScroll, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateScroll);
    observer?.observe(rail);
    observer?.observe(stack);
    return () => {
      observer?.disconnect();
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      stack.removeEventListener("scroll", onScroll);
      rail.style.removeProperty("--radar-scroll-top");
      rail.style.removeProperty("--radar-scroll-height");
      navRoot?.removeAttribute("data-rail-overflow");
    };
  }, [railRef, items, projectCount]);
}
