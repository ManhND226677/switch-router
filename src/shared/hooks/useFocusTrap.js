"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Stack các overlay đang mở, để Escape chỉ đóng overlay trên cùng
 * (modal mở lồng nhau: phải đóng cái trong cùng trước).
 */
const trapStack = [];

/**
 * Traps keyboard focus inside an overlay while it is open.
 *
 * - Moves focus into the panel on open (first focusable, or the panel itself)
 * - Cycles Tab / Shift+Tab so focus cannot escape to the page behind
 * - Calls onClose on Escape — chỉ overlay trên cùng phản ứng (nhờ trapStack),
 *   nên modal mở lồng nhau đóng từ trong ra ngoài
 * - Restores focus to the element that was focused before opening
 *
 * @param {boolean} isOpen  whether the overlay is currently mounted/visible
 * @param {Function} onClose callback invoked when Escape is pressed
 * @returns {import("react").RefObject<HTMLElement>} ref to attach to the panel
 */
export default function useFocusTrap(isOpen, onClose) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const restoreRef = useRef(null);

  // Keep the latest onClose without making it an effect dependency: most callers
  // pass a fresh arrow function on every render, which would tear down and
  // re-create the trap (and steal focus back) on each render.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return undefined;

    restoreRef.current =
      typeof document !== "undefined" ? document.activeElement : null;

    const node = panelRef.current;
    if (!node) return undefined;

    const focusableItems = () =>
      Array.from(node.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetWidth || el.offsetHeight || el.getClientRects().length
      );

    const initial = focusableItems()[0] || node;
    initial.focus({ preventScroll: true });

    trapStack.push(node);

    const handleKeyDown = (event) => {
      // Chỉ overlay trên cùng mới phản ứng với phím
      if (trapStack[trapStack.length - 1] !== node) return;

      if (event.key === "Escape") {
        onCloseRef.current?.();
        return;
      }

      if (event.key !== "Tab") return;

      const items = focusableItems();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];

      // Focus bị rơi ra ngoài overlay (click vào vùng không focus được) -> kéo lại vào
      if (!node.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Nghe trên document (không phải panel): nếu focus bị rơi ra ngoài panel,
    // Escape và Tab vẫn phải được xử lý — WCAG 2.1.2 / 2.4.3.
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const idx = trapStack.indexOf(node);
      if (idx !== -1) trapStack.splice(idx, 1);

      const previous = restoreRef.current;
      if (previous && typeof previous.focus === "function") {
        previous.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  return panelRef;
}
