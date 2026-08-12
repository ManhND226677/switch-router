"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { THEME_CONFIG } from "@/shared/constants/config";

export const DESIGN_OPTIONS = [
  { id: "classic", label: "Classic", icon: "dashboard" },
  { id: "minimal", label: "Minimal", icon: "crop_square" },
  { id: "vivid", label: "Vivid", icon: "auto_awesome" },
  { id: "soft", label: "Soft", icon: "blur_on" },
];

const DEFAULT_DESIGN = DESIGN_OPTIONS[0].id;

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: THEME_CONFIG.defaultTheme,
      design: DEFAULT_DESIGN,
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      toggleTheme: () => {
        const newTheme = get().theme === "dark" ? "light" : "dark";
        set({ theme: newTheme });
        applyTheme(newTheme);
      },
      setDesign: (design) => {
        const nextDesign = DESIGN_OPTIONS.some((option) => option.id === design)
          ? design
          : DEFAULT_DESIGN;
        set({ design: nextDesign });
        applyDesign(nextDesign);
      },
      initTheme: () => {
        const { theme, design } = get();
        applyTheme(theme);
        applyDesign(design);
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

function applyDesign(design) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.design = design || DEFAULT_DESIGN;
}

export default useThemeStore;
