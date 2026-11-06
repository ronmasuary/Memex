import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessibility plumbing for an always-mounted dialog/drawer that animates between open and closed.
 *
 * While CLOSED the container is marked `inert`: aria-hidden and `pointer-events: none` hide it visually
 * and from the pointer, but neither removes its controls from the tab order — a keyboard user could still
 * Tab into the off-screen panel. `inert` does remove it (from focus and the accessibility tree).
 *
 * While OPEN, Tab is trapped inside the container and focus is moved in; on close, focus returns to
 * whatever held it when the dialog opened (usually the control that triggered it).
 *
 * Returns a ref to attach to the dialog container.
 */
export function useDialog<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.inert = !open;
    if (!open) return;

    restore.current = document.activeElement as HTMLElement | null;
    const focusables = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    // Move focus into the dialog (first focusable, else the container itself — it carries tabindex=-1).
    (focusables()[0] ?? el).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); el.focus(); return; }
      const first = items[0]!, last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !el.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("keydown", onKey);
      const back = restore.current;
      if (back && document.contains(back)) back.focus();
    };
  }, [open]);

  return ref;
}
