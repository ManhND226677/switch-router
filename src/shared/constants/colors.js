// Switch Router Midnight Operations palette
// Light theme: cool blue-white surfaces
// Dark theme: slate navy operations canvas

export const COLORS = {
  // Primary - Route Blue
  primary: {
    DEFAULT: "#5C8DFF",
    hover: "#466FE0",
    light: "#9BB7FF",
    dark: "#3658B5",
  },

  // Light theme backgrounds
  light: {
    bg: "#EEF3F9",
    bgAlt: "#E7EEF6",
    surface: "#FFFFFF",
    sidebar: "rgba(232, 239, 247, 0.92)",
    border: "#D8E2EE",
    textMain: "#17263B",
    textMuted: "#60758F",
  },

  // Dark theme backgrounds
  dark: {
    bg: "#071321",
    bgAlt: "#0B1B2E",
    surface: "#122740",
    sidebar: "rgba(7, 19, 33, 0.94)",
    border: "rgba(145, 174, 213, 0.18)",
    textMain: "#EDF4FB",
    textMuted: "#8DA6C2",
  },

  // Status colors
  status: {
    success: "#54D7A4",
    successLight: "#DCFCE7",
    successDark: "#166534",
    warning: "#F5B94C",
    warningLight: "#FEF3C7",
    warningDark: "#92400E",
    error: "#EF8C7C",
    errorLight: "#FEE2E2",
    errorDark: "#991B1B",
    info: "#7DA5FF",
    infoLight: "#DBEAFE",
    infoDark: "#1E40AF",
  },
};

// CSS Variables mapping for Tailwind
export const CSS_VARIABLES = {
  light: {
    "--color-primary": COLORS.primary.DEFAULT,
    "--color-primary-hover": COLORS.primary.hover,
    "--color-bg": COLORS.light.bg,
    "--color-bg-alt": COLORS.light.bgAlt,
    "--color-surface": COLORS.light.surface,
    "--color-sidebar": COLORS.light.sidebar,
    "--color-border": COLORS.light.border,
    "--color-text-main": COLORS.light.textMain,
    "--color-text-muted": COLORS.light.textMuted,
  },
  dark: {
    "--color-primary": COLORS.primary.DEFAULT,
    "--color-primary-hover": COLORS.primary.hover,
    "--color-bg": COLORS.dark.bg,
    "--color-bg-alt": COLORS.dark.bgAlt,
    "--color-surface": COLORS.dark.surface,
    "--color-sidebar": COLORS.dark.sidebar,
    "--color-border": COLORS.dark.border,
    "--color-text-main": COLORS.dark.textMain,
    "--color-text-muted": COLORS.dark.textMuted,
  },
};
