"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { THEME_CONFIG } from "@/shared/constants/config";

// Chỉ còn một giao diện (Minimal — nấu sẵn trong globals.css), nên toàn bộ
// cơ chế design-preset đã tháo dỡ; store chỉ quản lý sáng/tối.
const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: THEME_CONFIG.defaultTheme,
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      toggleTheme: () => {
        const newTheme = get().theme === "dark" ? "light" : "dark";
        set({ theme: newTheme });
        applyTheme(newTheme);
      },
      initTheme: () => {
        const { theme } = get();
        applyTheme(theme);
        // Dọn rác data-design của phiên bản cũ còn sót trong DOM
        if (typeof document !== "undefined") {
          delete document.documentElement.dataset.design;
        }
      },
    }),
    { name: THEME_CONFIG.storageKey },
  ),
);

function applyTheme(theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  const effectiveTheme = theme === "system" ? systemTheme : theme;
  root.classList.toggle("dark", effectiveTheme === "dark");
  root.dataset.theme = effectiveTheme;
}

export default useThemeStore;
