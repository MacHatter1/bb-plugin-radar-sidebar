import { useEffect, useRef, useState, type RefObject } from "react";
import {
  SPRING_BACK,
  SPRING_OUT,
  SWIPE_SLOP_PX,
  shouldCommitSwipe,
  springAtRest,
  stepSpring,
  swipeOffset,
  swipeThreshold,
  type SwipeActionView,
} from "@/lib/swipe";

/** Which way the finger travels: "right" reveals the underlay on the left. */
export type SwipeSide = "left" | "right";

/** What the underlay shows. Latched when the swipe starts, so a committed
 *  toggle keeps its label while the row springs home. */
export interface SwipeReveal {
  side: SwipeSide;
  action: SwipeActionView | null;
}

/** Keep in step with the fold transition in app.css. */
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

/**
 * Touch swipe on a thread row. Movement is written straight to the row's
 * style, and release runs a spring on animation frames that starts at the
 * finger's speed, so nothing waits on React and a flick flows into the
 * settle. Mouse and trackpad never start a swipe: they keep drag to section
 * and the hover actions.
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
}): SwipeReveal | null {
  const [reveal, setReveal] = useState<SwipeReveal | null>(null);
  const latest = useRef({ right, left, onCommit });
  latest.current = { right, left, onCommit };
  const phaseRef = useRef<Phase | null>(null);
  const restoreRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || !enabled) return;

    let tracking = false;
    let locked = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let width = 0;
    let threshold = 64;
    /** Where the row is drawn now, and which side's pill is showing. */
    let x = 0;
    let side: SwipeSide | null = null;
    let action: SwipeActionView | null = null;
    let armed = false;
    let samples: { x: number; t: number }[] = [];
    let suppressClickUntil = 0;
    let frame: number | null = null;
    let timer: number | null = null;

    const setPhase = (phase: Phase | null) => {
      phaseRef.current = phase;
      if (phase) row.dataset.swipePhase = phase;
      else delete row.dataset.swipePhase;
    };

    const setArmed = (next: boolean) => {
      if (next === armed) return;
      armed = next;
      if (armed) row.dataset.swipeArmed = "";
      else delete row.dataset.swipeArmed;
    };

    /** The pill fills exactly the gap the row leaves on the revealed side. */
    const paint = (next: number) => {
      x = next;
      row.style.transform = x === 0 ? "" : `translate3d(${x}px, 0, 0)`;
      const sign = side === "right" ? 1 : side === "left" ? -1 : 0;
      const gap = action ? Math.max(0, x * sign) : 0;
      row.style.setProperty("--radar-swipe-w", `${gap}px`);
      row.style.setProperty(
        "--radar-swipe-p",
        `${Math.min(1, gap / threshold).toFixed(3)}`,
      );
    };

    const stopMotion = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      frame = null;
      timer = null;
    };

    const reset = () => {
      stopMotion();
      setPhase(null);
      side = null;
      action = null;
      paint(0);
      row.style.removeProperty("--radar-swipe-w");
      row.style.removeProperty("--radar-swipe-p");
      row.style.height = "";
      setArmed(false);
      setReveal(null);
    };

    /** Spring from here toward `target`, starting at `velocity` px/ms. */
    const springTo = (
      target: number,
      velocity: number,
      spring: { stiffness: number; damping: number },
      done: () => void,
      clamp = false,
    ) => {
      stopMotion();
      if (prefersReducedMotion()) {
        paint(target);
        done();
        return;
      }
      let v = velocity;
      // Frame timestamps mark the frame's start, which can predate a
      // performance.now() read taken just before: time from the first frame.
      let last: number | null = null;
      const tick = (now: number) => {
        const dt = last === null ? 1000 / 60 : Math.max(0, now - last);
        const next = stepSpring(x, v, target, dt, spring);
        last = now;
        v = next.velocity;
        // A slide-out stops at the edge rather than bouncing back into view.
        const pos = clamp && Math.sign(next.x - target) === Math.sign(target)
          ? target
          : next.x;
        paint(pos);
        if (pos === target || springAtRest(pos, v, target)) {
          paint(target);
          frame = null;
          done();
          return;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    const settle = (velocity: number) => {
      setPhase("settle");
      springTo(0, velocity, SPRING_BACK, reset);
    };

    const remove = (committed: SwipeActionView, velocity: number) => {
      row.style.height = `${row.offsetHeight}px`;
      setPhase("out");
      const target = Math.sign(x) * (width + 16);
      // At least a brisk push outward, so a slow drag past the line still
      // leaves decisively.
      const push = Math.sign(x) * Math.max(Math.abs(velocity), 1.2);
      springTo(target, push, SPRING_OUT, () => {
        setPhase("fold");
        row.style.height = "0px";
        timer = window.setTimeout(() => {
          setPhase("gone");
          latest.current.onCommit(committed);
          timer = window.setTimeout(() => {
            if (phaseRef.current === "gone") restore();
          }, RESTORE_MS);
        }, prefersReducedMotion() ? 0 : FOLD_MS);
      }, true);
    };

    const restore = () => {
      row.style.height = "";
      setPhase("settle");
      springTo(0, 0, SPRING_BACK, reset);
    };
    restoreRef.current = restore;

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
        // Catch a settling row wherever it is, without a jump.
        stopMotion();
        originX = touch.clientX - x;
        width = row.offsetWidth;
        threshold = swipeThreshold(width);
        samples = [];
        setPhase("drag");
      }
      if (event.cancelable) event.preventDefault();
      // Keep the host's own drawer gestures out of a row swipe.
      event.stopPropagation();

      const travel = touch.clientX - originX;
      const nextSide: SwipeSide | null =
        travel > 0 ? "right" : travel < 0 ? "left" : side;
      if (nextSide !== side) {
        side = nextSide;
        action = side === "right"
          ? latest.current.right
          : side === "left"
            ? latest.current.left
            : null;
        setArmed(false);
        setReveal(side ? { side, action } : null);
      }
      paint(swipeOffset(travel, width, !!action));

      const nextArmed = !!action && Math.abs(x) >= threshold;
      if (nextArmed && !armed) navigator.vibrate?.(8);
      setArmed(nextArmed);

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
      // Movement that ended before a pause is not a flick: a finger resting
      // before the lift carries no speed into the release.
      const moving = !!last && performance.now() - last.t <= VELOCITY_WINDOW_MS;
      const velocity =
        moving && first && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
      if (action && shouldCommitSwipe(x, velocity, threshold)) {
        setArmed(true);
        if (action.removes) {
          remove(action, velocity);
          return;
        }
        latest.current.onCommit(action);
      }
      settle(velocity);
    };

    const onTouchCancel = () => {
      if (!tracking) return;
      tracking = false;
      if (!locked) return;
      locked = false;
      settle(0);
    };

    // The finger lifting off a swiped row must not also open the thread.
    const onClickCapture = (event: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

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
      reset();
    };
  }, [enabled, rowRef]);

  useEffect(() => {
    if (phaseRef.current === "gone") restoreRef.current?.();
  }, [restoreKey]);

  return reveal;
}
