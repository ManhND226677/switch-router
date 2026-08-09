"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const providerModelItems = [
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" },
  { href: "/dashboard/combos", label: "Combos", icon: "layers" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

const observabilityItems = [
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal", debug: true },
  { href: "/dashboard/translator", label: "Translator", icon: "translate", debug: true },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
];

function NavLink({ item, active, onClose, isMini }) {
  return (
    <Link
      href={item.href}
      onClick={onClose}
      className={cn(
        "flex items-center gap-3 py-1 rounded-lg transition-all group",
        isMini ? "justify-center px-0 mx-2" : "px-3",
        active
          ? "bg-primary/10 text-primary"
          : "text-text-muted hover:bg-surface-2 hover:text-text-main"
      )}
      title={isMini ? item.label : undefined}
    >
      <span
        className={cn(
          "material-symbols-outlined text-lg",
          active ? "fill-1" : "group-hover:text-primary transition-colors"
        )}
      >
        {item.icon}
      </span>
      {!isMini && <span className="text-sm font-medium">{item.label}</span>}
    </Link>
  );
}

function NavSection({ title, children, isMini }) {
  return (
    <div className="space-y-0.5">
      {title && !isMini ? (
        <p className="px-4 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-2 mt-3">
          {title}
        </p>
      ) : isMini ? (
         <div className="h-4" /> // spacer for mini sidebar
      ) : null}
      {children}
    </div>
  );
}

export default function Sidebar({ onClose, isMini = false }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const [enableDebug, setEnableDebug] = useState(true);

  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => {
        if (data.enableTranslator) setEnableTranslator(true);
        if (data.enableDebug === false) setEnableDebug(false);
      })
      .catch(() => {});
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      <aside className={cn("flex flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl transition-all duration-300 min-h-full", isMini ? "w-20" : "w-72")}>
        {/* Traffic lights */}
        <div className={cn("flex items-center gap-2 pt-5 pb-2", isMini ? "justify-center px-0" : "px-6")}>
          {!isMini && (
            <>
              <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
              <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
              <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
            </>
          )}
          {isMini && <div className="w-3 h-3 rounded-full bg-[#27C93F]" />}
        </div>

        {/* Logo */}
        <div className={cn("py-4 flex flex-col gap-2", isMini ? "px-2 items-center" : "px-6")}>
          <Link href="/dashboard" className={cn("flex items-center", isMini ? "justify-center" : "gap-3")}>
            <div className="flex items-center justify-center size-9 shrink-0 rounded-[10px] bg-gradient-to-br from-brand-500 to-brand-700 shadow-[var(--shadow-warm)]">
              <span className="material-symbols-outlined text-white text-xl">hub</span>
            </div>
            {!isMini && (
              <div className="flex flex-col">
                <h1 className="text-lg font-semibold tracking-tight text-text-main">
                  {APP_CONFIG.name}
                </h1>
                <span className="text-xs text-text-muted">v{APP_CONFIG.version}</span>
              </div>
            )}
          </Link>
        </div>

        {/* Navigation */}
        <nav className={cn("flex-1 py-2 space-y-2 overflow-y-auto custom-scrollbar", isMini ? "px-2" : "px-4")}>
          <NavSection title="Providers & Models" isMini={isMini}>
            {providerModelItems.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} onClose={onClose} isMini={isMini} />
            ))}
          </NavSection>

          <NavSection title="Observability" isMini={isMini}>
            {observabilityItems
              .filter((item) => !item.debug || enableDebug)
              .map((item) => {
                if (item.href === "/dashboard/translator" && !enableTranslator) return null;
                return (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} onClose={onClose} isMini={isMini} />
                );
              })}
          </NavSection>

          <NavSection title="System" isMini={isMini}>
            <button
              onClick={() => !isMini && setMediaOpen((v) => !v)}
              className={cn(
                "w-full flex items-center gap-3 py-1 rounded-lg transition-all group",
                isMini ? "justify-center px-0 mx-2" : "px-3",
                pathname.startsWith("/dashboard/media-providers")
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
              title={isMini ? "Media Providers" : undefined}
            >
              <span className="material-symbols-outlined text-lg">perm_media</span>
              {!isMini && (
                <>
                  <span className="text-sm font-medium flex-1 text-left">Media Providers</span>
                  <span
                    className="material-symbols-outlined text-sm transition-transform"
                    style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  >
                    expand_more
                  </span>
                </>
              )}
            </button>
            {mediaOpen && !isMini && (
              <div className="pl-4">
                {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                  <Link
                    key={kind.id}
                    href={`/dashboard/media-providers/${kind.id}`}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 px-4 py-1 rounded-lg transition-all group",
                      pathname.startsWith(`/dashboard/media-providers/${kind.id}`)
                        ? "bg-primary/10 text-primary"
                        : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                    )}
                  >
                    <span className="material-symbols-outlined text-base">{kind.icon}</span>
                    <span className="text-sm">{kind.label}</span>
                  </Link>
                ))}
                <Link
                  key={COMBINED_WEB_ITEM.id}
                  href={COMBINED_WEB_ITEM.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-4 py-1 rounded-lg transition-all group",
                    pathname.startsWith(COMBINED_WEB_ITEM.href)
                      ? "bg-primary/10 text-primary"
                      : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                  )}
                >
                  <span className="material-symbols-outlined text-base">{COMBINED_WEB_ITEM.icon}</span>
                  <span className="text-sm">{COMBINED_WEB_ITEM.label}</span>
                </Link>
              </div>
            )}
            {systemItems.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} onClose={onClose} isMini={isMini} />
            ))}
            <NavLink
              item={{ href: "/dashboard/profile", label: "Settings", icon: "settings" }}
              active={isActive("/dashboard/profile")}
              onClose={onClose}
              isMini={isMini}
            />
          </NavSection>
        </nav>

      </aside>

    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
};
