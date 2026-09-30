import { useEffect, useRef, useState, type RefObject } from "react";
import {
  SWIPE_SLOP_PX,
  shouldCommitSwipe,
  swipeOffset,
  swipeThreshold,
  type SwipeActionView,
} from "@/lib/swipe";

/** Which way the finger travels: "right" reveals the underlay on the left. */
export type SwipeSide = "left" | "right";

/** Keep in step with the `data-swipe-phase` transitions in app.css. */
const SETTLE_MS = 420;
const OUT_MS = 240;
const FOLD_MS = 220;
/** A removed row that is still here after this was kept (confirm cancelled). */
const RESTORE_MS = 1200;
/** Only the last stretch of movement decides a flick. */
const VELOCITY_WINDOW_MS = 90;

type Phase = "drag" | "settle" | "out" | "fold" | "gone";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** The row's on-screen x offset, including partway through a transition. */
function currentOffset(row: HTMLElement): number {
  const transform = getComputedStyle(row).transform;
  if (!transform || transform === "none" || typeof DOMMatrixReadOnly === "undefined") {
    return 0;
  }
  const x = new DOMMatrixReadOnly(transform).m41;
  return Number.isFinite(x) ? x : 0;
}

/**
 * Touch swipe on a thread row. Movement is written straight to the row's
 * style so tracking never waits on React; the only state is which side's
 * underlay to show. Mouse and trackpad never start a swipe: they keep drag
 * to section and the hover actions.
 */
