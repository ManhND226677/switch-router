"use client";

import { useEffect, useId } from "react";
import { cn } from "@/shared/utils/cn";
import useFocusTrap from "@/shared/hooks/useFocusTrap";
import Button from "./Button";
import Tooltip from "./Tooltip";

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnOverlay = true,
  showTrafficLights = true,
  className,
}) {
  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-4xl",
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  // Focus trap + Escape + trả focus về trigger khi đóng.
  // Escape do useFocusTrap xử lý (có stopPropagation để modal lồng nhau không đóng đồng loạt).
  const panelRef = useFocusTrap(isOpen, onClose);
  const titleId = useId();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] fade-in"
        onClick={closeOnOverlay ? onClose : undefined}
      />

      {/* Modal content */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          "relative w-full bg-surface",
          "border border-border-subtle",
          "rounded-[14px] shadow-[var(--shadow-elev)]",
          "fade-in",
          "focus:outline-none",
          sizes[size],
          className
        )}
      >
        {/* Header — padding đồng nhất với body/footer (px-6) */}
        {(title || showTrafficLights) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
            <div className="flex items-center">
              {/* Traffic lights — desktop only */}
              {showTrafficLights && (
                <div className="hidden md:flex items-center gap-2 mr-4">
                  <Tooltip text="Close" position="top" color="#FF5F56">
                    <button
                      onClick={onClose}
                      aria-label="Close"
                      title="Close"
                      className="w-4 h-4 rounded-full bg-[#FF5F56] hover:brightness-90 transition-all cursor-pointer flex items-center justify-center group/dot"
                    >
                      <span className="text-xs font-bold text-white opacity-0 group-hover/dot:opacity-100 transition-opacity leading-none">✕</span>
                    </button>
                  </Tooltip>
                  <div className="w-4 h-4 rounded-full bg-[#3a3a3a]/20 dark:bg-white/15 cursor-not-allowed" />
                  <div className="w-4 h-4 rounded-full bg-[#3a3a3a]/20 dark:bg-white/15 cursor-not-allowed" />
                </div>
              )}
              {title && (
                <h2 id={titleId} className="text-lg font-semibold text-text-main">
                  {title}
                </h2>
              )}
            </div>
            {/* X button — mobile only */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="md:hidden p-1.5 rounded-[10px] text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
        )}

        {/* Body */}
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  loading = false,
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-text-muted">{message}</p>
    </Modal>
  );
}
