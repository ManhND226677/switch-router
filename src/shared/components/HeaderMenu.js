"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useTheme } from "@/shared/hooks/useTheme";
import { ConfirmModal } from "./Modal";

function MenuItem({ icon, label, onClick, trailing, danger }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
        danger
          ? "text-red-500 hover:bg-red-500/10"
          : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
      }`}
    >
      <span className={`material-symbols-outlined text-xl ${danger ? "" : "text-text-muted"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {trailing && <span className="text-base">{trailing}</span>}
    </button>
  );
}

MenuItem.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  trailing: PropTypes.node,
  danger: PropTypes.bool,
};

export default function HeaderMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const { toggleTheme, isDark } = useTheme();
  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  const focusItem = (index) => {
    const items = menuRef.current?.querySelectorAll('[role="menuitem"]');
    if (!items?.length) return;
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    items[clamped]?.focus();
  };

  const handleMenuKeyDown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const items = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || []);
    const current = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusItem(current + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(current - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(items.length - 1); }
  };

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/app/shutdown", { method: "POST" });
    } catch (e) {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShutdownOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const close = () => setIsOpen(false);

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && !isOpen) {
              e.preventDefault();
              setIsOpen(true);
              // Menu renders on the next tick — focus its first item then.
              requestAnimationFrame(() => focusItem(0));
            }
          }}
          className="flex items-center justify-center p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-all"
          title="Menu"
        >
          <span className="material-symbols-outlined">grid_view</span>
        </button>

        {isOpen && (
          <div
            role="menu"
            onKeyDown={handleMenuKeyDown}
            className="absolute right-0 top-full mt-2 w-60 bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 overflow-hidden py-1"
          >
            <MenuItem
              icon={isDark ? "light_mode" : "dark_mode"}
              label="Theme"
              onClick={() => { toggleTheme(); close(); }}
            />
            <MenuItem
              icon="power_settings_new"
              label="Shutdown"
              danger
              onClick={() => { close(); setShutdownOpen(true); }}
            />
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={shutdownOpen}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmText="Close"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />
    </>
  );
}

HeaderMenu.propTypes = {
};