export function useRowSwipe({
  rowRef,
  enabled,
  right,
  left,
  restoreKey,
  onCommit,
}: {
  rowRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  /** Action for a rightward swipe, or null for none. */
  right: SwipeActionView | null;
  left: SwipeActionView | null;
  /** Changes when the thread's state does; brings back a row that was
   *  swiped away but stayed listed (for example, archived while shown). */
  restoreKey: string;
  onCommit: (action: SwipeActionView) => void;
}): SwipeSide | null {
  const [side, setSide] = useState<SwipeSide | null>(null);
  const latest = useRef({ right, left, onCommit });
  latest.current = { right, left, onCommit };
  const phaseRef = useRef<Phase | null>(null);
  const restoreRef = useRef<(() => void) | null>(null);
  const timers = useRef<number[]>([]);

  const later = (ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  };

  useEffect(() => {
    const row = rowRef.current;
    if (!row || !enabled) return;

    let tracking = false;
    let locked = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let width = 0;
    let offset = 0;
    let armed = false;
    let current: SwipeSide | null = null;
    let samples: { x: number; t: number }[] = [];
    let suppressClickUntil = 0;

    const setPhase = (phase: Phase | null) => {
      phaseRef.current = phase;
      if (phase) row.dataset.swipePhase = phase;
      else delete row.dataset.swipePhase;
    };

    const paint = (x: number, underlay: number) => {
      row.style.transform = x === 0 ? "" : `translate3d(${x}px, 0, 0)`;
      row.style.setProperty("--radar-swipe-w", `${Math.max(0, underlay)}px`);
    };

    const reset = () => {
      setPhase(null);
      paint(0, 0);
      row.style.removeProperty("--radar-swipe-w");
      delete row.dataset.swipeArmed;
      current = null;
      setSide(null);
    };

    const settle = () => {
      if (prefersReducedMotion()) {
        reset();
        return;
      }
      setPhase("settle");
      paint(0, 0);
      later(SETTLE_MS, () => {
        if (phaseRef.current === "settle") reset();
      });
    };

    const remove = (action: SwipeActionView, direction: number) => {
      const reduced = prefersReducedMotion();
      row.style.height = `${row.offsetHeight}px`;
      setPhase("out");
      paint(direction * (width + 16), width + 16);
      later(reduced ? 0 : OUT_MS, () => {
        setPhase("fold");
        row.style.height = "0px";
        later(reduced ? 0 : FOLD_MS, () => {
          setPhase("gone");
          latest.current.onCommit(action);
          later(RESTORE_MS, () => {
            if (phaseRef.current === "gone") restore();
          });
        });
      });
    };

    const onTouchStart = (event: TouchEvent) => {
      const phase = phaseRef.current;
      if (event.touches.length !== 1 || (phase && phase !== "settle")) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      tracking = true;
      locked = false;
      startX = touch.clientX;
      startY = touch.clientY;
      offset = 0;
      samples = [];
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!locked) {
        if (Math.abs(dx) < SWIPE_SLOP_PX && Math.abs(dy) < SWIPE_SLOP_PX) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          // A scroll: let the list have it.
          tracking = false;
          return;
        }
        locked = true;
        originX = touch.clientX;
        width = row.offsetWidth;
        armed = false;
        // Grab mid-settle from wherever the row is now.
        originX -= currentOffset(row);
        setPhase("drag");
      }
      if (event.cancelable) event.preventDefault();
      // Keep the host's own drawer gestures out of a row swipe.
      event.stopPropagation();

      const travel = touch.clientX - originX;
      const nextSide: SwipeSide | null =
        travel > 0 ? "right" : travel < 0 ? "left" : current;
      if (nextSide !== current) {
        current = nextSide;
        setSide(nextSide);
      }
      const action = current === "right"
        ? latest.current.right
        : current === "left"
          ? latest.current.left
          : null;
      offset = swipeOffset(travel, width, !!action);
      paint(offset, action ? Math.abs(offset) : 0);

      const nextArmed = !!action && Math.abs(offset) >= swipeThreshold(width);
      if (nextArmed !== armed) {
        armed = nextArmed;
        if (armed) {
          row.dataset.swipeArmed = "";
          navigator.vibrate?.(8);
        } else {
          delete row.dataset.swipeArmed;
        }
      }

      const now = performance.now();
      samples.push({ x: touch.clientX, t: now });
      while (samples.length > 2 && now - samples[0].t > VELOCITY_WINDOW_MS) {
        samples.shift();
      }
    };

    const onTouchEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!locked) return;
      locked = false;
      suppressClickUntil = performance.now() + 400;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const velocity =
        first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
      const action = offset > 0
        ? latest.current.right
        : offset < 0
          ? latest.current.left
          : null;
      if (action && shouldCommitSwipe(offset, velocity, swipeThreshold(width))) {
        row.dataset.swipeArmed = "";
        if (action.removes) {
          remove(action, Math.sign(offset));
          return;
        }
        latest.current.onCommit(action);
      }
      settle();
    };

    const onTouchCancel = () => {
      if (!tracking) return;
      tracking = false;
      if (!locked) return;
      locked = false;
      settle();
    };

    // The finger lifting off a swiped row must not also open the thread.
    const onClickCapture = (event: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const restore = () => {
      row.style.height = "";
      if (prefersReducedMotion()) {
        reset();
        return;
      }
      settle();
    };
    restoreRef.current = restore;

    row.addEventListener("touchstart", onTouchStart, { passive: true });
    row.addEventListener("touchmove", onTouchMove, { passive: false });
    row.addEventListener("touchend", onTouchEnd);
    row.addEventListener("touchcancel", onTouchCancel);
    row.addEventListener("click", onClickCapture, true);
    return () => {
      row.removeEventListener("touchstart", onTouchStart);
      row.removeEventListener("touchmove", onTouchMove);
      row.removeEventListener("touchend", onTouchEnd);
      row.removeEventListener("touchcancel", onTouchCancel);
      row.removeEventListener("click", onClickCapture, true);
      restoreRef.current = null;
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
      row.style.height = "";
      reset();
    };
    // `later` only touches refs; the row element is stable for the row's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rowRef]);

  useEffect(() => {
    if (phaseRef.current === "gone") restoreRef.current?.();
  }, [restoreKey]);

  return side;
}
